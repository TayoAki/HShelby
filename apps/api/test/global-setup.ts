import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@hshelby/db/migrate";
import pg from "pg";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test";

/** Fresh schema for every run, built with the real migrations. */
export default async function setup() {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await client.end();
  const here = dirname(fileURLToPath(import.meta.url));
  await runMigrations(TEST_DATABASE_URL, resolve(here, "../../../packages/db/migrations"));
}
