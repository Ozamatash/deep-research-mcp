import { config } from 'dotenv';

// Load test environment variables
config({ path: './.env.local' });

// Set test environment
process.env.NODE_ENV = 'test';