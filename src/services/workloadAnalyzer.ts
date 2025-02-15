import { Employee, JiraTask, WorkloadMetrics } from '../types';
import Anthropic from '@anthropic-ai/sdk';

export class WorkloadAnalyzer {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    });
  }

  calculateWorkloadMetrics(employee: Employee, tasks: JiraTask[]): WorkloadMetrics {
    const totalComplexity = tasks.reduce((sum, task) => sum + task.complexity, 0);
    const totalEstimatedHours = tasks.reduce((sum, task) => sum + task.estimatedHours, 0);
    const skillMatchScore = this.calculateSkillMatchScore(employee, tasks);

    const workloadScore = this.calculateWorkloadScore(
      totalComplexity,
      totalEstimatedHours,
      skillMatchScore,
      tasks.length
    );

    return {
      employeeId: employee.id,
      taskCount: tasks.length,
      totalComplexity,
      totalEstimatedHours,
      skillMatchScore,
      workloadScore
    };
  }

  private calculateSkillMatchScore(employee: Employee, tasks: JiraTask[]): number {
    let matchScore = 0;
    const employeeSkills = new Set(employee.skills);

    for (const task of tasks) {
      const taskSkills = new Set(task.labels.filter(label => 
        label.toLowerCase().startsWith('skill:')));
      
      const matchingSkills = [...taskSkills].filter(skill => 
        employeeSkills.has(skill.replace('skill:', '')));
      
      matchScore += matchingSkills.length / taskSkills.size || 1;
    }

    return tasks.length > 0 ? matchScore / tasks.length : 1;
  }

  private calculateWorkloadScore(
    complexity: number,
    hours: number,
    skillMatch: number,
    taskCount: number
  ): number {
    // Normalize each factor
    const normalizedComplexity = complexity / (taskCount || 1);
    const normalizedHours = hours / 40; // Assuming 40-hour work week
    const workloadScore = (
      (normalizedComplexity * 0.3) +
      (normalizedHours * 0.4) +
      ((1 - skillMatch) * 0.3)
    ) * 100;

    return Math.min(Math.max(workloadScore, 0), 100);
  }

  async suggestWorkloadRedistribution(
    employees: Employee[],
    allTasks: JiraTask[]
  ): Promise<Map<string, string[]>> {
    const prompt = this.buildRedistributionPrompt(employees, allTasks);
    
    const response = await this.anthropic.messages.create({
      model: "claude-3-opus-20240229",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: prompt
      }],
      temperature: 0.7,
    });

    if (response.content[0].type === 'text') {
      return this.parseRedistributionSuggestions(response.content[0].text);
    }

    console.error('Unexpected response format from Claude');
    return new Map();
  }

  private buildRedistributionPrompt(employees: Employee[], tasks: JiraTask[]): string {
    // Build a detailed prompt for Claude to analyze workload distribution
    return `
      Analyze the following workload distribution and suggest optimal task reassignments:
      
      Employees:
      ${JSON.stringify(employees, null, 2)}
      
      Tasks:
      ${JSON.stringify(tasks, null, 2)}
      
      Please suggest task reassignments to balance the workload considering:
      1. Employee skills and task requirements
      2. Current workload of each employee
      3. Task complexity and urgency
      4. Skill match between employees and tasks
      
      Provide output in the following format:
      {
        "taskId1": "newAssigneeId1",
        "taskId2": "newAssigneeId2"
      }
    `;
  }

  private parseRedistributionSuggestions(response: string): Map<string, string[]> {
    try {
      const suggestions = JSON.parse(response);
      return new Map(Object.entries(suggestions));
    } catch (error) {
      console.error('Error parsing redistribution suggestions:', error);
      return new Map();
    }
  }

  async getAIWorkloadSuggestions(
    employees: Employee[],
    tasks: JiraTask[]
  ): Promise<string> {
    const todoTasks = tasks.filter(task => task.status === 'To Do');

    // Add very detailed debug logging for skill matching
    console.log('\n=== DETAILED TASK-TO-SKILLS ANALYSIS ===');
    todoTasks.forEach(task => {
      console.log(`\nAnalyzing Task: "${task.summary}" (${task.id})`);
      console.log('Task Labels Required:', task.labels);
      
      const currentAssignee = employees.find(e => e.id === task.assigneeId);
      console.log(`Current Assignee: ${currentAssignee?.name}`);
      console.log('Current Assignee Skills:', currentAssignee?.skills);
      
      employees.forEach(emp => {
        if (emp.id !== task.assigneeId) { // Only check potential new assignees
          console.log(`\nChecking ${emp.name} as potential assignee:`);
          console.log('Their Skills:', emp.skills);
          
          // Check each required label
          const skillCheck = task.labels.map(label => {
            const hasSkill = emp.skills.includes(label);
            console.log(`- Label "${label}": ${hasSkill ? '✓ MATCH' : '✗ MISSING'}`);
            return hasSkill;
          });
          
          const canHandle = skillCheck.every(Boolean);
          console.log(`Can ${emp.name} handle this task? ${canHandle ? 'YES' : 'NO - Missing required skills'}`);
        }
      });
    });

    const prompt = `
      As a workload management expert, analyze the following team data and provide ONLY specific move recommendations:

      Team Members and their skills:
      ${employees.map(e => `- ${e.name} (AccountID: ${e.id}): 
         * Skills: [${e.skills.join(', ')}]
         * Current Workload: ${Math.round(e.workloadIntensity * 100)}%
         * Weekly Hours: ${e.weeklyHours}h`).join('\n')}

      Tasks that CAN be redistributed (To Do):
      ${todoTasks.map(t => `- Task "${t.summary}" (ID: ${t.id})
         * Current Assignee: ${employees.find(e => e.id === t.assigneeId)?.name}
         * Current AssigneeId: ${t.assigneeId}
         * Required Labels: [${t.labels.join(', ')}]
         * Estimated Hours: ${t.estimatedHours}h
         * Priority: ${t.priority}`).join('\n')}

      STRICT TASK MOVEMENT RULES:
      1. A task can ONLY be moved if:
         - The new assignee has EVERY SINGLE task label in their skills list (100% match required)
         - The move helps balance workload between Laith and Hasan
         - The new assignee is different from the current assignee
      2. Skill Matching Process:
         - Take each task label
         - Check if it exists in the new assignee's skills list
         - ALL labels must be found in skills, not just some
         - If even one label is missing, the task CANNOT be moved
      3. IMPORTANT: Use the FULL account ID when specifying assignees (e.g., "712020:b387b831-64c5-4928-8a76-a88b367945b7")

      RESPONSE FORMAT:
      For each valid move, provide EXACTLY this format with no additional text:
      MOVE_SUGGESTION
      TaskID: [ID]
      TaskName: [Name]
      FromAssignee: [Current Name]
      FromAssigneeId: [Full Account ID like "712020:b387b831-64c5-4928-8a76-a88b367945b7"]
      ToAssignee: [New Name]
      ToAssigneeId: [Full Account ID like "712020:47f33f35-fe06-4bd7-8326-a629099e37b7"]
      WorkloadChanges:
      - [Current]: [Before]% -> [After]%
      - [New]: [Before]% -> [After]%
      END_SUGGESTION

      If no moves are possible, return exactly: NO_MOVES_POSSIBLE
    `;

    try {
      const response = await this.anthropic.messages.create({
        model: "claude-3-opus-20240229",
        max_tokens: 1500,
        temperature: 0.7,
        messages: [{
          role: "user",
          content: prompt
        }]
      });

      const suggestions = response.content[0].type === 'text' ? response.content[0].text : 'No suggestions available';

      if (suggestions === 'NO_MOVES_POSSIBLE') {
        return JSON.stringify({
          hasSuggestions: false,
          message: "No moves recommended - strict requirements not met."
        });
      }

      // Parse the moves from the response
      const moves = suggestions.split('MOVE_SUGGESTION')
        .filter(move => move.trim())
        .map(move => {
          console.log('Raw move suggestion:', move); // Debug log

          const lines = move.split('\n').filter(line => line.trim());
          const moveData: any = {
            workloadChanges: {
              from: '',
              to: ''
            }
          };

          lines.forEach(line => {
            if (line.includes(':')) {
              // Split only on the first occurrence of ':'
              const [key, ...valueParts] = line.split(':');
              const value = valueParts.join(':').trim(); // Rejoin the rest with ':' to preserve full ID
              
              console.log('Parsing line:', { key: key.trim(), value }); // Debug log

              if (key.trim().startsWith('- ')) {
                // Handle workload changes
                const assignee = key.trim().replace('- ', '');
                if (assignee === moveData.FromAssignee) {
                  moveData.workloadChanges.from = value;
                } else {
                  moveData.workloadChanges.to = value;
                }
              } else if (key.trim() !== 'WorkloadChanges') {
                moveData[key.trim()] = value;
              }
            }
          });

          console.log('Parsed move data:', moveData); // Debug log
          return moveData;
        })
        .filter(move => {
          // Validate the move data
          const isValid = move.TaskID && move.TaskName && move.ToAssigneeId && move.ToAssigneeId.includes(':');
          if (!isValid) {
            console.error('Invalid move data:', move);
          }
          return isValid;
        });

      return JSON.stringify({
        hasSuggestions: moves.length > 0,
        moves: moves
      });

    } catch (error) {
      console.error('Error getting AI suggestions:', error);
      throw error;
    }
  }
} 