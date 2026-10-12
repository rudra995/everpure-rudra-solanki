// Socket.IO (WebSocket) layer for real-time alerts and telemetry.
//
// Why WebSocket (Socket.IO) rather than SSE: alerts only flow server -> client, so SSE
// would also work. Socket.IO was chosen because the brief names WebSockets, its rooms
// make per-role / per-owner delivery simple, and it authenticates and reconnects for us.
//
// Security model:
//   - The JWT is verified during the handshake; no valid token = connection refused.
//   - Each socket joins rooms based on its permissions, and events are only emitted to
//     rooms. A user can never receive an alert for a report they aren't allowed to see.
//       alerts:all        users with alerts:read:all     (Platform Admin)
//       telemetry:all     all reports' health with real owner emails (Platform Admin)
//       telemetry:masked  all reports' health, owner emails masked (FinOps, Viewer)
//       owner:<email>     users with own-scope permissions (Report Owner) - alerts and
//                         telemetry for their own reports only
import { Server } from 'socket.io';
import { config } from '../config.js';
import { verifyToken } from '../auth/jwt.js';
import { PERMISSIONS as P, can } from '../rbac/permissions.js';
import { reportScope, maskEmail } from '../rbac/scope.js';
import { effectiveOwner } from '../services/ownership.js';
import { bus, EVENTS } from './bus.js';
import { status as simulatorStatus } from './simulator.js';

const ownerRoom = (email) => `owner:${String(email).toLowerCase()}`;

export function attachSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: config.clientOrigin } });

  io.use((socket, next) => {
    try {
      const user = verifyToken(socket.handshake.auth?.token);
      if (!user.role) return next(new Error('forbidden'));
      socket.data.user = user;
      return next();
    } catch {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const rooms = [];
    if (can(user, P.ALERTS_READ_ALL)) rooms.push('alerts:all');
    if (can(user, P.HEALTH_READ) && reportScope(user) === 'all') {
      rooms.push(can(user, P.PII_READ) ? 'telemetry:all' : 'telemetry:masked');
    }
    if (reportScope(user) === 'own') rooms.push(ownerRoom(user.email));
    socket.join(rooms);
    socket.emit('welcome', {
      user: { email: user.email, role: user.role },
      rooms,
      receives_alerts: can(user, P.ALERTS_READ_ALL) || can(user, P.ALERTS_READ_OWN),
      simulator: simulatorStatus(),
    });
  });

  // ---- routing ----------------------------------------------------------
  bus.on(EVENTS.ALERT, (alert) => {
    io.to('alerts:all').emit('alert', alert);
    if (alert.owner) io.to(ownerRoom(alert.owner)).emit('alert', alert);
  });

  bus.on(EVENTS.ALERT_ACK, (alert) => {
    io.to('alerts:all').emit('alert:ack', alert);
    if (alert.owner) io.to(ownerRoom(alert.owner)).emit('alert:ack', alert);
  });

  bus.on(EVENTS.TELEMETRY, (snap) => {
    const owner = effectiveOwner(snap.report_id, snap.canonical_owner);
    io.to('telemetry:all').emit('telemetry', { ...snap, canonical_owner: owner });
    io.to('telemetry:masked').emit('telemetry', { ...snap, canonical_owner: maskEmail(owner) });
    if (owner) io.to(ownerRoom(owner)).emit('telemetry', { ...snap, canonical_owner: owner });
  });

  bus.on(EVENTS.SIMULATOR, (s) => io.emit('simulator:status', s));

  return io;
}
