// Central configuration. Every tunable value is read here, once, from the environment
// (repo-root .env), so the rest of the code never touches process.env directly.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..');

dotenv.config({ path: path.join(REPO_ROOT, '.env'), quiet: true });

const env = process.env;

export const config = {
  port: Number(env.PORT || 4000),
  clientOrigin: env.CLIENT_ORIGIN || 'http://localhost:5173',

  // Auth. The fallback secret is for local demo runs only; the server warns when it is used.
  jwtSecret: env.JWT_SECRET || 'dev-only-insecure-secret-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  demoPassword: env.DEMO_PASSWORD || 'demo123',

  // Data source: 'duckdb' (default, no account needed) or 'snowflake' (live).
  dataSource: (env.DATA_SOURCE || 'duckdb').toLowerCase(),
  duckdbPath: path.resolve(REPO_ROOT, env.DUCKDB_PATH || 'data/pure_insights.duckdb'),
  duckdbSqlDir: path.join(REPO_ROOT, 'sql', 'duckdb'),

  snowflake: {
    account: env.SNOWFLAKE_ACCOUNT,
    username: env.SNOWFLAKE_USER || 'PI_SVC',
    privateKeyPath: path.resolve(REPO_ROOT, env.SNOWFLAKE_PRIVATE_KEY_PATH || 'keys/snowflake_rsa_key.p8'),
    role: env.SNOWFLAKE_APP_ROLE || 'PI_APP_SERVICE',
    warehouse: env.SNOWFLAKE_WAREHOUSE || 'PI_WH',
    database: env.SNOWFLAKE_DATABASE || 'PURE_INSIGHTS',
  },

  // Alert rules. The 15 s threshold comes straight from the brief; tiers are our labels.
  alerts: {
    latencyThresholdSec: 15,
    highSec: 30,
    criticalSec: 45,
    failureStatuses: ['FAILED', 'TIMED_OUT'],
    historySize: Number(env.ALERT_HISTORY_SIZE || 2000),
  },

  // Telemetry simulator: replays clean snapshots as if they were arriving live.
  simulator: {
    autoStart: env.SIM_AUTOSTART !== 'false',
    intervalMs: Number(env.SIM_INTERVAL_MS || 1000),
  },
};
