import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  target: "es2018",
  sourcemap: watch ? "inline" : false,
  outfile: "main.js",
  logLevel: "info"
});
if (watch) await context.watch(); else { await context.rebuild(); await context.dispose(); }
