import express from 'express';
import { JiraService } from './services/jiraService';
import { WorkloadAnalyzer } from './services/workloadAnalyzer';
import pool from './config/database';

const app = express();
app.use(express.json());

const jiraService = new JiraService();
const workloadAnalyzer = new WorkloadAnalyzer();

app.get('/api/workload-analysis', async (req, res) => {
  try {
    // Get all employees from database
    const { rows: employees } = await pool.query('SELECT * FROM employees');
    
    // Get tasks for each employee
    const employeeTasks = await Promise.all(
      employees.map(async (employee) => ({
        employee,
        tasks: await jiraService.getTasksForEmployee(employee.email)
      }))
    );

    // Calculate workload metrics for each employee
    const workloadMetrics = employeeTasks.map(({ employee, tasks }) => 
      workloadAnalyzer.calculateWorkloadMetrics(employee, tasks)
    );

    // Get redistribution suggestions
    const allTasks = employeeTasks.flatMap(({ tasks }) => tasks);
    const redistributionSuggestions = await workloadAnalyzer.suggestWorkloadRedistribution(
      employees,
      allTasks
    );

    res.json({
      metrics: workloadMetrics,
      suggestions: Object.fromEntries(redistributionSuggestions)
    });
  } catch (error) {
    console.error('Error in workload analysis:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 