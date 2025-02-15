-- Enable arrays extension if not enabled
CREATE EXTENSION IF NOT EXISTS array_ops;

-- Create employees table
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    skills TEXT[] NOT NULL,
    current_workload FLOAT DEFAULT 0
);

-- Create jira_tasks table
CREATE TABLE jira_tasks (
    id VARCHAR(50) PRIMARY KEY,
    summary TEXT NOT NULL,
    description TEXT,
    assignee_id INTEGER REFERENCES employees(id),
    priority VARCHAR(20),
    complexity INTEGER,
    labels TEXT[],
    estimated_hours FLOAT,
    due_date TIMESTAMP
);

-- Insert sample data for testing
INSERT INTO employees (name, email, skills) VALUES
    ('John Doe', 'john.doe@company.com', ARRAY['javascript', 'react', 'node']),
    ('Jane Smith', 'jane.smith@company.com', ARRAY['python', 'django', 'aws']),
    ('Bob Wilson', 'bob.wilson@company.com', ARRAY['java', 'spring', 'kubernetes']),
    ('Alice Brown', 'alice.brown@company.com', ARRAY['javascript', 'angular', 'aws']);

-- Insert sample tasks
INSERT INTO jira_tasks (id, summary, description, assignee_id, priority, complexity, labels, estimated_hours, due_date) VALUES
    ('TASK-1', 'Implement login feature', 'Create login page with OAuth', 1, 'High', 4, ARRAY['skill:javascript', 'skill:react', 'frontend'], 8, NOW() + INTERVAL '5 days'),
    ('TASK-2', 'Setup AWS infrastructure', 'Configure EC2 instances and RDS', 2, 'Highest', 5, ARRAY['skill:aws', 'infrastructure', 'critical'], 16, NOW() + INTERVAL '3 days'),
    ('TASK-3', 'API optimization', 'Improve API response time', 3, 'Medium', 3, ARRAY['skill:java', 'backend', 'performance'], 12, NOW() + INTERVAL '7 days'),
    ('TASK-4', 'Bug fix in payment module', 'Fix payment processing issue', 1, 'High', 4, ARRAY['skill:javascript', 'bug', 'critical'], 6, NOW() + INTERVAL '2 days'); 