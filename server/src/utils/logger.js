import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { redact } from './redact.js';

function stamp() {
  return new Date().toISOString();
}

function writeLine(level, message, extra) {
  const line = extra
    ? `[${stamp()}] [${level}] ${message} ${JSON.stringify(redact(extra))}`
    : `[${stamp()}] [${level}] ${message}`;

  console.log(line);

  try {
    fs.mkdirSync(config.paths.logsDir, { recursive: true });
    fs.appendFileSync(path.join(config.paths.logsDir, 'app.log'), `${line}\n`, 'utf8');
  } catch {
    // Logging must never crash the process.
  }
}

export const logger = {
  info(message, extra) {
    writeLine('INFO', message, extra);
  },
  warn(message, extra) {
    writeLine('WARN', message, extra);
  },
  error(message, extra) {
    writeLine('ERROR', message, extra);
  }
};
