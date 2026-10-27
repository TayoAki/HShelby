import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "@hshelby/db/migrate";

// Works from src/ (tsx) and dist/ (bundled): both sit two levels below apps/api.
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../../../packages/db/migrations");
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
await runMigrations(url, migrationsFolder);
console.log(`migrations applied from ${migrationsFolder}`);
