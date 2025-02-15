CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    skills TEXT[] NOT NULL,
    current_workload FLOAT DEFAULT 0,
    weekly_working_hours INTEGER DEFAULT 40
);

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

CREATE TABLE user_skills (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,  -- This will store the Jira account ID
    skill VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, skill)  -- Prevent duplicate skills for a user
);

-- Update existing employees to have 40 hours
UPDATE employees SET weekly_working_hours = 40; 