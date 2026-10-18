import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:'export * from "./src/thought-document";export * from "./src/thought-store";export * from "./src/thoughts";export {TFile} from "obsidian";',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'obsidian',setup(b){
  b.onResolve({filter:/^obsidian$/},()=>({path:'mock',namespace:'test'}));
  b.onLoad({filter:/.*/,namespace:'test'},()=>({loader:'js',contents:`export class TFile{constructor(path){this.path=path;this.basename=path.split('/').pop().replace(/\\.md$/,'');this.extension='md';}}export const normalizePath=p=>p.replace(/\\/+/g,'/');`}));
}}]});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {TFile,parseThoughtDocument,insertDocumentNode,updateDocumentNode,insertDocumentRelation,documentLinks,nodeKey,createThought,createThoughtNode,editThoughtNode,readThoughtNode,referenceThoughtNode,linkThoughtNodes,unlinkThoughtNodes,removeThoughtNode,buildThoughtSnapshot}=api;
function fixture(){
  const files=new Map(),content=new Map(),created=[];const writes=[];
  const add=(path,text)=>{const file=new TFile(path);files.set(path,file);content.set(path,text);return file;};
  const app={vault:{getAbstractFileByPath:path=>files.get(path),getMarkdownFiles:()=>[...files.values()].filter(file=>file instanceof TFile),cachedRead:async file=>content.get(file.path),read:async file=>content.get(file.path),createFolder:async path=>files.set(path,{path}),create:async(path,text)=>{assert.ok(!files.has(path));created.push(path);return add(path,text);},process:async(file,edit)=>{const next=edit(content.get(file.path));content.set(file.path,next);writes.push(file.path);}},metadataCache:{getFileCache:file=>({frontmatter:content.get(file.path)?.includes('brainos_type: thought-file')?{brainos_type:'thought-file'}:{}}),getFirstLinkpathDest:(target,source)=>files.get(target)||files.get(target+'.md')||files.get(source.slice(0,source.lastIndexOf('/')+1)+target+'.md')}};
  return {app,files,content,created,writes,add};
}
const graphNode=(key,title)=>({path:key,label:title,ownerPath:key.split('#^')[0],nodeId:key.split('#^')[1],thoughts:[]});

