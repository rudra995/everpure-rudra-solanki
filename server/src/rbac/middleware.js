// Express middleware that enforces RBAC on the server. The frontend hides things a role
// can't use, but that is convenience only; these checks are the real gate.
import { verifyToken } from '../auth/jwt.js';
import { audit } from '../audit/auditLog.js';
import { can } from './permissions.js';

// 401 when there is no valid token. Attaches req.user for everything downstream.
export function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthenticated', message: 'Missing bearer token' });
  try {
    req.user = verifyToken(token);
    if (!req.user.role) {
      return res.status(403).json({ error: 'forbidden', message: 'Your groups grant no role in this app' });
    }
    return next();
  } catch {
    return res.status(401).json({ error: 'unauthenticated', message: 'Invalid or expired token' });
  }
}

function deny(req, res, needed) {
  audit('access.denied', {
    user: req.user,
    outcome: 'denied',
    ip: req.ip,
    detail: { method: req.method, path: req.originalUrl, needed },
  });
  return res.status(403).json({ error: 'forbidden', message: `Requires permission: ${needed.join(' or ')}` });
}

// 403 unless the user holds at least ONE of the listed permissions.
// (Pass both the ':all' and ':own' variant when an endpoint serves either scope.)
export function requireAny(...permissions) {
  return (req, res, next) =>
    permissions.some((p) => can(req.user, p)) ? next() : deny(req, res, permissions);
}

export { can };
