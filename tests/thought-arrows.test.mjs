import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: 'export * from "./src/thought-document"; export * from "./src/thought-lanes";', resolveDir: process.cwd() }, bundle: true, write: false, format: 'esm', platform: 'node' });
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const { parseThoughtDocument: parse, parseLegacyListDocument: old, convertListPathsToArrows: convert, titleID: id, buildThoughtLanes: lanes } = api;
const edges = doc => doc.relations.map(e => [e.from, e.to]);

test('explicit arrows alone create edges; adjacency, blank lines and separators never do', () => {
  assert.deepEqual(edges(parse('- A\n\n- B\n\n---\n\n- C\n')), []);
  const doc = parse('- A\n  正文\n  → B\n  → C\n\n- B\n  - to: D\n\n- C\n  → D\n\n- D\n');
  assert.equal(doc.nodes.length, 4);
  assert.deepEqual(edges(doc), [[id('A'), id('B')], [id('A'), id('C')], [id('B'), id('D')], [id('C'), id('D')]]);
  assert.equal(doc.nodes[0].body, '正文');
});

test('fenced code, comments, nested lists and quoted arrows remain body text', () => {
  const body = '```md\n→ 代码\n```\n<!--\n→ 注释\n-->\n- 子列表\n  → 嵌套\n\\→ 普通正文';
  const text = api.appendDocumentStep('', 'A', body, true);
  const doc = parse(text);
  assert.deepEqual(edges(doc), []); assert.equal(doc.nodes[0].body, body);
});

test('conversion preserves branching, revisits, merges, isolated nodes and every body', () => {
  const input = '- A\n  初次\n- B\n- C\n\n---\n\n- A\n  回访\n- D\n- C\n\n---\n\n- 独立\n';
  const text = convert(input), before = old(input), after = parse(text);
  assert.doesNotMatch(text, /^---$/m);
  assert.deepEqual(edges(after), edges(before));
  assert.deepEqual(after.occurrences.map(v => [v.id, v.body]), before.occurrences.map(v => [v.id, v.body]));
  assert.throws(() => convert(text), /已包含箭头/);
});

test('conversion preserves YAML, body separators and code; malformed input is not silently accepted', () => {
  const input = '---\ntags: [keep]\n---\n\n# 标题\n\n- A\n  ---\n  ```md\n  ---\n  - 原样\n  ```\n- B\n';
  const text = convert(input);
  assert.ok(text.startsWith('---\ntags: [keep]\n---\n\n# 标题'));
  assert.equal(parse(text).nodes[0].body, old(input).nodes[0].body);
  assert.equal(parse(text).relations.length, 1);
});

test('arrow targets may be undeclared or cross-file without inventing occurrences', () => {
  const doc = parse('- A\n  → 尚未展开\n  → [[别的思考.md|来源节点]]\n');
  assert.equal(doc.occurrences.length, 1); assert.equal(doc.nodes.length, 3);
  assert.equal(doc.nodes[1].occurrences.length, 0);
  assert.equal(doc.nodes[2].target, '别的思考.md');
  assert.equal(doc.nodes[0].body, '');
});

test('rename updates all incoming arrows; deletion and unlink never reintroduce adjacency', () => {
  let text = '- A\n  → B\n\n- B\n  正文\n  → C\n\n- C\n  → B\n';
  text = api.updateDocumentNode(text, id('B'), '新 B', undefined);
  assert.equal(parse(text).relations.filter(e => e.to === id('新 B')).length, 2);
  assert.equal(parse(text).nodes.find(n => n.title === '新 B').body, '正文');
  text = api.removeDocumentNode(text, id('新 B'));
  assert.deepEqual(edges(parse(text)), []); assert.doesNotMatch(text, /新 B|---/);
  assert.deepEqual(parse(text).occurrences.map(v => v.title), ['A', 'C']);
});

test('editing one repeated body preserves its outgoing edges and the other body', () => {
  const text = '- A\n  一\n  → B\n\n- B\n  → A\n\n- A\n  二\n  → C\n\n- C\n';
  const doc = parse(text), node = doc.nodes.find(n => n.title === 'A');
  const updated = api.updateDocumentNode(text, id('A'), 'A', '修改一', { title: 'A', body: '一', ordinal: 0, revision: api.nodeRevision(node) });
  assert.deepEqual(edges(parse(updated)), edges(doc));
  assert.deepEqual(parse(updated).nodes.find(n => n.title === 'A').occurrences.map(v => v.body), ['修改一', '二']);
});

test('node names containing replacement tokens remain literal when renamed', () => {
  const text = api.updateDocumentNode('- A\n  → B\n\n- B\n', id('B'), '$& 新名称', undefined);
  assert.equal(parse(text).occurrences[1].title, '$& 新名称');
  assert.equal(parse(text).relations[0].to, id('$& 新名称'));
});

test('lane allocation separates live branches and merges them into one row', () => {
  const doc = parse('- A\n  → B\n  → C\n\n- B\n  → D\n\n- C\n  → D\n\n- D\n');
  const layout = lanes(doc);
  assert.equal(layout.edges.length, 4); assert.equal(layout.laneCount, 2);
  assert.notEqual(layout.rows[1].lane, layout.rows[2].lane);
  assert.equal(layout.edges.filter(e => e.to === 3).length, 2);
  assert.deepEqual(lanes(doc), layout);
});

