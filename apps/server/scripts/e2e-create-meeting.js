#!/usr/bin/env node

import axios from 'axios';

async function runTest() {
  const args = process.argv.slice(2);
  const text = args.join(' ');

  if (!text) {
    console.error('Please provide the natural language text for the meeting as an argument.');
    console.log('Example: pnpm run e2e:createMeeting "Coffee with Alex tomorrow 2pm"');
    process.exit(1);
  }

  const apiUrl = 'http://localhost:3000/api/process'; // Assuming server runs on port 3000

  console.log(`Sending request to ${apiUrl} with text: "${text}"`);

  try {
    const response = await axios.post(apiUrl, { text });
    console.log('API Response:');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error) {
    console.error('Error calling API:');
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error message:', error.message);
    }
    process.exit(1);
  }
}

runTest(); 