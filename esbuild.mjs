import esbuild from "esbuild";
import path from "node:path";
import { readFileSync } from "node:fs";

// Preserve the license for esbuild helpers injected into the distributed bundle.
const esbuildLicense = readFileSync(new URL("./node_modules/esbuild/LICENSE.md", import.meta.url), "utf8").trim();
const licenseBanner = `/*! esbuild generated runtime helpers\n${esbuildLicense}\n*/`;

const watch = process.argv.includes("--watch");
const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  platform: "node",
  target: "es2018",
  sourcemap: watch ? "inline" : false,
  banner: { js: licenseBanner },
  outfile: "main.js",
  logLevel: "info",
  plugins: [{
    name: "inline-layout-worker",
    setup(build) {
      build.onResolve({ filter: /\?worker$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -7)), namespace: "layout-worker" }));
      build.onLoad({ filter: /.*/, namespace: "layout-worker" }, async args => {
        const result = await esbuild.build({ entryPoints: [args.path], bundle: true, write: false, format: "iife", platform: "browser", target: "es2018", metafile: true });
        return { contents: result.outputFiles[0].text, loader: "text", watchFiles: Object.keys(result.metafile.inputs).map(file => path.resolve(file)) };
      });
    },
  }],
});
if (watch) await context.watch(); else { await context.rebuild(); await context.dispose(); }
