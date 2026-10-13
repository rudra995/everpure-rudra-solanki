// Alert history and acknowledgement. Live delivery is over Socket.IO (realtime/socket.js);
// these endpoints let a dashboard load recent alerts on page open and acknowledge them.
import { Router } from 'express';
import { PERMISSIONS as P, can } from '../rbac/permissions.js';
import { requireAny } from '../rbac/middleware.js';
import { audit } from '../audit/auditLog.js';
import { listAlerts, getAlert, acknowledge, alertStats } from '../realtime/alerts.js';

const router = Router();
router.use(requireAny(P.ALERTS_READ_ALL, P.ALERTS_READ_OWN));

const isMine = (user, alert) => alert.owner?.toLowerCase() === user.email.toLowerCase();
const visible = (user, alerts) => (can(user, P.ALERTS_READ_ALL) ? alerts : alerts.filter((a) => isMine(user, a)));

// GET /api/alerts?limit=&type=&severity=&unacknowledged=true
router.get('/', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const all = listAlerts({
    limit: 2000,
    type: req.query.type,
    severity: req.query.severity,
    unacknowledged: req.query.unacknowledged === 'true',
  });
  const alerts = visible(req.user, all).slice(0, limit);
  res.json({ count: alerts.length, alerts });
});

// GET /api/alerts/stats  ->  counters since server start (platform-wide for admins)
router.get('/stats', (req, res) => {
  if (can(req.user, P.ALERTS_READ_ALL)) return res.json({ scope: 'all', stats: alertStats() });
  const mine = visible(req.user, listAlerts({ limit: 2000 }));
  return res.json({
    scope: 'own',
    stats: {
      in_memory: mine.length,
      unacknowledged: mine.filter((a) => !a.acknowledged_at).length,
      LATENCY_BREACH: mine.filter((a) => a.type === 'LATENCY_BREACH').length,
      REFRESH_FAILURE: mine.filter((a) => a.type === 'REFRESH_FAILURE').length,
    },
  });
});

// POST /api/alerts/:id/ack
router.post('/:id/ack', requireAny(P.ALERTS_ACK_ALL, P.ALERTS_ACK_OWN), (req, res) => {
  const alert = getAlert(req.params.id);
  if (!alert) return res.status(404).json({ error: 'not_found', message: 'Alert not found (it may have aged out of memory)' });
  if (!can(req.user, P.ALERTS_ACK_ALL) && !isMine(req.user, alert)) {
    audit('access.denied', { user: req.user, outcome: 'denied', ip: req.ip, detail: { path: req.originalUrl, reason: 'not alert owner' } });
    return res.status(403).json({ error: 'forbidden', message: 'You can only acknowledge alerts for your own reports' });
  }
  acknowledge(alert, req.user);
  audit('alert.ack', { user: req.user, ip: req.ip, detail: { alert_id: alert.id, report_id: alert.report_id } });
  return res.json({ alert });
});

export default router;
