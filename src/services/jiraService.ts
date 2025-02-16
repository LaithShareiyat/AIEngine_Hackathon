import axios from 'axios';
import { JiraTask, Employee } from '../types';
import pool from '../config/database';

// Define interfaces at the top of the file
interface Member {
  id: string;
  name: string;
  avatar: string;
  skills: string[];
  workloadIntensity: number;
  weeklyHours: number;
}

export class JiraService {
  private baseUrl: string;
  private auth: {
    username: string;
    password: string;
  };

  constructor() {
    if (!process.env.JIRA_API_URL) {
      throw new Error('JIRA_API_URL is not defined in environment variables');
    }

    // Ensure baseUrl has https:// prefix
    this.baseUrl = process.env.JIRA_API_URL.startsWith('https://')
      ? process.env.JIRA_API_URL
      : `https://${process.env.JIRA_API_URL}`;

    // Ensure baseUrl ends with /rest/api/3
    if (!this.baseUrl.endsWith('/rest/api/3')) {
      this.baseUrl = `${this.baseUrl}/rest/api/3`;
    }

    this.auth = {
      username: process.env.JIRA_USERNAME || '',
      password: process.env.JIRA_API_TOKEN || ''
    };

    // Log the constructed URL for debugging
    console.log('Jira API URL:', this.baseUrl);
  }

