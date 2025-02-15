import pool from '../../config/database';

async function addWeeklyHours() {
  try {
    // Add the column if it doesn't exist
    await pool.query(`
      ALTER TABLE employees 
      ADD COLUMN IF NOT EXISTS weekly_working_hours INTEGER DEFAULT 40;
    `);

    // Update existing employees to have 40 hours
    await pool.query(`
      UPDATE employees 
      SET weekly_working_hours = 40 
      WHERE weekly_working_hours IS NULL;
    `);

    console.log('Weekly working hours added successfully');
  } catch (error) {
    console.error('Error adding weekly working hours:', error);
    throw error;
  }
}

addWeeklyHours(); 