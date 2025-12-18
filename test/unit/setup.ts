import { vi } from 'vitest';

// Mock environment variables
process.env.AWS_REGION = 'us-east-1';
process.env.NODE_ENV = 'test';

// Increase timeout for async operations
vi.setConfig({ testTimeout: 10000 });
