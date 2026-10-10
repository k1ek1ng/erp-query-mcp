/**
 * The guardrails are two layers, and they are not equal. These tests pin down
 * which one is actually load-bearing.
 *
 *   1. validateQuery(): a keyword denylist. Coarse. It does not parse SQL, so
 *      it matches forbidden words wherever they appear, including inside string
 *      literals. Its job is a fast, clearly-worded rejection, not security.
 *   2. openDb({ readOnly: true }): SQLite itself refuses writes. This is the
 *      boundary. If layer 1 were removed entirely, the server would still be
 *      read-only.
 *
 * Documenting the false positives rather than pretending they don't exist:
 * a reviewer should know the denylist's failure mode is over-rejection, and
 * that over-rejection is the safe direction for it to fail in.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateQuery, openDb } from "../src/db.js";

test("KNOWN LIMITATION: the denylist rejects legitimate read-only queries", () => {
  // A manufacturer stocks threaded inserts. Asking for them is a plain SELECT,
  // and the denylist sees the word "insert" and refuses it.
  const partsQuery = "SELECT * FROM parts WHERE description LIKE '%INSERT%'";
  assert.equal(validateQuery(partsQuery).ok, false);

  // Same failure with a vendor whose name contains a forbidden keyword.
  const vendorQuery = "SELECT * FROM vendors WHERE name LIKE '%Grant%'";
  assert.equal(validateQuery(vendorQuery).ok, false);

  // The model gets a clear reason and can rephrase, so the cost is a retry,
  // not a wrong answer. Fixing this properly means parsing the statement
  // rather than scanning it, worth doing only if the false positives turn
  // out to matter in practice.
});

test("the denylist does NOT false-positive on identifiers containing keywords", () => {
  // Underscore is a word character, so \bupdate\b does not match update_date.
  // Recording this so nobody "fixes" the regex into something looser.
  for (const sql of [
    "SELECT update_date FROM invoices",
    "SELECT create_date FROM po_lines",
    "SELECT drop_ship FROM sales_orders",
  ]) {
    assert.equal(validateQuery(sql).ok, true, `should accept: ${sql}`);
  }
});

test("the read-only connection is the real boundary, not the denylist", () => {
  const db = openDb(); // requires `npm run seed`

  // Bypass validateQuery entirely and go straight at the driver, which is what
  // a validator bug or an unanticipated syntax would effectively do.
  assert.throws(
    () => db.prepare("DELETE FROM invoices").run(),
    /readonly|read-only/i,
    "SQLite must refuse the write even with validation out of the picture"
  );
  assert.throws(() => db.prepare("DROP TABLE parts").run(), /readonly|read-only/i);

  db.close();
});
