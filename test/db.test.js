import { test } from "node:test";
import assert from "node:assert/strict";
import { validateQuery, openDb, runQuery, listTables, describeTable } from "../src/db.js";

test("validateQuery accepts plain SELECT", () => {
  assert.equal(validateQuery("SELECT * FROM parts").ok, true);
});

test("validateQuery accepts CTEs", () => {
  assert.equal(
    validateQuery("WITH t AS (SELECT 1 AS x) SELECT x FROM t").ok,
    true
  );
});

test("validateQuery rejects writes", () => {
  for (const sql of [
    "DELETE FROM parts",
    "INSERT INTO parts VALUES (1)",
    "UPDATE parts SET unit_cost = 0",
    "DROP TABLE parts",
    "SELECT 1; DROP TABLE parts",
    "PRAGMA journal_mode = DELETE",
    "",
  ]) {
    assert.equal(validateQuery(sql).ok, false, `should reject: ${sql}`);
  }
});

test("seeded database answers queries read-only", () => {
  const db = openDb(); // requires `npm run seed` to have been run
  const tables = listTables(db);
  assert.ok(tables.length >= 8, "expected seeded tables");

  const cols = describeTable(db, "invoices");
  assert.ok(cols.some((c) => c.column === "amount"));

  const { rows } = runQuery(
    db,
    "SELECT COUNT(*) AS unpaid FROM invoices WHERE paid = 0"
  );
  assert.ok(rows[0].unpaid >= 0);

  assert.throws(() => runQuery(db, "DELETE FROM invoices"));
  db.close();
});
