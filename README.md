# erp-query-mcp

An [MCP](https://modelcontextprotocol.io) server that allows an LLM to answer
natural-language questions about an ERP database, such as "Which parts are below
their reorder point?" The model generates SQL; the server ensures that SQL is
read-only.

The server exposes three tools:

- `list_tables`: table names and row counts
- `describe_table`: columns, types, and keys
- `run_query`: executes a single validated SELECT, limited to 200 rows

The schema tools are necessary in practice. Without them, the model infers column
names and produces queries against columns that do not exist.

The database is synthetic. `scripts/seed.js` deterministically generates a small
manufacturer with roughly 400 orders over six months.

## Read-only enforcement

Two layers prevent writes:

1. **Read-only connection.** SQLite is opened with `readOnly: true`, so the
   database rejects any write regardless of the SQL submitted.
2. **Query validation.** `validateQuery` rejects multiple statements, statements
   that do not begin with SELECT or WITH, and mutating keywords such as INSERT or
   DROP. Because it matches keywords rather than parsing SQL, it produces false
   positives: `WHERE description LIKE '%INSERT%'` is rejected despite being a
   read. These cases are documented in `test/validation-limits.test.js`.

The connection flag is the primary control. The keyword filter is a secondary
check, and a false positive only costs a retry, since the model receives the
rejection reason and can rewrite the query.

The 200-row limit bounds response size rather than enforcing safety.

## Production version

I built a production version of this server against a manufacturing ERP during
an internship. It is used by ten executives, including the CEO and CFO.

The production version does not accept model-generated SQL. Each of its 36 tools
executes a fixed, hand-written query (revenue by period, top customers, open
orders, AR and AP aging, material shortages, purchase price variance), so there
is no write path and no injection surface. Access is restricted by per-user
tokens checked against an allowlist, and every call is recorded in an
append-only audit log.

Fixed tools cannot answer unanticipated questions, and each new question requires
a code change. Against a live financial database, I chose that limitation over
relying on a SQL validator, and in practice the questions users asked fell into a
small, stable set.

This repository implements the free-form design. It contains no production code
or data.

## Run it

```bash
npm install
npm run seed     # creates data/erp-demo.db
npm test
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "erp-query": {
      "command": "node",
      "args": ["/absolute/path/to/erp-query-mcp/src/index.js"]
    }
  }
}
```

## Limitations

This version has no authentication, query logging, per-user limits, or query
timeout.

Node.js 22.5+, `@modelcontextprotocol/sdk`, `node:sqlite`, zod, `node:test`. MIT.
