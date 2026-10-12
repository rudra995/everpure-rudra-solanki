// Entry point: connect the data source, start HTTP + Socket.IO, start the telemetry replay.
import http from 'node:http';
import { config } from './config.js';
import { initDb } from './data/index.js';
import { createApp } from './app.js';
import { attachSocket } from './realtime/socket.js';
import * as simulator from './realtime/simulator.js';

async function main() {
  if (config.jwtSecret.startsWith('dev-only')) {
    console.warn('[security] JWT_SECRET not set: using an insecure development secret. Set it in .env for anything beyond a local demo.');
  }
  await initDb();
  const snapshots = await simulator.loadReplay();

  const server = http.createServer(createApp());
  attachSocket(server);
  server.listen(config.port, () => {
    console.log(`[server] http://localhost:${config.port}  (REST under /api, Socket.IO on the same port)`);
    console.log(`[simulator] ${snapshots} snapshots loaded for replay`);
    if (config.simulator.autoStart) simulator.start(config.simulator.intervalMs);
  });

  const shutdown = () => {
    simulator.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[fatal]', err.message);
  process.exit(1);
});
