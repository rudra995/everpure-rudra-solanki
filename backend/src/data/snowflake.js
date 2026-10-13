// Snowflake data source (DATA_SOURCE=snowflake). Reads the same marts/audit views as the
// DuckDB source, deployed by sql/snowflake/. Connects as the service user with key-pair
// auth and the read-only role PI_APP_SERVICE.
import fs from 'node:fs';
import snowflake from 'snowflake-sdk';
import { config } from '../config.js';

let connection = null;

function exec(sqlText, binds = []) {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows || [])),
    });
  });
}

export async function init() {
  const sf = config.snowflake;
  if (!sf.account) throw new Error('DATA_SOURCE=snowflake but SNOWFLAKE_ACCOUNT is not set in .env');
  snowflake.configure({ logLevel: 'ERROR' });
  connection = snowflake.createConnection({
    account: sf.account,
    username: sf.username,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey: fs.readFileSync(sf.privateKeyPath, 'utf8'),
    role: sf.role,
    warehouse: sf.warehouse,
    database: sf.database,
    clientSessionKeepAlive: true,
  });
  await new Promise((resolve, reject) => connection.connect((err) => (err ? reject(err) : resolve())));
  // New users default to all granted roles being active at once. Switch that off so the
  // app runs with ONLY its read-only role's privileges (least privilege).
  await exec('USE SECONDARY ROLES NONE');
}

export async function query(sql, params = []) {
  const rows = await exec(sql, params);
  // Snowflake returns UPPERCASE column names; normalise to match DuckDB.
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])));
}

export const name = 'snowflake';
