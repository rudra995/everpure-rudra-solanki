// JWT helpers. The token carries IDENTITY only (who you are + your IdP groups).
// Role and permissions are worked out on the server for every request, so a change to
// permissions.js applies immediately and a client can never grant itself rights.
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { roleForGroups, permissionsForRole, ROLES } from '../rbac/permissions.js';

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name, groups: user.groups },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, issuer: 'pure-insights' },
  );
}

// Returns the request-scoped user (identity + role + permissions) or throws.
export function verifyToken(token) {
  const claims = jwt.verify(token, config.jwtSecret, { issuer: 'pure-insights' });
  const role = roleForGroups(claims.groups);
  return {
    id: claims.sub,
    email: claims.email,
    name: claims.name,
    groups: claims.groups,
    role,
    roleLabel: role ? ROLES[role].label : null,
    permissions: permissionsForRole(role),
  };
}