test('node titles, multiline bodies and readable relationships survive Markdown round trips',()=>{
  let text='# 思考\n\n用户原有的说明。\n';
  text=insertDocumentNode(text,'node-a','起点 **与** 星号','第一段。\n\n### 正文标题\n\n- 一个列表\n- [[#^node-b|下一步]]');
  text=insertDocumentNode(text,'node-b','下一步','```md\n## 节点\n**代码示例** ^node-fake\n```');
  text=insertDocumentRelation(text,'#^node-a','起点','#^node-b','下一步');
  const doc=parseThoughtDocument(text);assert.equal(doc.nodes.length,2);assert.equal(doc.nodes[0].title,'起点 **与** 星号');
  assert.match(doc.nodes[0].body,/第一段。\n\n### 正文标题/);assert.equal(doc.relations.length,1);assert.match(text,/用户原有的说明/);
  const edited=updateDocumentNode(text,'node-b','新标题','新的正文');assert.match(edited,/用户原有的说明/);assert.match(edited,/\[\[#\^node-b\|下一步\]\]/);
  assert.equal(parseThoughtDocument(edited).nodes[1].title,'新标题');
});
test('duplicate IDs and stale node edits fail without overwriting user content',()=>{
  const text=insertDocumentNode('# 思考','node-a','A','原文');
  assert.throws(()=>insertDocumentNode(text,'node-a','A',''),/已存在/);
  assert.throws(()=>updateDocumentNode(text,'node-a','A','覆盖',{title:'A',body:'旧文'}),/其他位置修改/);
  assert.throws(()=>parseThoughtDocument(text+'\n**重复** ^node-a\n'),/标识重复/);
});
test('wikilinks, Markdown links and block embeds are indexed, code and external URLs are ignored',()=>{
  const text='[[#^node-a|A]] [B](Other%20note.md#%5Enode-b) ![[Other#^node-c]] `[[#^code]]`\n```md\n[[#^fenced]]\n```\n<!-- [[#^hidden]] -->\n[web](https://example.com)';
  assert.deepEqual(documentLinks(text).map(ref=>ref.target),['#^node-a','Other note.md#^node-b','Other#^node-c']);
});
test('creating many nodes creates exactly one thought MD; same-title nodes have independent identities',async()=>{
  const f=fixture();const file=await createThought(f.app,'未命名思考','思考');
  const keys=[];for(let index=0;index<20;index++)keys.push(await createThoughtNode(f.app,file.path,'同名节点','正文 '+index,index?{key:keys[index-1],title:'同名节点'}:undefined));
  assert.deepEqual(f.created,['思考/未命名思考.md']);assert.equal(new Set(keys).size,20);
  const text=f.content.get(file.path);assert.doesNotMatch(text,/brainos-state/);const doc=parseThoughtDocument(text);assert.equal(doc.nodes.length,20);assert.equal(doc.relations.length,19);
  const graph=await buildThoughtSnapshot(f.app,file);assert.equal(graph.nodes.length,20);assert.equal(graph.edges.length,19);
  assert.ok(graph.nodes.every(node=>node.ownerPath===file.path&&node.path.startsWith(file.path+'#^')));
});
test('ordinary Markdown gets embedded nodes without making any extra file or overwriting existing text',async()=>{
  const f=fixture(),file=f.add('普通笔记.md','# 普通笔记\n\n原来的内容。\n');
  const key=await createThoughtNode(f.app,file.path,'新想法','内嵌正文');assert.deepEqual(f.created,[]);
  const text=f.content.get(file.path);assert.match(text,/原来的内容。/);assert.match(text,/内嵌正文/);assert.match(text,/brainos_type: thought-file/);
  assert.equal((await readThoughtNode(f.app,key)).node.title,'新想法');
});
test('cross-thought reuse links the original node and edits are reflected without content duplication',async()=>{
  const f=fixture(),a=await createThought(f.app,'A','思考'),b=await createThought(f.app,'B','思考');
  const a1=await createThoughtNode(f.app,a.path,'出发点','A 的正文'),b1=await createThoughtNode(f.app,b.path,'共享观点','共享正文');
  await referenceThoughtNode(f.app,a.path,graphNode(b1,'共享观点'),graphNode(a1,'出发点'));
  assert.equal(f.created.length,2);assert.match(f.content.get(a.path),/\[\[思考\/B.md#\^node-/);assert.doesNotMatch(f.content.get(a.path),/共享正文/);
  let graph=await buildThoughtSnapshot(f.app,a);assert.equal(graph.nodes.length,2);assert.deepEqual(graph.edges.map(edge=>[edge.from,edge.to]),[[a1,b1]]);
  const original=await readThoughtNode(f.app,b1);await editThoughtNode(f.app,b1,'更新的共享观点','更新的共享正文',original.node);
  graph=await buildThoughtSnapshot(f.app,a);assert.equal(graph.nodes.find(node=>node.path===b1).label,'更新的共享观点');
  assert.equal((await readThoughtNode(f.app,b1)).node.body,'更新的共享正文');assert.doesNotMatch(f.content.get(a.path),/更新的共享正文/);
  await removeThoughtNode(f.app,a.path,b1);assert.equal((await buildThoughtSnapshot(f.app,a)).nodes.length,1);assert.equal((await readThoughtNode(f.app,b1)).node.title,'更新的共享观点');
});
test('two external nodes can be combined in a third thought without modifying either source',async()=>{
  const f=fixture(),a=await createThought(f.app,'A','思考'),b=await createThought(f.app,'B','思考'),c=await createThought(f.app,'C','思考');
  const b1=await createThoughtNode(f.app,b.path,'B1','正文B'),c1=await createThoughtNode(f.app,c.path,'C1','正文C');
  const beforeB=f.content.get(b.path),beforeC=f.content.get(c.path);
  await linkThoughtNodes(f.app,a.path,graphNode(b1,'B1'),graphNode(c1,'C1'));
  const graph=await buildThoughtSnapshot(f.app,a);assert.equal(graph.nodes.length,2);assert.equal(graph.edges.length,1);
  assert.equal(f.content.get(b.path),beforeB);assert.equal(f.content.get(c.path),beforeC);assert.equal(f.created.length,3);
});
test('unlinking preserves readable body text and deleting a middle node never bridges its neighbors',async()=>{
  const f=fixture(),file=await createThought(f.app,'A','思考');
  const a=await createThoughtNode(f.app,file.path,'A'),b=await createThoughtNode(f.app,file.path,'B','',{key:a,title:'A'}),c=await createThoughtNode(f.app,file.path,'C','',{key:b,title:'B'});
  await editThoughtNode(f.app,a,'A','正文 [[#^'+b.split('#^')[1]+'|B 的文字]]');
  await unlinkThoughtNodes(f.app,file.path,a,b);assert.match((await readThoughtNode(f.app,a)).node.body,/正文 B 的文字/);
  await linkThoughtNodes(f.app,file.path,graphNode(a,'A'),graphNode(b,'B'));await removeThoughtNode(f.app,file.path,b);
  const graph=await buildThoughtSnapshot(f.app,file);assert.equal(graph.nodes.length,2);assert.equal(graph.edges.length,0);assert.ok(!graph.edges.some(edge=>edge.from===a&&edge.to===c));
});
test('legacy thought imports external bodies only on first edit and leaves the original files intact',async()=>{
  const f=fixture();const old=f.add('旧思考.md','---\nbrainos_type: thought-file\n---\n# 旧思考\n\n保留的说明\n\n<!-- brainos-state\n'+JSON.stringify({paths:[{steps:[{atom:'A.md'},{atom:'B.md'}]}]})+'\n-->\n');
  f.add('A.md','# A\n\nA 的旧正文');f.add('B.md','# B\n\nB 的旧正文');
  const before=f.content.get(old.path);let graph=await buildThoughtSnapshot(f.app,old);assert.equal(graph.nodes.length,2);assert.equal(f.content.get(old.path),before);
  const key=await createThoughtNode(f.app,old.path,'新的节点','新的正文',{key:graph.nodes[1].path,title:'B'});
  const text=f.content.get(old.path);assert.match(text,/A 的旧正文/);assert.match(text,/B 的旧正文/);assert.match(text,/保留的说明/);assert.doesNotMatch(text,/brainos-state/);
  assert.equal(f.content.get('A.md'),'# A\n\nA 的旧正文');assert.equal(f.content.get('B.md'),'# B\n\nB 的旧正文');assert.equal(f.created.length,0);
  graph=await buildThoughtSnapshot(f.app,old);assert.equal(graph.nodes.length,3);assert.equal(graph.edges.length,2);assert.ok(graph.nodes.some(node=>node.path===key));
});
test('a missing cross-file block remains visibly unresolved and does not create a phantom file',async()=>{
  const f=fixture(),file=await createThought(f.app,'A','思考');
  await createThoughtNode(f.app,file.path,'A','[[Missing#^node-gone|失效的观点]]');
  const graph=await buildThoughtSnapshot(f.app,file);assert.ok(graph.nodes.some(node=>node.kind==='unresolved'&&node.label==='失效的观点'));assert.equal(f.created.length,1);
});
test('editing one node accepts concurrent edits to other nodes and rejects changes to the same node',async()=>{
  const f=fixture(),file=await createThought(f.app,'A','思考');
  const a=await createThoughtNode(f.app,file.path,'A','A0'),b=await createThoughtNode(f.app,file.path,'B','B0');const snapshot=(await readThoughtNode(f.app,a)).node;
  await editThoughtNode(f.app,b,'B','B1');await editThoughtNode(f.app,a,'A','A1',snapshot);
  assert.equal((await readThoughtNode(f.app,b)).node.body,'B1');await assert.rejects(()=>editThoughtNode(f.app,a,'A','覆盖',snapshot),/其他位置修改/);
  assert.equal((await readThoughtNode(f.app,a)).node.body,'A1');
});

test('handwritten bold paragraphs become nodes, and first edit adds reusable block anchors',async()=>{
  const f=fixture(),file=f.add('手写.md','# 手写\n\n## 节点\n\n**第一个观点**\n\n手写正文。\n\n**第二个观点**\n\n另一段正文。\n');
  const before=await buildThoughtSnapshot(f.app,file);assert.equal(before.nodes.length,2);assert.doesNotMatch(f.content.get(file.path),/\^node-/);
  const expected=(await readThoughtNode(f.app,before.nodes[0].path)).node;
  await editThoughtNode(f.app,before.nodes[0].path,'第一个观点','补充后的正文',expected);
  assert.match(f.content.get(file.path),/\*\*第一个观点\*\* \^node-/);assert.match(f.content.get(file.path),/\*\*第二个观点\*\* \^node-/);
  const after=await buildThoughtSnapshot(f.app,file);assert.deepEqual(after.nodes.map(node=>node.path),before.nodes.map(node=>node.path));
});
test('referencing an unanchored source persists its real block anchor so Obsidian can resolve the link',async()=>{
  const f=fixture(),source=f.add('源思考.md','---\nbrainos_type: thought-file\n---\n# 源\n\n## 节点\n\n**可复用的观点**\n\n正文。\n'),target=await createThought(f.app,'目标','思考');
  const node=(await buildThoughtSnapshot(f.app,source)).nodes[0];await referenceThoughtNode(f.app,target.path,node);
  assert.ok(f.content.get(source.path).includes('^'+node.nodeId));assert.ok(f.content.get(target.path).includes(source.path+'#^'+node.nodeId));assert.equal(f.created.length,1);
});
test('body heading links can be removed through the same graph edge as block links',async()=>{
  const f=fixture(),file=await createThought(f.app,'A','思考');const a=await createThoughtNode(f.app,file.path,'A','[[#B|正文里的 B]]'),b=await createThoughtNode(f.app,file.path,'B');
  assert.equal((await buildThoughtSnapshot(f.app,file)).edges.length,1);
  await unlinkThoughtNodes(f.app,file.path,a,b);assert.equal((await buildThoughtSnapshot(f.app,file)).edges.length,0);assert.match((await readThoughtNode(f.app,a)).node.body,/正文里的 B/);
});

test('legacy draft text is preserved and malformed legacy state is never overwritten',async()=>{
  const f=fixture(),file=f.add('草稿.md','# 草稿\n\n<!-- brainos-state\n{"paths":[],"draft":"尚未整理的重要草稿"}\n-->\n');
  await createThoughtNode(f.app,file.path,'整理后的想法');assert.match(f.content.get(file.path),/尚未整理的重要草稿/);
  const bad=f.add('损坏.md','# 损坏\n\n<!-- brainos-state\n{invalid}\n-->\n'),original=f.content.get(bad.path);
  await assert.rejects(()=>createThoughtNode(f.app,bad.path,'新节点'),/状态损坏/);assert.equal(f.content.get(bad.path),original);
});
