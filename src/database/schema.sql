CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    skills TEXT[] NOT NULL,
    current_workload FLOAT DEFAULT 0
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