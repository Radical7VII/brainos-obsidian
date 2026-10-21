import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const temp = await mkdtemp(join(tmpdir(), 'brainos-layout-test-'));
const modulePath = join(temp, 'force-layout.mjs');
await build({ entryPoints: ['src/force-layout.ts'], bundle: true, platform: 'node', format: 'esm', outfile: modulePath, logLevel: 'silent' });
const { ForceLayout, forceOptionsFromSliders } = await import(pathToFileURL(modulePath).href);
await rm(temp, { recursive: true, force: true });
const node = (id, x = 0, y = 0) => ({ path: id, label: id, openPath: id, degree: 0, thoughts: [], x, y });
const edge = (from, to) => ({ from, to, thoughts: [] });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const run = (layout, nodes, count = 400) => { for (let index = 0; index < count; index++) layout.tick(nodes); };
const noForces = { centerStrength: 0, repelStrength: 0, linkStrength: 0 };

test('slider conversion is nonlinear and supplies the observed defaults', () => {
  const center = 1 - Math.log(0.1 * 0.99 + 0.01) / Math.log(0.01);
  const options = forceOptionsFromSliders({ center, repel: 10, link: 1, distance: 250 });
  assert.ok(Math.abs(options.centerStrength - 0.1) < 1e-12);
  assert.equal(options.repelStrength, 1000);
  assert.equal(options.linkStrength, 1);
  assert.equal(options.linkDistance, 250);
  assert.equal(forceOptionsFromSliders({ center: 0, repel: 0, link: 0, distance: 10 }).linkDistance, 30);
});

test('origin gravity moves a lone node instead of anchoring it at its saved centroid', () => {
  const nodes = [node('a', 500, 250)];
  const layout = new ForceLayout({ repelStrength: 0, linkStrength: 0 });
  layout.sync(nodes, [], {});
  run(layout, nodes, 20);
  assert.ok(Math.hypot(nodes[0].x, nodes[0].y) < 200);
});

test('springs approach the target distance while disconnected points stay apart', () => {
  const connected = [node('a', -500), node('b', 500)];
  const disconnected = connected.map(value => ({ ...value }));
  const layout = new ForceLayout({ centerStrength: 0, repelStrength: 0 });
  const control = new ForceLayout(noForces);
  layout.sync(connected, [edge('a', 'b')], {});
  control.sync(disconnected, [], {});
  run(layout, connected); run(control, disconnected);
  assert.ok(Math.abs(distance(...connected) - 250) < 2);
  assert.ok(distance(...disconnected) > 990);
});

test('near-field repulsion preserves symmetry and scales with inverse distance', () => {
  const measure = spacing => {
    const nodes = [node('a', -spacing / 2), node('b', spacing / 2)];
    const layout = new ForceLayout({ centerStrength: 0, linkStrength: 0, repelStrength: 1000 });
    layout.sync(nodes, [], {}); layout.tick(nodes);
    assert.ok(Math.abs(nodes[0].x + nodes[1].x) < 1e-10);
    return distance(...nodes) - spacing;
  };
  const near = measure(400), far = measure(800);
  assert.ok(near > 0);
  assert.ok(Math.abs(near / far - 2) < 0.01);
});

test('drag pin holds exactly and keeps neighbors active beyond the normal cooling period', () => {
  const nodes = [node('a', -125), node('b', 125)];
  const layout = new ForceLayout();
  layout.sync(nodes, [edge('a', 'b')], {});
  layout.pin('a', { x: 350, y: 200 });
  run(layout, nodes, 500);
  assert.deepEqual({ x: nodes[0].x, y: nodes[0].y }, { x: 350, y: 200 });
  assert.equal(layout.isRunning, true);
  layout.movePinned('a', { x: 700, y: -100 }); layout.tick(nodes);
  assert.deepEqual({ x: nodes[0].x, y: nodes[0].y }, { x: 700, y: -100 });
  layout.unpin('a'); run(layout, nodes);
  assert.equal(layout.isRunning, false);
  assert.ok(distance(nodes[0], { x: 700, y: -100 }) > 100);
});

