import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config/index.js';

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin === config.clientUrl) return true;
  try {
    return new URL(origin).hostname.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

export function securityMiddleware() {
  return [
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }),
    cors({
      origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
      credentials: true
    })
  ];
}
