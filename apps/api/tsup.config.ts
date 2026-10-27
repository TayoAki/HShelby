import { defineConfig } from "tsup";

// Bundle our workspace packages (TypeScript source) into dist; keep npm deps external.
export default defineConfig({
  entry: { index: "src/index.ts", migrate: "src/migrate.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@hshelby\//],
});
