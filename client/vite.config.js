import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Use IPv4 loopback. `localhost` can resolve to ::1 on Windows while
// Express is listening on 127.0.0.1, which produces Vite proxy ECONNREFUSED.
const apiTarget = 'http://127.0.0.1:5000';

function attachProxyErrorHandler(proxy) {
  proxy.on('error', (error, _req, res) => {
    // During `node --watch` restarts the backend drops connections.
    // Answer with JSON so the login form can show a readable message.
    if (res && typeof res.writeHead === 'function' && !res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'API server is not running. Wait for the backend to start on port 5000, then try again.'
      }));
      return;
    }
    console.error(`Vite proxy error (${apiTarget}):`, error.message);
  });
}

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        configure: attachProxyErrorHandler
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
        configure: attachProxyErrorHandler
      }
    }
  }
});
