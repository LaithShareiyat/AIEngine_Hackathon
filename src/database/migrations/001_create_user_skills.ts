import pool from '../../config/database';

async function createUserSkillsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_skills (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(100) NOT NULL,
        skill VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, skill)
      );
    `);
    console.log('User skills table created successfully');
  } catch (error) {
    console.error('Error creating user skills table:', error);
    throw error;
  }
}

createUserSkillsTable(); 