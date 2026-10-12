import { Router } from 'express';
import { findUserByEmail, verifyPassword, listDemoUsers } from '../auth/users.js';
import { signToken } from '../auth/jwt.js';
import { roleForGroups, permissionsForRole, ROLES } from '../rbac/permissions.js';
import { authenticate } from '../rbac/middleware.js';
import { audit } from '../audit/auditLog.js';

const router = Router();

// POST /api/auth/login  { email, password }  ->  { token, user }
router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(user, password)) {
    audit('auth.login', { outcome: 'failure', ip: req.ip, detail: { email: String(email || '') } });
    // Same message for unknown user and wrong password: don't reveal which emails exist.
    return res.status(401).json({ error: 'invalid_credentials', message: 'Email or password is incorrect' });
  }
  const role = roleForGroups(user.groups);
  const token = signToken(user);
  const profile = {
    id: user.id, name: user.name, email: user.email, groups: user.groups,
    role, roleLabel: ROLES[role]?.label ?? null, permissions: permissionsForRole(role),
  };
  audit('auth.login', { user: profile, ip: req.ip });
  return res.json({ token, user: profile });
});

// GET /api/auth/me  ->  the caller's identity, role and permissions (drives the UI)
router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

// GET /api/auth/demo-users  ->  the 4 demo identities for the login screen (no secrets)
router.get('/demo-users', (_req, res) => {
  res.json({
    users: listDemoUsers().map((u) => {
      const role = roleForGroups(u.groups);
      return { ...u, role, roleLabel: ROLES[role]?.label };
    }),
    note: 'Demo identities. All share the password set by DEMO_PASSWORD (default: demo123).',
  });
});

export default router;
