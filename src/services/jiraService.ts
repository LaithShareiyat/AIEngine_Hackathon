import axios from 'axios';
import { JiraTask } from '../types';

export class JiraService {
  private baseUrl: string;
  private auth: {
    username: string;
    password: string;
  };

  constructor() {
    this.baseUrl = process.env.JIRA_API_URL || '';
    this.auth = {
      username: process.env.JIRA_USERNAME || '',
      password: process.env.JIRA_API_TOKEN || '',
    };
  }

  async getTasksForEmployee(employeeEmail: string): Promise<JiraTask[]> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/search`,
        {
          auth: this.auth,
          params: {
            jql: `assignee = ${employeeEmail} AND status != Done`,
            fields: ['summary', 'description', 'priority', 'labels', 'duedate', 'timeestimate']
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
      assignee: issue.fields.assignee.emailAddress,
      priority: issue.fields.priority.name,
      complexity: this.calculateComplexity(issue),
      labels: issue.fields.labels,
      estimatedHours: issue.fields.timeestimate / 3600,
      dueDate: new Date(issue.fields.duedate)
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
    
    complexity += priorityWeights[issue.fields.priority.name] || 3;
    
    // Label-based complexity
    const complexityLabels = ['complex', 'technical', 'critical'];
    complexity += issue.fields.labels.filter((label: string) => 
      complexityLabels.includes(label.toLowerCase())
    ).length;

    return complexity;
  }
} 