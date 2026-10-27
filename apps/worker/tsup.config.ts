import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  clean: true,
  noExternal: [/^@hshelby\//],
});
