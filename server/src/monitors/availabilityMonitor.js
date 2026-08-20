import { safeFetch, isSuccessStatus } from '../utils/httpClient.js';
import { originOf } from '../utils/ssrf.js';

export async function checkAvailability(website) {
  const allowedOrigins = [originOf(website.url)];
  const result = await safeFetch(website.url, {
    method: 'GET',
    allowedOrigins
  });

  if (result.error?.kind === 'timeout') {
    return {
      status: 'offline',
      responseTime: result.responseTime,
      httpStatus: result.status,
      error: result.error.message,
      body: ''
    };
  }

  if (result.error) {
    const status = result.error.kind === 'ssl' ? 'warning' : 'offline';
    return {
      status,
      responseTime: result.responseTime,
      httpStatus: result.status,
      error: result.error.message,
      body: ''
    };
  }

  if (!isSuccessStatus(result.status)) {
    return {
      status: result.status >= 500 ? 'offline' : 'warning',
      responseTime: result.responseTime,
      httpStatus: result.status,
      error: `HTTP ${result.status}`,
      body: result.body || ''
    };
  }

  return {
    status: result.responseTime > 5000 ? 'warning' : 'online',
    responseTime: result.responseTime,
    httpStatus: result.status,
    error: result.responseTime > 5000 ? 'Slow response' : null,
    body: result.body || ''
  };
}
