import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
    clean: true,
    target: "node18",
    splitting: false,
    sourcemap: true,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: false,
    clean: false,
    target: "node18",
    splitting: false,
    sourcemap: false,
    banner: { js: "#!/usr/bin/env node" },
  },
]);
