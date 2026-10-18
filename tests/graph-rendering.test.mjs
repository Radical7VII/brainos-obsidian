import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/graph-rendering.ts", import.meta.url), "utf8");
const compiled = await transform(source, { loader: "ts", format: "esm", target: "es2018" });
const { nodeScreenRadius, graphLabelAlpha, approachOpacity, intersectsViewport, edgeInViewport,
  edgeStrokeKey, wrapGraphLabel } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);

test("node radius follows capped degree and square-root screen zoom", () => {
  assert.equal(nodeScreenRadius(0, 1), 8);
  assert.equal(nodeScreenRadius(100_000, 1), 30);
  assert.equal(nodeScreenRadius(0, 4), 16);
  assert.equal(nodeScreenRadius(0, 0.25), 4);
  assert.equal(nodeScreenRadius(0, 1, 2), 16);
  assert.equal(nodeScreenRadius(-50, 1), 8);
});

test("labels fade with zoom rather than graph node count", () => {
  assert.equal(graphLabelAlpha(0.25), 0);
  assert.equal(graphLabelAlpha(0.5), 0);
  assert.equal(graphLabelAlpha(1), 1);
  assert.equal(graphLabelAlpha(4), 1);
  assert.equal(graphLabelAlpha(1, 1), 0);
  assert.equal(graphLabelAlpha(2, 1), 1);
});

test("highlight opacity settles at 0.2 and returns to full opacity", () => {
  let value = 1;
  const first = approachOpacity(value, 0.2, 16.67);
  assert.ok(first < 1 && first > 0.2);
  for (let i = 0; i < 90; i++) value = approachOpacity(value, 0.2, 16.67);
  assert.equal(value, 0.2);
  for (let i = 0; i < 90; i++) value = approachOpacity(value, 1, 16.67);
  assert.equal(value, 1);
});

test("viewport culling keeps edges crossing screen with both endpoints outside", () => {
  assert.equal(edgeInViewport({ x: -100, y: 50 }, { x: 200, y: 50 }, 100, 100), true);
  assert.equal(edgeInViewport({ x: -100, y: -100 }, { x: -10, y: -10 }, 100, 100), false);
  assert.equal(intersectsViewport({ left: -4, right: 4, top: 40, bottom: 60 }, 100, 100), true);
  assert.equal(intersectsViewport({ left: 101, right: 105, top: 40, bottom: 60 }, 100, 100), false);
});

test("reciprocal edges share only their visual stroke identity", () => {
  assert.equal(edgeStrokeKey("A.md", "B.md"), edgeStrokeKey("B.md", "A.md"));
  assert.notEqual(edgeStrokeKey("a|b", "c"), edgeStrokeKey("a", "b|c"));
});

test("long labels wrap without truncating every title at 32 characters", () => {
  assert.deepEqual(wrapGraphLabel("学习过程中新的问题", value => Array.from(value).length, 4), ["学习过程", "中新的问", "题"]);
  assert.deepEqual(wrapGraphLabel("abcdefghijk", value => value.length, 3, 2), ["abc", "de…"]);
  const lines = wrapGraphLabel("😀😀😀", value => Array.from(value).length, 1, 1);
  assert.deepEqual(lines, ["…"]);
});
