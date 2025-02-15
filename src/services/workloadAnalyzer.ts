import { Employee, JiraTask, WorkloadMetrics } from '../types';
import { Configuration, OpenAI } from 'openai';

export class WorkloadAnalyzer {
  private anthropic: OpenAI;

  constructor() {
    this.anthropic = new OpenAI({
      apiKey: process.env.ANTHROPIC_API_KEY,
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
    
    const response = await this.anthropic.chat.completions.create({
      model: "claude-3-sonnet-20240229",
      messages: [{
        role: "user",
        content: prompt
      }],
      temperature: 0.7,
    });

    return this.parseRedistributionSuggestions(response.choices[0].message.content);
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
} 