import helmet from 'helmet';
import cors from 'cors';
import { config } from '../config/index.js';

export function securityMiddleware() {
  return [
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false
    }),
    cors({
      origin: config.clientUrl,
      credentials: true
    })
  ];
}
