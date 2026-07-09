/**
 * Seed a demo manufacturing ERP database with synthetic data.
 * All names, parts, and numbers are fake and generated below.
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "erp-demo.db");

fs.mkdirSync(dataDir, { recursive: true });
if (fs.existsSync(dbPath)) fs.rmSync(dbPath);

const db = new DatabaseSync(dbPath);

db.exec(`
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  region TEXT NOT NULL,
  credit_limit REAL NOT NULL
);
CREATE TABLE vendors (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lead_time_days INTEGER NOT NULL
);
CREATE TABLE parts (
  id INTEGER PRIMARY KEY,
  part_number TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  unit_cost REAL NOT NULL,
  qty_on_hand INTEGER NOT NULL,
  reorder_point INTEGER NOT NULL
);
CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  order_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','received','cancelled'))
);
CREATE TABLE po_lines (
  id INTEGER PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL
);
CREATE TABLE sales_orders (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_date TEXT NOT NULL,
  ship_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','shipped','invoiced','cancelled'))
);
CREATE TABLE so_lines (
  id INTEGER PRIMARY KEY,
  so_id INTEGER NOT NULL REFERENCES sales_orders(id),
  part_id INTEGER NOT NULL REFERENCES parts(id),
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL
);
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  so_id INTEGER NOT NULL REFERENCES sales_orders(id),
  invoice_date TEXT NOT NULL,
  amount REAL NOT NULL,
  paid INTEGER NOT NULL DEFAULT 0
);
`);

// --- synthetic data generators (deterministic, seeded PRNG) ---
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (a, b) => Math.floor(rand() * (b - a + 1)) + a;

const adjectives = ["Summit", "Pioneer", "Cascade", "Granite", "Northline", "Redwood", "Beacon", "Harbor", "Ridgeway", "Lakeside"];
const industries = ["Robotics", "Controls", "Fabrication", "Systems", "Machining", "Electric", "Automation", "Tooling"];
const suffixes = ["Inc.", "LLC", "Co.", "Corp."];
const regions = ["Northeast", "Southeast", "Midwest", "Southwest", "West"];
const partNouns = ["Bracket", "Housing", "Gasket", "Actuator", "Bearing", "Sensor Mount", "Terminal Block", "Shaft", "Coupler", "Enclosure", "Relay Board", "Harness"];
const partMods = ["Steel", "Aluminum", "Polymer", "Brass", "Coated", "Heavy-Duty", "Compact", "Sealed"];

function companyName() {
  return `${pick(adjectives)} ${pick(industries)} ${pick(suffixes)}`;
}
function dateWithin(daysBack) {
  const d = new Date("2026-07-01");
  d.setDate(d.getDate() - between(0, daysBack));
  return d.toISOString().slice(0, 10);
}

const insCustomer = db.prepare("INSERT INTO customers (name, region, credit_limit) VALUES (?,?,?)");
const insVendor = db.prepare("INSERT INTO vendors (name, lead_time_days) VALUES (?,?)");
const insPart = db.prepare("INSERT INTO parts (part_number, description, unit_cost, qty_on_hand, reorder_point) VALUES (?,?,?,?,?)");
const insPO = db.prepare("INSERT INTO purchase_orders (vendor_id, order_date, status) VALUES (?,?,?)");
const insPOLine = db.prepare("INSERT INTO po_lines (po_id, part_id, qty, unit_price) VALUES (?,?,?,?)");
const insSO = db.prepare("INSERT INTO sales_orders (customer_id, order_date, ship_date, status) VALUES (?,?,?,?)");
const insSOLine = db.prepare("INSERT INTO so_lines (so_id, part_id, qty, unit_price) VALUES (?,?,?,?)");
const insInvoice = db.prepare("INSERT INTO invoices (so_id, invoice_date, amount, paid) VALUES (?,?,?,?)");

db.exec("BEGIN");

for (let i = 0; i < 25; i++) insCustomer.run(companyName(), pick(regions), between(20, 250) * 1000);
for (let i = 0; i < 15; i++) insVendor.run(companyName(), between(3, 45));

for (let i = 0; i < 120; i++) {
  const cost = between(2, 900) + rand();
  insPart.run(
    `P-${String(1000 + i)}`,
    `${pick(partMods)} ${pick(partNouns)}`,
    Math.round(cost * 100) / 100,
    between(0, 500),
    between(10, 60)
  );
}

for (let i = 0; i < 80; i++) {
  const status = pick(["open", "received", "received", "received", "cancelled"]);
  const { lastInsertRowid: poId } = insPO.run(between(1, 15), dateWithin(180), status);
  for (let l = 0; l < between(1, 4); l++) {
    insPOLine.run(poId, between(1, 120), between(5, 200), Math.round((between(2, 900) + rand()) * 100) / 100);
  }
}

for (let i = 0; i < 150; i++) {
  const status = pick(["open", "shipped", "invoiced", "invoiced", "invoiced", "cancelled"]);
  const orderDate = dateWithin(180);
  const shipDate = status === "open" || status === "cancelled" ? null : orderDate;
  const { lastInsertRowid: soId } = insSO.run(between(1, 25), orderDate, shipDate, status);
  let total = 0;
  for (let l = 0; l < between(1, 5); l++) {
    const qty = between(1, 50);
    const price = Math.round((between(10, 1500) + rand()) * 100) / 100;
    total += qty * price;
    insSOLine.run(soId, between(1, 120), qty, price);
  }
  if (status === "invoiced") {
    insInvoice.run(soId, orderDate, Math.round(total * 100) / 100, pick([0, 1, 1, 1]));
  }
}

db.exec("COMMIT");

const counts = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((t) => `${t.name}: ${db.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get().c} rows`);

console.log(`Seeded ${dbPath}\n` + counts.join("\n"));
db.close();
