import axios from 'axios';
import { JiraTask } from '../types';
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

      // Calculate workload intensity for each member
      const workloadMap = new Map<string, number>();
      const NOW = new Date();
      const DAYS_IN_WEEK = 5; // Assuming 5 working days per week

      tasksResponse.data.issues.forEach((task: any) => {
        if (task.fields.assignee) {
          const assigneeId = task.fields.assignee.accountId;
          const assigneeEmail = task.fields.assignee.emailAddress;
          const weeklyHours = hoursMap.get(assigneeEmail) || 40;
          
          const workloadFactor = this.calculateTaskWorkloadFactor(
            task.fields,
            weeklyHours,
            NOW,
            DAYS_IN_WEEK
          );
          
          // Add debug logging
          console.log('Task Assignment:', {
            taskSummary: task.fields.summary,
            assigneeName: task.fields.assignee.displayName,
            assigneeId,
            assigneeEmail,
            weeklyHours,
            workloadFactor,
            currentWorkload: workloadMap.get(assigneeId) || 0
          });
          
          workloadMap.set(
            assigneeId,
            (workloadMap.get(assigneeId) || 0) + workloadFactor
          );
        }
      });

      // After processing all tasks, log the final workload map
      console.log('Final Workload Map:', Object.fromEntries(workloadMap));

      // Create skills map
      const skillsMap = userSkills.reduce((map: Map<string, string[]>, row: any) => {
        if (!map.has(row.user_id)) {
          map.set(row.user_id, []);
        }
        map.get(row.user_id)?.push(row.skill);
        return map;
      }, new Map());

      const result = membersResponse.data.map((member: any) => {
        const intensity = Math.round((workloadMap.get(member.accountId) || 0) * 100) / 100;
        
        // Add debug logging for each member
        console.log('Member Workload:', {
          name: member.displayName,
          accountId: member.accountId,
          emailAddress: member.emailAddress,
          rawWorkload: workloadMap.get(member.accountId),
          calculatedIntensity: intensity
        });
        
        return {
          id: member.accountId,
          name: member.displayName,
          avatar: member.avatarUrls['48x48'],
          skills: skillsMap.get(member.accountId) || [],
          workloadIntensity: intensity,
          weeklyHours: hoursMap.get(member.emailAddress) || 40
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
  ): number {
    const estimatedHours = (taskFields.timeestimate || 0) / 3600;
    if (estimatedHours === 0) return 0;

    const dueDate = taskFields.duedate ? new Date(taskFields.duedate) : null;
    if (!dueDate) return estimatedHours / (weeklyHours * 2);

    let workingDays = 0;
    const currentDate = new Date(now);
    currentDate.setHours(0, 0, 0, 0);
    const endDate = new Date(dueDate);
    endDate.setHours(23, 59, 59, 999);
    
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        workingDays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const weeksUntilDue = Math.max(0.2, workingDays / 5);
    const availableHours = weeklyHours * weeksUntilDue;
    
    let factor = estimatedHours / availableHours;

    if (taskFields.status?.name === 'In Progress') {
      factor *= 1.2;
    }

    return factor;
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
} 