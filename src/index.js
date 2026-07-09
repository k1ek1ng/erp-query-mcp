#!/usr/bin/env node
/**
 * erp-query-mcp — an MCP server that lets an LLM answer plain-English
 * questions against a manufacturing ERP database.
 *
 * The model does the natural-language → SQL translation; this server
 * provides safe, read-only primitives: schema discovery + validated SELECTs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb, runQuery, listTables, describeTable, DB_PATH } from "./db.js";

let db;
try {
  db = openDb();
} catch (err) {
  console.error(
    `Could not open database at ${DB_PATH}. Run "npm run seed" first.\n${err.message}`
  );
  process.exit(1);
}

const server = new McpServer({
  name: "erp-query-mcp",
  version: "1.0.0",
});

server.tool(
  "list_tables",
  "List all tables in the ERP database with their row counts. Call this first to see what data is available.",
  {},
  async () => ({
    content: [{ type: "text", text: JSON.stringify(listTables(db), null, 2) }],
  })
);

server.tool(
  "describe_table",
  "Get the columns, types, and keys for one table. Call this before writing a query against a table.",
  { table: z.string().describe("Table name, e.g. 'purchase_orders'") },
  async ({ table }) => {
    try {
      return {
        content: [
          { type: "text", text: JSON.stringify(describeTable(db, table), null, 2) },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }
);

server.tool(
  "run_query",
  "Run a single read-only SELECT query against the ERP database. " +
    "Only SELECT/WITH statements are accepted; results are capped at 200 rows. " +
    "Use list_tables and describe_table first to learn the schema.",
  { sql: z.string().describe("A single SELECT statement (SQLite dialect)") },
  async ({ sql }) => {
    try {
      const result = runQuery(db, sql);
      const header = result.truncated
        ? `-- ${result.rowCount} rows matched, showing first ${result.rows.length} --\n`
        : `-- ${result.rowCount} rows --\n`;
      return {
        content: [
          { type: "text", text: header + JSON.stringify(result.rows, null, 2) },
        ],
      };
    } catch (err) {
      return { isError: true, content: [{ type: "text", text: err.message }] };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`erp-query-mcp ready (db: ${DB_PATH})`);
