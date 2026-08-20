import tls from 'tls';
import { URL } from 'url';
import { assertSafeUrl } from '../utils/ssrf.js';

export async function checkSsl(websiteUrl) {
  const parsed = new URL(websiteUrl);
  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      applicable: false,
      expiresAt: null,
      daysRemaining: null,
      issuer: null,
      error: 'Site is not served over HTTPS'
    };
  }

  await assertSafeUrl(websiteUrl);

  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: parsed.hostname,
        port: Number(parsed.port) || 443,
        servername: parsed.hostname,
        timeout: 10000,
        rejectUnauthorized: false
      },
      () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        socket.end();

        if (!cert || !cert.valid_to) {
          resolve({
            valid: false,
            applicable: true,
            expiresAt: null,
            daysRemaining: null,
            issuer: null,
            error: 'No certificate presented'
          });
          return;
        }

        const expiresAt = new Date(cert.valid_to);
        const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        const issuer = cert.issuer?.O || cert.issuer?.CN || 'Unknown issuer';

        resolve({
          valid: authorized && daysRemaining > 0,
          applicable: true,
          expiresAt: expiresAt.toISOString(),
          daysRemaining,
          issuer,
          authorized,
          error: authorized ? null : socket.authorizationError?.toString() || 'Certificate is not trusted'
        });
      }
    );

    socket.on('error', (error) => {
      resolve({
        valid: false,
        applicable: true,
        expiresAt: null,
        daysRemaining: null,
        issuer: null,
        error: error.message
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        valid: false,
        applicable: true,
        expiresAt: null,
        daysRemaining: null,
        issuer: null,
        error: 'SSL handshake timed out'
      });
    });
  });
}