test('revisits have distinct rows and backward-only edges become return links', () => {
  const doc = parse('- A\n  → B\n\n- B\n  → A\n\n- A\n  再次\n  → B\n');
  const layout = lanes(doc);
  assert.equal(layout.rows.length, 3);
  assert.equal(layout.rows[2].revisit, 0);
  assert.deepEqual(layout.rows[2].returns, [1]);
  assert.deepEqual(layout.edges.map(e => [e.from, e.to]), [[0, 1], [1, 2]]);
});

test('insertion can target a nonadjacent explicit incoming edge', () => {
  const text = '- A\n  → C\n\n- 独立\n\n- C\n';
  const result = api.insertDocumentStepBefore(text, 2, '中间', id('A'));
  assert.deepEqual(edges(parse(result)), [[id('A'), id('中间')], [id('中间'), id('C')]]);
  assert.equal(parse(result).occurrences.length, 4);
});

test('up and down follow visible row order across branches and disconnected nodes', () => {
  const layout = lanes(parse('- A\n  → C\n\n- 独立\n\n- C\n  → A\n'));
  assert.equal(api.navigateThoughtLanes(layout, 0, 'ArrowDown'), 1);
  assert.equal(api.navigateThoughtLanes(layout, 1, 'ArrowDown'), 2);
  assert.equal(api.navigateThoughtLanes(layout, 2, 'ArrowUp'), 1);
  assert.equal(api.navigateThoughtLanes(layout, 1, 'ArrowUp'), 0);
  assert.equal(api.navigateThoughtLanes(layout, 0, 'ArrowUp'), 0);
  assert.equal(api.navigateThoughtLanes(layout, 2, 'ArrowDown'), 2);
});

test('list navigation neither switches sideways nor follows cycle return links', () => {
  const layout = lanes(parse('- A\n  → B\n  → C\n\n- B\n\n- C\n  → A\n'));
  for (let index = 0; index < layout.rows.length; index++) {
    for (const key of ['ArrowLeft', 'ArrowRight']) assert.equal(api.navigateThoughtLanes(layout, index, key), index);
  }
  assert.equal(api.navigateThoughtLanes(layout, 2, 'ArrowDown'), 2);
  assert.equal(api.navigateThoughtLanes({ rows: [] }, 0, 'ArrowDown'), 0);
});

test('reading projection merges repeated records into one branching node without changing stored visits', () => {
  const doc = parse('- A\n  初次\n  → B\n\n- B\n\n- A\n  补充\n  → C\n\n- C\n  → D\n\n- B\n  → D\n\n- D\n');
  const before = JSON.stringify(doc);
  const projection = api.projectThoughtNodes(doc, 0), layout = lanes(projection.doc);
  assert.deepEqual(projection.doc.occurrences.map(v => v.title), ['A', 'B', 'C', 'D']);
  assert.equal(projection.sourceIndices[0], 0);
  assert.equal(layout.edges.filter(e => e.from === 0).length, 2);
  assert.equal(layout.edges.filter(e => e.to === 3).length, 2);
  assert.equal(layout.laneCount, 2);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(doc.nodes[0].occurrences.map(v => v.body), ['初次', '补充']);
});

test('reading projection moves an earlier merge after its parents and retains cycle return links', () => {
  const doc = parse('- 合并\n\n- A\n  → 合并\n\n- B\n  → 合并\n');
  assert.deepEqual(api.projectThoughtNodes(doc).doc.occurrences.map(v => v.title), ['A', 'B', '合并']);
  const cycle = api.projectThoughtNodes(parse('- A\n  → B\n\n- B\n  → A\n\n- A\n  后来\n')).doc;
  assert.equal(cycle.occurrences.length, 2);
  assert.deepEqual(lanes(cycle).rows[1].returns, [0]);
});

test('projection preserves independent roots, duplicate relations, self loops and unresolved targets', () => {
  const doc = parse('- 合并\n  → 合并\n\n- A\n  → 合并\n  → 尚未定义\n\n- B\n  → 合并\n\n- A\n  补充\n  → 合并\n\n- 独立\n');
  const projected = api.projectThoughtNodes(doc);
  assert.deepEqual(projected.doc.occurrences.map(v => v.title), ['A', 'B', '合并', '独立']);
  assert.equal(projected.doc.occurrences[0].body, '补充');
  assert.equal(projected.doc.relations.filter(e => e.from === id('A') && e.to === id('合并')).length, 1);
  const layout = lanes(projected.doc);
  assert.deepEqual(layout.rows[0].missing, ['尚未定义']);
  assert.deepEqual(layout.rows[2].returns, [2]);
  assert.equal(api.projectThoughtNodes(doc, 1).sourceIndices[0], 1);
});

test('long reverse-ordered thoughts place every parent before its successor without changing records', () => {
  const count = 1200;
  const doc = parse(Array.from({ length: count }, (_, i) => {
    const n = count - i - 1;
    return `- 节点${n}\n${n + 1 < count ? `  → 节点${n + 1}\n` : ''}`;
  }).join('\n'));
  const projection = api.projectThoughtNodes(doc);
  assert.deepEqual(projection.doc.occurrences.map(v => v.title), Array.from({ length: count }, (_, i) => `节点${i}`));
  assert.equal(projection.doc.relations.length, count - 1);
  assert.equal(doc.occurrences[0].title, `节点${count - 1}`);
});
