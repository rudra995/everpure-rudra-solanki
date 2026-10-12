// DuckDB data source (default). Reads the database built by the SQL suite in sql/duckdb/.
// If the database file doesn't exist yet, it is built here by running those same SQL
// files, so a reviewer only needs `npm install && npm start`: no Python required.
import fs from 'node:fs';
import path from 'node:path';
import { DuckDBInstance } from '@duckdb/node-api';
import { config, REPO_ROOT } from '../config.js';

let connection = null;

async function buildDatabase(instance) {
  const con = await instance.connect();
  const files = fs.readdirSync(config.duckdbSqlDir).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
  // The SQL files reference the CSV relative to the repo root.
  const cwd = process.cwd();
  process.chdir(REPO_ROOT);
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(config.duckdbSqlDir, file), 'utf8');
      const statements = await con.extractStatements(sql);
      for (let i = 0; i < statements.count; i++) {
        const prepared = await statements.prepare(i);
        await prepared.run();
      }
      console.log(`[duckdb] built ${file}`);
    }
  } finally {
    process.chdir(cwd);
    con.closeSync?.();
  }
}

export async function init() {
  const exists = fs.existsSync(config.duckdbPath);
  if (!exists) {
    console.log(`[duckdb] ${path.relative(REPO_ROOT, config.duckdbPath)} not found, building it from sql/duckdb/`);
    const builder = await DuckDBInstance.create(config.duckdbPath);
    await buildDatabase(builder);
    builder.closeSync?.();
  }
  // Read-only: the app never writes analytics data, and a reviewer can still run
  // sql/duckdb/run_duckdb.py afterwards to rebuild it.
  const instance = await DuckDBInstance.create(config.duckdbPath, { access_mode: 'READ_ONLY' });
  connection = await instance.connect();
}

// DuckDB returns BIGINT as JS BigInt and dates/timestamps as objects; make everything JSON-safe.
function toPlain(value) {
  if (typeof value === 'bigint') return Number(value);
  if (value && typeof value === 'object' && typeof value.toString === 'function' && !Array.isArray(value)) {
    return value.toString();
  }
  return value;
}

export async function query(sql, params = []) {
  const reader = await connection.runAndReadAll(sql, params);
  return reader.getRowObjectsJS().map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), toPlain(v)])));
}

export const name = 'duckdb';
