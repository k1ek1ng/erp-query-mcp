import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DB_PATH =
  process.env.ERP_DB_PATH || path.join(__dirname, "..", "data", "erp-demo.db");

const MAX_ROWS = 200;

// Statements that could modify data or schema are rejected outright.
const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|truncate|grant)\b/i;

/**
 * Validate that a SQL string is a single, read-only SELECT statement.
 * Returns { ok: true, sql } or { ok: false, reason }.
 */
export function validateQuery(sql) {
  if (typeof sql !== "string" || sql.trim().length === 0) {
    return { ok: false, reason: "Query is empty." };
  }
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) {
    return { ok: false, reason: "Multiple statements are not allowed." };
  }
  if (!/^\s*(select|with)\b/i.test(trimmed)) {
    return { ok: false, reason: "Only SELECT queries are allowed." };
  }
  if (FORBIDDEN.test(trimmed)) {
    return {
      ok: false,
      reason: "Query contains a forbidden keyword (read-only server).",
    };
  }
  return { ok: true, sql: trimmed };
}

export function openDb(dbPath = DB_PATH) {
  // readOnly means SQLite itself will refuse writes — defense in depth
  // on top of validateQuery().
  return new DatabaseSync(dbPath, { readOnly: true });
}

/** Run a validated read-only query, capped at MAX_ROWS rows. */
export function runQuery(db, sql) {
  const check = validateQuery(sql);
  if (!check.ok) throw new Error(check.reason);
  const rows = db.prepare(check.sql).all();
  const truncated = rows.length > MAX_ROWS;
  return {
    rows: rows.slice(0, MAX_ROWS),
    rowCount: rows.length,
    truncated,
  };
}

export function listTables(db) {
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all();
  return tables.map((t) => {
    const { c } = db.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get();
    return { table: t.name, rowCount: c };
  });
}

export function describeTable(db, tableName) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
    throw new Error("Invalid table name.");
  }
  const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all();
  if (cols.length === 0) throw new Error(`Table not found: ${tableName}`);
  return cols.map((c) => ({
    column: c.name,
    type: c.type,
    notNull: !!c.notnull,
    primaryKey: !!c.pk,
  }));
}