  async getTasksForEmployee(employeeEmail: string): Promise<JiraTask[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/search`,
        {
          auth: this.auth,
          params: {
            jql: `assignee = ${employeeEmail} AND status != Done`,
            fields: ['summary', 'description', 'priority', 'labels', 'duedate', 'timeestimate', 'status', 'assignee']
          }
        }
      );

      return this.mapJiraResponseToTasks(response.data);
    } catch (error) {
      console.error('Error fetching Jira tasks:', error);
      throw error;
    }
  }

  private mapJiraResponseToTasks(response: any): JiraTask[] {
    return response.issues.map((issue: any) => ({
      id: issue.key,
      summary: issue.fields.summary,
      description: issue.fields.description,
      assignee: issue.fields.assignee?.emailAddress,
      assigneeId: issue.fields.assignee?.accountId,
      status: issue.fields.status?.name || 'To Do',
      priority: issue.fields.priority?.name || 'Medium',
      complexity: this.calculateComplexity(issue),
      labels: issue.fields.labels || [],
      estimatedHours: issue.fields.timeestimate ? issue.fields.timeestimate / 3600 : 0,
      dueDate: issue.fields.duedate ? new Date(issue.fields.duedate) : undefined,
      requiredSkills: (issue.fields.labels || [])
        .filter((label: string) => label.toLowerCase().startsWith('skill:'))
        .map((label: string) => label.replace('skill:', '').trim())
    }));
  }

  private calculateComplexity(issue: any): number {
    let complexity = 0;
    
    // Priority-based complexity
    const priorityWeights: { [key: string]: number } = {
      'Highest': 5,
      'High': 4,
      'Medium': 3,
      'Low': 2,
      'Lowest': 1
    };
    
    complexity += priorityWeights[issue.fields.priority?.name] || 3;
    
    // Label-based complexity
    const complexityLabels = ['complex', 'technical', 'critical'];
    complexity += issue.fields.labels.filter((label: string) => 
      complexityLabels.includes(label.toLowerCase())
    ).length;

    return complexity;
  }

  async getProjectMembers() {
    try {
      const membersResponse = await axios.get(
        `${this.baseUrl}/user/assignable/search`,
        {
          auth: this.auth,
          params: {
            project: process.env.JIRA_PROJECT_KEY
          }
        }
      );

      // Get all members' skills and weekly hours from database
      const { rows: userSkills } = await pool.query(
        'SELECT user_id, skill FROM user_skills'
      );

      // Get weekly working hours for all employees
      const { rows: employeeHours } = await pool.query(
        'SELECT email, weekly_working_hours FROM employees'
      );

      // Create hours map
      const hoursMap = new Map(
        employeeHours.map(emp => [emp.email, emp.weekly_working_hours])
      );

      // Fetch tasks for workload calculation
      const tasksResponse = await axios.get(
        `${this.baseUrl}/search`,
        {
          auth: this.auth,
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY} AND status != Done`,
            fields: ['assignee', 'duedate', 'timeestimate', 'summary', 'status', 'labels', 'priority']
          }
        }
      );

      // Reset and initialize workload tracking
      const workloadMap = new Map<string, { dailyHours: number, totalHours: number }>();
      const taskCountMap = new Map<string, number>();
      const NOW = new Date();
      const DAYS_IN_WEEK = 5;

      tasksResponse.data.issues.forEach((task: any) => {
        if (task.fields.assignee) {
          const assigneeId = task.fields.assignee.accountId;
          const assigneeEmail = task.fields.assignee.emailAddress;
          const weeklyHours = hoursMap.get(assigneeEmail) || 40;
          
          // Track task count
          taskCountMap.set(assigneeId, (taskCountMap.get(assigneeId) || 0) + 1);
          
          const hours = this.calculateTaskWorkloadFactor(
            task.fields,
            weeklyHours,
            NOW,
            DAYS_IN_WEEK
          );
          
          // Detailed logging for each task's contribution
          console.log('Individual Task Contribution:', {
            assignee: task.fields.assignee.displayName,
            taskKey: task.key,
            summary: task.fields.summary,
            estimatedHours: task.fields.timeestimate ? task.fields.timeestimate / 3600 : 0,
            dailyHours: hours.dailyHours,
            totalHours: hours.totalHours,
            currentTotal: workloadMap.get(assigneeId) || { dailyHours: 0, totalHours: 0 },
            taskCount: taskCountMap.get(assigneeId)
          });
          
          const current = workloadMap.get(assigneeId) || { dailyHours: 0, totalHours: 0 };
          workloadMap.set(
            assigneeId,
            {
              dailyHours: current.dailyHours + hours.dailyHours,
              totalHours: current.totalHours + hours.totalHours
            }
          );
        }
      });

      // Calculate final workload percentages
      const finalWorkloads = Array.from(workloadMap.entries()).map(([id, hours]) => {
        const member = membersResponse.data.find((m: any) => m.accountId === id);
        const weeklyHours = hoursMap.get(member?.emailAddress) || 40;
        const dailyCapacity = weeklyHours / DAYS_IN_WEEK;
        
        return {
          assignee: member?.displayName,
          workloadPercentage: Math.round((hours.dailyHours / dailyCapacity) * 100),
          dailyHours: Math.round(hours.dailyHours * 10) / 10,
          totalHours: Math.round(hours.totalHours * 10) / 10,
          dailyCapacity: dailyCapacity
        };
      });

      // Log final workload summary
      console.log('Final Workload Summary:', finalWorkloads);

      // Create skills map
      const skillsMap = userSkills.reduce((map: Map<string, string[]>, row: any) => {
        if (!map.has(row.user_id)) {
          map.set(row.user_id, []);
        }
        map.get(row.user_id)?.push(row.skill);
        return map;
      }, new Map());

      const result = membersResponse.data.map((member: any) => {
        const weeklyHours = hoursMap.get(member.emailAddress) || 40;
        const dailyCapacity = weeklyHours / DAYS_IN_WEEK;
        
        // Get total required hours and total available hours
        const workloadData = workloadMap.get(member.accountId) || { dailyHours: 0, totalHours: 0 };
        const totalRequiredHours = workloadData.totalHours;
        
        // Calculate total available hours across all tasks' working days
        const totalAvailableHours = dailyCapacity * DAYS_IN_WEEK;
        
        // Calculate intensity as percentage of total available time
        const intensity = Math.round((totalRequiredHours / totalAvailableHours) * 100) / 100;

        return {
          id: member.accountId,
          name: member.displayName,
          avatar: member.avatarUrls['48x48'],
          skills: skillsMap.get(member.accountId) || [],
          workloadIntensity: intensity,
          weeklyHours: weeklyHours
        };
      });

      return result;
    } catch (error) {
      console.error('Error fetching project members:', error);
      throw error;
    }
  }

  private calculateTaskWorkloadFactor(
    taskFields: any, 
    weeklyHours: number,
    now: Date,
    daysInWeek: number
  ): { dailyHours: number, totalHours: number } {
    // Convert from seconds to hours
    const estimatedHours = (taskFields.timeestimate || 0) / 3600;
    if (estimatedHours === 0) return { dailyHours: 0, totalHours: 0 };

    const dueDate = taskFields.duedate ? new Date(taskFields.duedate) : null;
    
    // Calculate available working days until due date
    let workingDays = 0;
    if (dueDate) {
      const currentDate = new Date(now);
      while (currentDate <= dueDate) {
        if (currentDate.getDay() !== 0 && currentDate.getDay() !== 6) {
          workingDays++;
        }
        currentDate.setDate(currentDate.getDate() + 1);
      }
    } else {
      workingDays = 10; // Default to 2 weeks
    }

    workingDays = Math.max(1, workingDays);

    // Calculate total available hours until due date
    const dailyAvailableHours = weeklyHours / daysInWeek;
    const totalAvailableHours = workingDays * dailyAvailableHours;

    // Calculate workload intensity as a percentage of total available time
    const workloadIntensity = estimatedHours / totalAvailableHours;

    console.log('Task Workload Calculation:', {
      summary: taskFields.summary,
      estimatedHours,
      workingDays,
      totalAvailableHours,
      workloadIntensity: workloadIntensity * 100 + '%'
    });

    return {
      dailyHours: workloadIntensity * dailyAvailableHours,
      totalHours: estimatedHours
    };
  }

  async updateMemberSkills(memberId: string, skills: string[]) {
    try {
      // Start a transaction
      await pool.query('BEGIN');

      // Remove all existing skills for this user
      await pool.query(
        'DELETE FROM user_skills WHERE user_id = $1',
        [memberId]
      );

      // Add new skills
      if (skills.length > 0) {
        const values = skills.map((skill, i) => `($1, $${i + 2})`).join(',');
        const params = [memberId, ...skills];
        await pool.query(
          `INSERT INTO user_skills (user_id, skill) VALUES ${values}`,
          params
        );
      }

      // Commit transaction
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      console.error('Error updating member skills:', error);
      throw error;
    }
  }

  // Add a new method to get project skills
  async getProjectSkills(): Promise<string[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/search`,
        {
          auth: this.auth,
          params: {
            jql: `project = ${process.env.JIRA_PROJECT_KEY}`,
            fields: ['labels'],
            maxResults: 1000  // Increase to get more issues
          }
        }
      );

      const allLabels = new Set<string>();
      response.data.issues.forEach((issue: any) => {
        issue.fields.labels.forEach((label: string) => {
          // Include all labels, not just skill: prefixed ones
          allLabels.add(label);
        });
      });

      // Sort alphabetically
      return Array.from(allLabels).sort();
    } catch (error) {
      console.error('Error fetching project skills:', error);
      throw error;
    }
  }

  async updateTaskAssignee(taskId: string, accountId: string): Promise<void> {
    try {
      console.log('Starting task reassignment with:', {
        taskId,
        accountId,
        baseUrl: this.baseUrl,
        requestUrl: `${this.baseUrl}/issue/${taskId}/assignee`
      });

      if (!accountId.includes(':')) {
        throw new Error(`Invalid account ID format: ${accountId}. Expected format: "accountId:uuid"`);
      }

      const response = await axios.put(
        `${this.baseUrl}/issue/${taskId}/assignee`,
        {
          accountId
        },
        {
          auth: this.auth,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      console.log('Jira API Response:', {
        status: response.status,
        statusText: response.statusText,
        data: response.data
      });

      if (response.status !== 204) {
        throw new Error(`Unexpected response status: ${response.status}`);
      }

      console.log(`Successfully reassigned task ${taskId} to account ${accountId}`);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error('Detailed Axios error:', {
          taskId,
          accountId,
          errorMessage: error.message,
          errorResponse: error.response?.data,
          errorStatus: error.response?.status,
          requestUrl: error.config?.url,
          requestData: error.config?.data,
          requestHeaders: error.config?.headers
        });
      } else {
        console.error('Non-Axios error:', {
          taskId,
          accountId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      throw error; // Throw the original error to preserve the details
    }
  }

  async getJiraUsers(): Promise<any[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/user/assignable/search`,
        {
          auth: this.auth,
          params: {
            project: process.env.JIRA_PROJECT_KEY,
            maxResults: 100
          }
        }
      );

      // We're already returning the email addresses
      return response.data.filter((user: any) => user.active).map((user: any) => ({
        accountId: user.accountId,
        displayName: user.displayName,
        emailAddress: user.emailAddress,  // Email is included here
        avatar: user.avatarUrls['48x48']
      }));
    } catch (error) {
      console.error('Error fetching Jira users:', error);
      throw error;
    }
  }

  async getAIWorkloadSuggestions(
    employees: Employee[],
    tasks: JiraTask[]
  ): Promise<string> {
    const todoTasks = tasks.filter(task => task.status === 'To Do');
    
    // Calculate current workload for each employee
    const employeeWorkloads = new Map<string, number>();
    employees.forEach(emp => {
      const assignedTasks = tasks.filter(task => 
        task.assignee === emp.id && task.status !== 'Done'
      );
      
      const workload = assignedTasks.reduce((total, task) => {
        const result = this.calculateTaskWorkloadFactor(
          {
            timeestimate: task.estimatedHours * 3600,
            duedate: task.dueDate,
            priority: { name: task.priority }
          },
          emp.weeklyHours,
          new Date(),
          5
        );
        return total + result.dailyHours;
      }, 0);
      
      employeeWorkloads.set(emp.id, workload);
    });

    // Log current workloads
    console.log('Current workloads:', Object.fromEntries(employeeWorkloads));

    // Define overload threshold
    const OVERLOAD_THRESHOLD = 0.8; // 80% capacity

    // Filter out employees who are already overloaded
    const availableEmployees = employees.filter(emp => {
      const currentWorkload = employeeWorkloads.get(emp.id) || 0;
      return currentWorkload < OVERLOAD_THRESHOLD;
    });

    // Sort tasks by priority and complexity
    todoTasks.sort((a, b) => {
      const priorityWeight: Record<string, number> = {
        'Highest': 5,
        'High': 4,
        'Medium': 3,
        'Low': 2,
        'Lowest': 1
      };
      
      const getPriorityWeight = (priority: string): number => 
        priorityWeight[priority as keyof typeof priorityWeight] || 3;

      return getPriorityWeight(b.priority) - getPriorityWeight(a.priority) ||
             b.complexity - a.complexity;
    });

    // Generate suggestions
    const suggestions = todoTasks.map(task => {
      // Find best match based on skills and current workload
      const bestMatch = availableEmployees
        .filter(emp => {
          const hasRequiredSkills = task.requiredSkills.every(skill => 
            emp.skills.includes(skill)
          );
          const currentWorkload = employeeWorkloads.get(emp.id) || 0;
          const taskWorkload = this.calculateTaskWorkloadFactor(
            {
              timeestimate: task.estimatedHours * 3600,
              duedate: task.dueDate,
              priority: { name: task.priority }
            },
            emp.weeklyHours,
            new Date(),
            5
          ).dailyHours;
          
          // Check if adding this task would overload the employee
          return hasRequiredSkills && 
                 (currentWorkload + taskWorkload) < OVERLOAD_THRESHOLD;
        })
        .sort((a, b) => {
          const workloadA = employeeWorkloads.get(a.id) || 0;
          const workloadB = employeeWorkloads.get(b.id) || 0;
          return workloadA - workloadB;
        })[0];

      if (bestMatch) {
        return {
          taskId: task.id,
          fromAssignee: task.assignee,
          toAssignee: bestMatch.id,
          reason: `Better workload distribution and matching skills`
        };
      }
      return null;
    }).filter(Boolean);

    return JSON.stringify({
      hasSuggestions: suggestions.length > 0,
      suggestions
    });
  }
} 