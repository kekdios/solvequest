#!/usr/bin/env node
/**
 * Creates SQLite DB from db/schema.sql (default: data/solvequest.db).
 * Usage: node scripts/init-db.mjs [path/to/db.sqlite]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const schemaPath = path.join(root, "db", "schema.sql");
const outPath = process.argv[2] ?? path.join(root, "data", "solvequest.db");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const schema = fs.readFileSync(schemaPath, "utf8");

const db = new Database(outPath);
try {
  db.exec(schema);
  console.log(`OK: initialized ${outPath}`);
} finally {
  db.close();
}