test('metadata and input-order refresh preserve settled positions and do not reheat', () => {
  const nodes = [node('a'), node('b'), node('c')], edges = [edge('a', 'b'), edge('b', 'c')];
  const layout = new ForceLayout();
  layout.sync(nodes, edges, {}); run(layout, nodes);
  const before = layout.snapshot();
  assert.equal(layout.isRunning, false);
  layout.sync([...nodes].reverse(), [...edges].reverse(), {});
  layout.setSelected('b');
  assert.deepEqual(layout.snapshot(), before);
  assert.equal(layout.isRunning, false);
});

test('new connected nodes start near existing neighbors and existing nodes do not move during sync', () => {
  const nodes = [node('a', 900, -300)], layout = new ForceLayout();
  layout.sync(nodes, [], {});
  nodes.push(node('b'));
  layout.sync(nodes, [edge('a', 'b')], {});
  assert.deepEqual({ x: nodes[0].x, y: nodes[0].y }, { x: 900, y: -300 });
  assert.ok(distance(...nodes) >= 39 && distance(...nodes) <= 81);
});

test('coincident imports and a star graph remain finite without a normal speed clamp', () => {
  const nodes = Array.from({ length: 80 }, (_, index) => node(String(index)));
  const saved = Object.fromEntries(nodes.map(value => [value.path, { x: 0, y: 0 }]));
  const layout = new ForceLayout();
  layout.sync(nodes, nodes.slice(1).map(value => edge('0', value.path)), saved);
  run(layout, nodes);
  assert.equal(layout.isRunning, false);
  assert.ok(nodes.every(value => Number.isFinite(value.x) && Number.isFinite(value.y) && Math.hypot(value.x, value.y) < 10_000));
  assert.ok(new Set(nodes.map(value => `${value.x.toFixed(2)},${value.y.toFixed(2)}`)).size > 75);
});

test('reset discards old particles and invalid saved coordinates never leak into the simulation', () => {
  const nodes = [node('a'), node('b')], layout = new ForceLayout();
  layout.sync(nodes, [], { a: { x: NaN, y: Infinity }, b: { x: 1e20, y: 0 } });
  assert.ok(nodes.every(value => Number.isFinite(value.x) && Math.abs(value.x) < 10_000));
  layout.reset();
  assert.deepEqual(layout.snapshot(), {});
  assert.equal(layout.isRunning, false);
});

test('local drag moves neighbours, freezes distant areas, and settles after release',()=>{
  const nodes=[node('a',0,0),node('b',250,0),node('c',500,0),node('d',750,0),node('far',4000,800)];
  const edges=[edge('a','b'),edge('b','c'),edge('c','d')],saved=Object.fromEntries(nodes.map(n=>[n.path,{x:n.x,y:n.y}]));
  const layout=new ForceLayout();layout.sync(nodes,edges,saved,true);assert.equal(layout.isRunning,false);
  layout.pin('a',{x:0,y:0});layout.movePinned('a',{x:200,y:200});run(layout,nodes,35);
  assert.deepEqual({x:nodes[0].x,y:nodes[0].y},{x:200,y:200});
  assert.notDeepEqual({x:nodes[1].x,y:nodes[1].y},saved.b);assert.deepEqual({x:nodes[3].x,y:nodes[3].y},saved.d);
  assert.deepEqual({x:nodes[4].x,y:nodes[4].y},saved.far);
  layout.unpin('a');const released=layout.snapshot();run(layout,nodes,30);
  assert.notDeepEqual(layout.snapshot().a,released.a);assert.notDeepEqual(layout.snapshot().b,released.b);
  run(layout,nodes,500);assert.equal(layout.isRunning,false);assert.deepEqual(layout.snapshot().far,saved.far);
});
test('local long-distance drags stay finite and bound nearby displacement',()=>{
  const nodes=[node('a',0,0),node('b',250,0),node('far',4000,900)],layout=new ForceLayout();
  const saved=Object.fromEntries(nodes.map(n=>[n.path,{x:n.x,y:n.y}]));
  layout.sync(nodes,[edge('a','b')],saved,true);layout.pin('a',{x:0,y:0});layout.movePinned('a',{x:100000,y:-100000});
  const before={x:nodes[1].x,y:nodes[1].y};layout.tick(nodes);
  assert.ok(distance(nodes[1],before)<=8.001);assert.deepEqual(layout.snapshot().far,saved.far);
  layout.unpin('a');run(layout,nodes);assert.ok(nodes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
});
