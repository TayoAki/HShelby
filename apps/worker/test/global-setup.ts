import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@hshelby/db/migrate";

/** Idempotent: applies any pending migrations to the shared test database. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_test";
  await runMigrations(url, resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations"));
}
