// Demo identity store. Stands in for the company identity provider (Okta / Entra ID):
// it knows who a user is and which groups they belong to, nothing about permissions.
//
// The Report Owner demo user is user_3@company.com, a real owner email from the dataset,
// so its "own reports" are the reports whose canonical owner is that address.
// Passwords are bcrypt-hashed at startup; plain text never sits in memory after that.
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

const DEMO_USERS = [
  { id: 'u-admin', name: 'Asha Admin', email: 'admin@company.com', groups: ['pi-platform-admins'] },
  { id: 'u-finops', name: 'Farhan FinOps', email: 'finops@company.com', groups: ['pi-finops'] },
  { id: 'u-owner', name: 'Report Owner (user_3)', email: 'user_3@company.com', groups: ['pi-report-owners'] },
  { id: 'u-viewer', name: 'Vikram Viewer', email: 'viewer@company.com', groups: ['pi-business-users'] },
];

const passwordHash = bcrypt.hashSync(config.demoPassword, 10);
const users = DEMO_USERS.map((u) => ({ ...u, passwordHash }));

export function findUserByEmail(email) {
  return users.find((u) => u.email.toLowerCase() === String(email || '').toLowerCase()) || null;
}

export function verifyPassword(user, password) {
  return bcrypt.compareSync(String(password || ''), user.passwordHash);
}

// Safe public listing for the demo login screen (no hashes).
export function listDemoUsers() {
  return DEMO_USERS.map(({ id, name, email, groups }) => ({ id, name, email, groups }));
}
