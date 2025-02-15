export interface Employee {
  id: string;
  name: string;
  email: string;
  skills: string[];
  currentWorkload: number;
  workloadIntensity: number;
  weeklyHours: number;
}

export interface JiraTask {
  id: string;
  summary: string;
  description?: string;
  assignee: string;
  assigneeId: string;
  status: string;
  priority: string;
  complexity: number;
  labels: string[];
  estimatedHours: number;
  requiredSkills: string[];
  dueDate?: Date;
}

export interface WorkloadMetrics {
  employeeId: string;
  taskCount: number;
  totalComplexity: number;
  totalEstimatedHours: number;
  skillMatchScore: number;
  workloadScore: number;
} 