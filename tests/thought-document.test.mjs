import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {installNativeFileManager} from './native-file-manager.mjs';
const bundle=await build({stdin:{contents:'export * from "./src/thought-document";export * from "./src/thought-store";export * from "./src/thoughts";export {TFile} from "obsidian";',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'obsidian',setup(b){
  b.onResolve({filter:/^obsidian$/},()=>({path:'mock',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({loader:'js',contents:`export class TFile{constructor(path){this.path=path;this.basename=path.split('/').pop().replace(/\\.md$/,'');this.extension='md';}}export const normalizePath=p=>p.replace(/\\/+/g,'/');`}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {TFile,parseThoughtDocument,appendDocumentStep,appendDocumentContinuation,updateDocumentNode,titleID,nodeKey,
  documentLinks,createThought,createThoughtNode,editThoughtNode,readThoughtNode,referenceThoughtNode,
  linkThoughtNodes,unlinkThoughtNodes,removeThoughtNode,buildThoughtSnapshot,loadThoughtDocument}=api;
function fixture(){
  const files=new Map(),content=new Map(),created=[];const writes=[];
  const add=(path,text)=>{const file=new TFile(path);files.set(path,file);content.set(path,text);return file;};
  const app={vault:{getAbstractFileByPath:path=>files.get(path),getMarkdownFiles:()=>[...files.values()].filter(file=>file instanceof TFile),cachedRead:async file=>content.get(file.path),read:async file=>content.get(file.path),createFolder:async path=>files.set(path,{path}),create:async(path,text)=>{assert.ok(!files.has(path));created.push(path);return add(path,text);},process:async(file,edit)=>{const next=edit(content.get(file.path));content.set(file.path,next);writes.push(file.path);}},metadataCache:{getFileCache:file=>({frontmatter:content.get(file.path)?.includes('brainos_type: thought-file')?{brainos_type:'thought-file'}:{}}),getFirstLinkpathDest:(target,source)=>files.get(target)||files.get(target+'.md')||files.get(source.slice(0,source.lastIndexOf('/')+1)+target+'.md')}};
  installNativeFileManager(app);
  return {app,files,content,created,writes,add};
}

const graphNode=(key,title)=>({path:key,label:title,ownerPath:key.split('#brainos=')[0],nodeId:decodeURIComponent(key.split('#brainos=')[1]),thoughts:[]});
const names=doc=>doc.occurrences.map(visit=>visit.title);
const pairs=graph=>graph.edges.map(edge=>[graph.nodes.find(node=>node.path===edge.from).label,graph.nodes.find(node=>node.path===edge.to).label]);

test('plain list paths preserve chronology, revisits, floating roots, branches and later convergence',async()=>{
  const text='- A\n  第一次的说明。\n- B\n- C\n\n---\n\n- 独立想法\n\n---\n\n- A\n  回到这里补充。\n- D\n- C\n- 独立想法\n';
  const doc=parseThoughtDocument(text);
  assert.deepEqual(names(doc),['A','B','C','独立想法','A','D','C','独立想法']);
  assert.equal(doc.nodes.length,5);assert.equal(doc.paths.length,3);
  assert.deepEqual(doc.nodes.find(node=>node.title==='A').occurrences.map(visit=>visit.body),['第一次的说明。','回到这里补充。']);
  const f=fixture(),file=f.add('手写.md',text),graph=await buildThoughtSnapshot(f.app,file);
  assert.equal(graph.nodes.length,5);
  assert.deepEqual(pairs(graph),[['A','B'],['B','C'],['A','D'],['D','C'],['C','独立想法']]);
  assert.equal(graph.steps.length,8);assert.deepEqual(graph.steps.map(step=>step.pathIndex),[0,0,0,1,2,2,2,2]);
  assert.equal(f.writes.length,0);
});
test('blank lines are presentation only; an explicit separator breaks the chain',()=>{
  const doc=parseThoughtDocument('- A\n\n- B\n\n---\n\n- C\n- D');
  assert.deepEqual(doc.paths.map(path=>path.map(visit=>visit.title)),[['A','B'],['C','D']]);
  assert.equal(doc.relations.length,2);
});
test('multiline bodies can contain lists, headings, separators and code without becoming nodes',()=>{
  const body='第一段。\n\n### 正文标题\n\n- 正文列表\n  - 更深的列表\n\n---\n\n\x60\x60\x60md\n- 代码中的列表\n---\n\x60\x60\x60\n\n最后一段。';
  const text=appendDocumentStep(appendDocumentStep('','A',body),'B');
  const doc=parseThoughtDocument(text);
  assert.deepEqual(doc.nodes.map(node=>node.title),['A','B']);
  assert.equal(doc.nodes[0].body,body);assert.equal(doc.nodes[1].body,'');
  assert.equal(doc.paths.length,1);assert.equal(doc.relations.length,1);
});
test('code fences, comments and existing custom YAML are not structural steps',()=>{
  const text='---\ntags: [thought]\nexample: |\n  - not a node\n---\n\n<!--\n- hidden\n---\n-->\n\x60\x60\x60md\n- example\n---\n\x60\x60\x60\n- A\n- B\n';
  const doc=parseThoughtDocument(text);assert.deepEqual(names(doc),['A','B']);assert.equal(doc.paths.length,1);
  assert.deepEqual(names(parseThoughtDocument('---\n\n- A\n---\n- B')),['A','B']);
});
test('CRLF files, punctuation, emoji and whitespace preserve file-local names',()=>{
  const doc=parseThoughtDocument('- 一个想法：你好 👋  \r\n  正文。\r\n\r\n- 一个想法：你好 👋\r\n- 一个想法：你好\r\n');
  assert.equal(doc.nodes.length,2);assert.equal(doc.occurrences[0].body,'正文。');
  assert.equal(doc.nodes[0].occurrences.length,2);
  assert.deepEqual(api.splitNodeKey(nodeKey('文件#名.md',titleID('A # / % 👋'))),{file:'文件#名.md',id:titleID('A # / % 👋')});
});
test('new thoughts are empty Markdown at the exact configured folder or vault root',async()=>{
  const f=fixture();
  const root=await createThought(f.app,'',''),custom=await createThought(f.app,'设计','我的思考');
  assert.deepEqual(f.created,['未命名思考.md','我的思考/设计.md']);
  assert.equal(f.content.get(root.path),'');assert.equal(f.content.get(custom.path),'');
  assert.ok(!f.files.has('BrainOS'));assert.ok(!f.files.has('我的思考/Thoughts'));
  const duplicate=await createThought(f.app,'设计','我的思考');
  assert.equal(duplicate.path,'我的思考/设计 1.md');
  assert.equal(f.content.get(custom.path),'');
  await assert.rejects(()=>createThought(f.app,'无效','../外部'),/笔记库内/);
});
test('same-name creation reuses one node while preserving every visit and body',async()=>{
  const f=fixture(),file=await createThought(f.app,'思考','记录');
  const a=await createThoughtNode(f.app,file.path,'A','第一次');
  const b=await createThoughtNode(f.app,file.path,'B','',{key:a,title:'A'});
  const again=await createThoughtNode(f.app,file.path,'A','第二次',{key:b,title:'B'});
  assert.equal(a,again);assert.equal(f.created.length,1);
  const text=f.content.get(file.path),doc=parseThoughtDocument(text);
  assert.deepEqual(names(doc),['A','B','A']);assert.equal(doc.nodes.length,2);
  assert.doesNotMatch(text,/brainos_type|brainos_version|brainos-state|\^node-|## 节点|\*\*/);
  assert.deepEqual(pairs(await buildThoughtSnapshot(f.app,file)),[['A','B'],['B','A']]);
  assert.equal((await readThoughtNode(f.app,a,0)).node.body,'第一次');
  assert.equal((await readThoughtNode(f.app,a,1)).node.body,'第二次');
});
test('graph creation extends, floats, revisits an old source, and merges by name',async()=>{
  const f=fixture(),file=await createThought(f.app,'思考','');
  const a=await createThoughtNode(f.app,file.path,'A');
  await createThoughtNode(f.app,file.path,'B','',{key:a,title:'A'});
  const floating=await createThoughtNode(f.app,file.path,'浮动');
  assert.deepEqual(pairs(await buildThoughtSnapshot(f.app,file)),[['A','B']]);
  const d=await createThoughtNode(f.app,file.path,'D','',{key:a,title:'A'});
  const merged=await createThoughtNode(f.app,file.path,'浮动','',{key:d,title:'D'});
  assert.equal(floating,merged);
  const doc=parseThoughtDocument(f.content.get(file.path));
  assert.deepEqual(doc.paths.map(path=>path.map(visit=>visit.title)),[['A','B'],['浮动'],['A','D','浮动']]);
  assert.deepEqual(pairs(await buildThoughtSnapshot(f.app,file)),[['A','B'],['A','D'],['D','浮动']]);
});
test('a forced branch starts a new path even when its source is the current tail',async()=>{
  const f=fixture(),file=f.add('分支.md','- A\n');
  await createThoughtNode(f.app,file.path,'B','',{key:nodeKey(file.path,titleID('A')),title:'A',newPath:true});
  assert.deepEqual(parseThoughtDocument(f.content.get(file.path)).paths.map(path=>path.map(v=>v.title)),[['A'],['A','B']]);
});
test('a trailing separator remains a boundary when continuing from an earlier node',()=>{
  const text=appendDocumentContinuation('- A\n\n---\n\n这里是说明。\n','A','B');
  assert.deepEqual(parseThoughtDocument(text).paths.map(path=>path.map(v=>v.title)),[['A'],['A','B']]);
});
test('renaming updates every occurrence and editing one visit preserves other visit bodies',async()=>{
  const f=fixture(),file=f.add('多次.md','- A\n  初次正文。\n- B\n\n---\n\n- A\n  再次正文。\n- C\n');
  const key=nodeKey(file.path,titleID('A')),before=await readThoughtNode(f.app,key,0);
  const renamed=await editThoughtNode(f.app,key,'新的 A','更新初次正文。',before.node);
  const doc=parseThoughtDocument(f.content.get(file.path));
  assert.deepEqual(names(doc),['新的 A','B','新的 A','C']);
  assert.deepEqual(doc.nodes.find(node=>node.title==='新的 A').occurrences.map(v=>v.body),['更新初次正文。','再次正文。']);
  assert.equal((await readThoughtNode(f.app,renamed,1)).node.body,'再次正文。');
  const original=f.content.get(file.path);
  await assert.rejects(()=>editThoughtNode(f.app,renamed,'B',''),/已属于另一个节点/);
  assert.equal(f.content.get(file.path),original);
});
test('concurrent edits elsewhere are allowed, but changed or extra visits to the edited node are rejected',async()=>{
  const f=fixture(),file=f.add('并发.md','- A\n  A0\n- B\n  B0\n');
  const a=nodeKey(file.path,titleID('A')),b=nodeKey(file.path,titleID('B')),snapshot=(await readThoughtNode(f.app,a)).node;
  await editThoughtNode(f.app,b,'B','B1');await editThoughtNode(f.app,a,'A','A1',snapshot);
  await assert.rejects(()=>editThoughtNode(f.app,a,'A','覆盖',snapshot),/其他位置修改/);
  const latest=(await readThoughtNode(f.app,a)).node;
  await createThoughtNode(f.app,file.path,'A');
  await assert.rejects(()=>editThoughtNode(f.app,a,'A','覆盖',latest),/其他位置修改/);
  assert.equal((await readThoughtNode(f.app,a,0)).node.body,'A1');
  assert.equal((await readThoughtNode(f.app,b)).node.body,'B1');
});
test('unlinking splits every occurrence of an edge without losing prose or other edges',async()=>{
  const f=fixture(),file=f.add('断开.md','- A\n  第一次正文\n- B\n- C\n\n---\n\n- A\n  第二次正文\n- B\n');
  await unlinkThoughtNodes(f.app,file.path,nodeKey(file.path,titleID('A')),nodeKey(file.path,titleID('B')));
  assert.deepEqual(pairs(await buildThoughtSnapshot(f.app,file)),[['B','C']]);
  const doc=parseThoughtDocument(f.content.get(file.path));assert.equal(doc.occurrences.length,5);
  assert.deepEqual(doc.nodes.find(node=>node.title==='A').occurrences.map(v=>v.body),['第一次正文','第二次正文']);
});
test('deleting every visit of a middle node never connects its former neighbors',async()=>{
  const f=fixture(),file=f.add('删除.md','- A\n- B\n  B正文\n- C\n\n---\n\n- D\n- B\n- E\n');
  await removeThoughtNode(f.app,file.path,nodeKey(file.path,titleID('B')));
  const graph=await buildThoughtSnapshot(f.app,file);
  assert.deepEqual(graph.nodes.map(node=>node.label),['A','C','D','E']);assert.equal(graph.edges.length,0);
  assert.doesNotMatch(f.content.get(file.path),/B正文/);
});
test('ordinary notes keep prose and custom metadata without acquiring plugin properties',async()=>{
  const f=fixture(),file=f.add('普通笔记.md','---\ntags: [my-tag]\n---\n\n# 原标题\n\n原有说明。\n');
  const key=await createThoughtNode(f.app,file.path,'新想法','内嵌正文'),text=f.content.get(file.path);
  assert.match(text,/tags: \[my-tag\]/);assert.match(text,/原有说明。/);assert.doesNotMatch(text,/brainos_type|\^node-|## 节点/);
  assert.equal((await readThoughtNode(f.app,key)).node.body,'内嵌正文');assert.equal(f.created.length,0);
});
test('cross-file reuse never copies bodies or writes IDs, and plugin rename maintains incoming links',async()=>{
  const f=fixture(),a=await createThought(f.app,'A','思考'),b=await createThought(f.app,'B','思考');
  const a1=await createThoughtNode(f.app,a.path,'起点'),b1=await createThoughtNode(f.app,b.path,'共享观点','原始正文');
  const before=f.content.get(b.path);
  await referenceThoughtNode(f.app,a.path,graphNode(b1,'共享观点'),graphNode(a1,'起点'));
  assert.equal(f.content.get(b.path),before);assert.match(f.content.get(a.path),/\[\[思考\/B.md\|共享观点\]\]/);
  assert.doesNotMatch(f.content.get(a.path),/原始正文|\^node-/);
  let graph=await buildThoughtSnapshot(f.app,a);assert.deepEqual(pairs(graph),[['起点','共享观点']]);
  const original=await readThoughtNode(f.app,b1),renamed=await editThoughtNode(f.app,b1,'更新的观点','更新正文',original.node);
  graph=await buildThoughtSnapshot(f.app,a);
  assert.ok(graph.nodes.some(node=>node.path===renamed&&node.label==='更新的观点'));
  assert.match(f.content.get(a.path),/更新的观点/);assert.doesNotMatch(f.content.get(a.path),/更新正文/);
  await removeThoughtNode(f.app,a.path,renamed);
  assert.equal((await buildThoughtSnapshot(f.app,a)).nodes.length,1);
  assert.equal((await readThoughtNode(f.app,renamed)).node.body,'更新正文');
});
test('external nodes can form a path in a third file without modifying either source',async()=>{
  const f=fixture(),a=await createThought(f.app,'A',''),b=await createThought(f.app,'B',''),c=await createThought(f.app,'C','');
  const b1=await createThoughtNode(f.app,b.path,'B1','正文B'),c1=await createThoughtNode(f.app,c.path,'C1','正文C');
  const beforeB=f.content.get(b.path),beforeC=f.content.get(c.path);
  await linkThoughtNodes(f.app,a.path,graphNode(b1,'B1'),graphNode(c1,'C1'));
  assert.deepEqual(pairs(await buildThoughtSnapshot(f.app,a)),[['B1','C1']]);
  assert.equal(f.content.get(b.path),beforeB);assert.equal(f.content.get(c.path),beforeC);
  await unlinkThoughtNodes(f.app,a.path,b1,c1);assert.equal((await buildThoughtSnapshot(f.app,a)).edges.length,0);
});
test('body links remain readable on unlink, while code links stay inert',async()=>{
  const f=fixture(),file=f.add('正文链接.md','- A\n  正文 [[#B|B 的文字]] 和 \x60[[#C]]\x60\n\n---\n\n- B\n');
  const a=nodeKey(file.path,titleID('A')),b=nodeKey(file.path,titleID('B'));
  assert.deepEqual(pairs(await buildThoughtSnapshot(f.app,file)),[['A','B']]);
  await unlinkThoughtNodes(f.app,file.path,a,b);
  assert.equal((await buildThoughtSnapshot(f.app,file)).edges.length,0);
  assert.match((await readThoughtNode(f.app,a)).node.body,/正文 B 的文字/);
});
test('ordinary file aliases stay file links; missing node references remain unresolved without creating files',async()=>{
  const f=fixture(),file=f.add('链接.md','- A\n  [[普通笔记|阅读它]]\n\n---\n\n- [[Missing.md|失效观点]]\n');
  f.add('普通笔记.md','# 普通笔记');
  const graph=await buildThoughtSnapshot(f.app,file);
  assert.ok(graph.nodes.some(node=>node.path==='普通笔记.md'&&node.kind==='note'));
  assert.ok(graph.nodes.some(node=>node.label==='失效观点'&&node.kind==='unresolved'));assert.equal(f.created.length,0);
});
test('global discovery recognizes unmarked lists and keeps same names in different files separate',async()=>{
  const f=fixture();f.add('A.md','- 同名\n- B\n');f.add('B.md','- 同名\n');f.add('普通.md','# 普通笔记\n正文。');
  const graph=await buildThoughtSnapshot(f.app);
  assert.deepEqual(graph.thoughts.map(thought=>thought.path),['A.md','B.md']);
  assert.equal(graph.nodes.filter(node=>node.label==='同名').length,2);assert.equal(f.writes.length,0);
});
test('old paragraphs migrate only on write, preserve duplicate identities and never infer adjacency',async()=>{
  const f=fixture(),file=f.add('旧格式.md','---\nbrainos_type: thought-file\nbrainos_version: 2\nid: old-id\ntags: [keep]\n---\n\n# 原标题\n\n保留说明。\n\n## 节点\n\n**同名** ^node-a\n\n第一份正文。\n\n**同名** ^node-b\n\n第二份正文。\n\n## 关系\n\n- [[#^node-a|同名]] → [[#^node-b|同名]]\n');
  const before=f.content.get(file.path),graph=await buildThoughtSnapshot(f.app,file);
  assert.equal(f.content.get(file.path),before);assert.equal(graph.nodes.length,2);assert.equal(graph.edges.length,1);
  assert.deepEqual(graph.nodes.map(node=>node.label),['同名','同名（2）']);
  await createThoughtNode(f.app,file.path,'新想法');
  const text=f.content.get(file.path);assert.match(text,/第一份正文/);assert.match(text,/第二份正文/);
  assert.match(text,/tags: \[keep\]/);assert.match(text,/保留说明/);
  assert.doesNotMatch(text,/brainos_type|brainos_version|id: old-id|\^node-|## 节点|## 关系/);
  assert.equal((await buildThoughtSnapshot(f.app,file)).edges.length,1);
});
test('old state paths retain repeated visits, independent roots, drafts and original node files',async()=>{
  const f=fixture(),file=f.add('旧状态.md','# 旧状态\n说明。\n<!-- brainos-state\n'+JSON.stringify({paths:[{steps:[{atom:'A.md'},{atom:'B.md'},{atom:'A.md'}]},{steps:[{atom:'独立.md'}]}],draft:'重要草稿'})+'\n-->\n');
  f.add('A.md','# A\nA 的正文');f.add('B.md','# B\nB 的正文');f.add('独立.md','# 独立\n独立正文');
  const original=f.content.get(file.path),loaded=await loadThoughtDocument(f.app,file);
  assert.deepEqual(names(loaded.doc),['A','B','A','独立']);assert.equal(loaded.doc.paths.length,2);
  assert.equal(f.content.get(file.path),original);
  await createThoughtNode(f.app,file.path,'新节点');
  const text=f.content.get(file.path);assert.match(text,/重要草稿/);assert.match(text,/A 的正文/);assert.doesNotMatch(text,/brainos-state/);
  assert.equal(f.content.get('A.md'),'# A\nA 的正文');assert.equal(f.created.length,0);
});
test('malformed state and legacy conversion races never overwrite content',async()=>{
  const f=fixture(),bad=f.add('损坏.md','<!-- brainos-state\n{invalid}\n-->\n'),before=f.content.get(bad.path);
  await assert.rejects(()=>createThoughtNode(f.app,bad.path,'新节点'),/状态损坏/);assert.equal(f.content.get(bad.path),before);
  const legacy=f.add('竞争.md','## 节点\n\n**旧节点** ^node-a\n\n正文'),process=f.app.vault.process;
  f.app.vault.process=async(file,edit)=>{f.content.set(file.path,f.content.get(file.path)+'\n刚刚追加的内容。');return process(file,edit);};
  await assert.rejects(()=>createThoughtNode(f.app,legacy.path,'新节点'),/转换期间已变化/);
  assert.match(f.content.get(legacy.path),/刚刚追加/);assert.match(f.content.get(legacy.path),/\^node-a/);
});
test('unclosed code or comment tails never swallow a new node silently',async()=>{
  const f=fixture(),file=f.add('未闭合.md','- A\n  \x60\x60\x60md\n  未闭合代码\n'),before=f.content.get(file.path);
  await assert.rejects(()=>createThoughtNode(f.app,file.path,'B'),/尚未闭合/);assert.equal(f.content.get(file.path),before);
});
test('migrating a source maintains existing aliased and unaliased block references',async()=>{
  const f=fixture(),source=f.add('来源.md','## 节点\n\n**源节点** ^node-old\n\n原正文。\n');
  const target=f.add('引用.md','- [[来源.md#^node-old|源节点]]\n');
  const plain=f.add('普通引用.md','- 阅读\n  [[来源.md#^node-old]]\n');
  const before=f.content.get(source.path);
  assert.ok((await buildThoughtSnapshot(f.app,target)).nodes.some(node=>node.label==='源节点'));
  assert.equal(f.content.get(source.path),before);
  await createThoughtNode(f.app,source.path,'另一个想法');
  assert.doesNotMatch(f.content.get(source.path),/\^node-/);
  assert.match(f.content.get(target.path),/\[\[来源.md#源节点\|源节点\]\]/);
  assert.match(f.content.get(plain.path),/\[\[来源.md#源节点\|源节点\]\]/);
  assert.ok((await buildThoughtSnapshot(f.app,target)).nodes.some(node=>node.nodeId===titleID('源节点')));
});
test('unaliased file-list entries remain whole-file references',async()=>{
  const f=fixture(),file=f.add('文件列表.md','- [[普通笔记.md]]\n');f.add('普通笔记.md','# 普通笔记');
  const graph=await buildThoughtSnapshot(f.app,file);
  assert.equal(graph.nodes.length,1);assert.equal(graph.nodes[0].path,'普通笔记.md');assert.equal(graph.nodes[0].kind,'note');
});
test('an unclosed body edit cannot hide later visits, and inline code comments stay literal',async()=>{
  const f=fixture(),file=f.add('正文.md','- A\n  讨论 \x60<!--\x60 这段代码。\n- B\n');
  const a=nodeKey(file.path,titleID('A')),before=f.content.get(file.path);
  assert.equal((await buildThoughtSnapshot(f.app,file)).nodes.length,2);
  await assert.rejects(()=>editThoughtNode(f.app,a,'A','\x60\x60\x60md\n未闭合'),/遮蔽后续记录/);
  assert.equal(f.content.get(file.path),before);
});
test('ordinary repeated section names and Chinese custom YAML do not trigger legacy migration',async()=>{
  const f=fixture(),file=f.add('普通.md','---\n标签: [保留]\n---\n\n## 关系\n说明。\n\n## 关系\n另一段说明。\n\n- A\n');
  await createThoughtNode(f.app,file.path,'B','',{key:nodeKey(file.path,titleID('A')),title:'A'});
  assert.match(f.content.get(file.path),/标签: \[保留\]/);
  assert.equal((await buildThoughtSnapshot(f.app,file)).nodes.length,2);
});
test('legacy region introductions and empty-region prose survive conversion',async()=>{
  const f=fixture(),file=f.add('区域说明.md','## 节点\n\n节点前的重要说明。\n\n**A** ^node-a\n\n正文。\n');
  await createThoughtNode(f.app,file.path,'B');
  assert.match(f.content.get(file.path),/节点前的重要说明。/);
  const empty=f.add('空区域.md','## 节点\n\n尚未开始的草稿。\n');
  await createThoughtNode(f.app,empty.path,'第一个想法');
  assert.match(f.content.get(empty.path),/尚未开始的草稿。/);
});
