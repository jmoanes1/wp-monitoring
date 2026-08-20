import { createApp } from '../server/src/app.js';

// One Express app per serverless instance. Login and other /api routes
// run here because Vercel has no long-lived Node process.
const app = await createApp({ serverless: true });

export const config = {
  maxDuration: 30
};

export default app;
