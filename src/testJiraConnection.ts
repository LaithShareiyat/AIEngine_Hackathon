import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testJiraConnection() {
  try {
    const response = await axios.get(
      `${process.env.JIRA_API_URL}/myself`,
      {
        auth: {
          username: process.env.JIRA_USERNAME || '',
          password: process.env.JIRA_API_TOKEN || ''
        }
      }
    );

    console.log('Jira Connection Successful! ✅');
    console.log('Connected User:', response.data.displayName);
    console.log('Email:', response.data.emailAddress);
    console.log('Account Type:', response.data.accountType);

  } catch (error: any) {
    console.error('❌ Error connecting to Jira:');
    if (error.response) {
      // The request was made and the server responded with a status code
      console.error('Status:', error.response.status);
      console.error('Error message:', error.response.data.message || error.response.data);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from Jira. Check your API URL and network connection.');
    } else {
      // Something happened in setting up the request
      console.error('Error:', error.message);
    }
  }
}

// Add to package.json scripts
testJiraConnection(); 