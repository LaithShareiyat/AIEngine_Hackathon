export interface Employee {
  id: string;
  name: string;
  email: string;
  skills: string[];
  currentWorkload: number;
}

export interface JiraTask {
  id: string;
  summary: string;
  description: string;
  assignee: string;
  priority: string;
  complexity: number;
  labels: string[];
  estimatedHours: number;
  dueDate: Date;
}

export interface WorkloadMetrics {
  employeeId: string;
  taskCount: number;
  totalComplexity: number;
  totalEstimatedHours: number;
  skillMatchScore: number;
  workloadScore: number;
} 