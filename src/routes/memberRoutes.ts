import express, { Request, Response, RequestHandler } from 'express';
import { JiraService } from '../services/jiraService';
import pool from '../config/database';
import { WorkloadAnalyzer } from '../services/workloadAnalyzer';
import { JiraTask } from '../types';

const router = express.Router();
const jiraService = new JiraService();

// Get all project members
router.get('/members', async (req, res) => {
  try {
    const response = await jiraService.getProjectMembers();
    res.json(response);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

// Update member skills
router.post('/members/:memberId/skills', async (req, res) => {
  try {
    const { memberId } = req.params;
    const { skills } = req.body;
    await jiraService.updateMemberSkills(memberId, skills);
    res.json({ message: 'Skills updated successfully' });
  } catch (error) {
    console.error('Error updating skills:', error);
    res.status(500).json({ error: 'Failed to update skills' });
  }
});

// Get available skills (from Jira labels)
router.get('/skills', async (req, res) => {
  try {
    const skills = await jiraService.getProjectSkills();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// Add this new endpoint
router.get('/workload-suggestions', async (req, res) => {
  try {
    console.log('Fetching workload suggestions...');
    
    const members = await jiraService.getProjectMembers();
    console.log('Members fetched:', members);
    
    const tasks: JiraTask[] = [];
    
    // Get tasks for each member
    for (const member of members) {
      console.log(`Fetching tasks for member: ${member.name}`);
      const memberTasks = await jiraService.getTasksForEmployee(member.id);
      console.log(`Found ${memberTasks.length} tasks for ${member.name}`);
      tasks.push(...memberTasks);
    }

    console.log('All tasks collected:', tasks);

    const workloadAnalyzer = new WorkloadAnalyzer();
    console.log('Getting AI suggestions...');
    const suggestions = await workloadAnalyzer.getAIWorkloadSuggestions(members, tasks);
    console.log('AI Suggestions received:', suggestions);
    
    res.json({ suggestions });
  } catch (error: any) {
    console.error('Error getting AI suggestions:', error);
    res.status(500).json({ 
      error: 'Failed to get AI suggestions', 
      details: error?.message || 'Unknown error'
    });
  }
});

// Define the request types
interface TaskAssigneeParams {
  taskId: string;
}

interface TaskAssigneeBody {
  newAssignee: string;
}

// Add task reassignment endpoint with proper typing
const updateTaskAssignee: RequestHandler<
  TaskAssigneeParams,
  { message: string } | { error: string, details: string },
  TaskAssigneeBody
> = async (req, res) => {
  try {
    const { taskId } = req.params;
    const { newAssignee } = req.body;
    
    console.log('Received task reassignment request:', {
      taskId,
      newAssignee,
      body: req.body
    });
    
    if (!newAssignee || !newAssignee.includes(':')) {
      console.error('Invalid assignee ID format:', newAssignee);
      res.status(400).json({ 
        error: 'Invalid assignee ID format. Expected format: "accountId:uuid"',
        details: 'Invalid format'
      });
      return;
    }

    await jiraService.updateTaskAssignee(taskId, newAssignee);
    res.json({ message: 'Task reassigned successfully' });
  } catch (error) {
    console.error('Error reassigning task:', error);
    res.status(500).json({ 
      error: 'Failed to reassign task',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

router.put('/tasks/:taskId/assignee', updateTaskAssignee);

export default router; 