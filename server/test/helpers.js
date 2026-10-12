// Shared test setup: real DuckDB data, real app, real JWTs. No mocks of the rules under test.
import request from 'supertest';
import { initDb } from '../src/data/index.js';
import { createApp } from '../src/app.js';
import { loadReplay } from '../src/realtime/simulator.js';

export const USERS = {
  admin: 'admin@company.com',
  finops: 'finops@company.com',
  owner: 'user_3@company.com',
  viewer: 'viewer@company.com',
};

let app;
export async function setup() {
  if (!app) {
    await initDb();
    await loadReplay();
    app = createApp();
  }
  return app;
}

export async function login(who) {
  const res = await request(app).post('/api/auth/login').send({ email: USERS[who], password: 'demo123' });
  if (res.status !== 200) throw new Error(`login failed for ${who}: ${res.status}`);
  return res.body.token;
}

// GET/POST helpers that attach the bearer token.
export const api = {
  get: (token, url) => request(app).get(url).set('authorization', `Bearer ${token}`),
  post: (token, url, body = {}) => request(app).post(url).set('authorization', `Bearer ${token}`).send(body),
};
