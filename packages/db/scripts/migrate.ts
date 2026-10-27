import { fileURLToPath } from "node:url";
import { runMigrations } from "../src/migrate";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/hshelby_dev";
await runMigrations(url, fileURLToPath(new URL("../migrations", import.meta.url)));
console.log("migrations applied");
