import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import {installNativeFileManager} from './native-file-manager.mjs';
const bundle = await build({
  stdin: { contents: 'export * from "./src/vault-graph"; export * from "./src/graph-options"; export * from "./src/thoughts"; export {TFile} from "obsidian";', resolveDir: process.cwd() },
  bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'silent',
  plugins: [{ name: 'obsidian-test', setup(b) {
    b.onResolve({filter: /^obsidian$/}, () => ({path:'mock',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'}, () => ({contents: `
      export class TFile { constructor(path) {this.path=path;this.extension=path.split('.').pop();this.basename=path.split('/').pop().replace(/\\.[^.]+$/,'');this.parent={path:path.includes('/')?path.slice(0,path.lastIndexOf('/')):''};} }
      export const normalizePath = path => path.replace(/\\/+/g,'/');
      export const getAllTags = cache => cache.tags?.map(t=>t.tag) ?? null;
    `,loader:'js'}));
  }}],
});
const {TFile,buildVaultSnapshot,selectGraph,defaultGraphOptions,loadGraphOptions,createThought,buildSnapshot} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function fixture() {
  const files = ['A.md','B.md','folder/C.md','island.md','image.png'].map(path=>new TFile(path));
  const cache = { 'A.md':{tags:[{tag:'#shared'}]},'folder/C.md':{tags:[{tag:'#shared'}]} };
  const map = new Map(files.map(f=>[f.path,f]));
  const app = {
    vault:{ getMarkdownFiles:()=>files.filter(f=>f.extension==='md'), getAbstractFileByPath:path=>map.get(path),
      createFolder: async path=>map.set(path,{path}), create:async(path,text)=>{const f=new TFile(path);map.set(path,f);f.text=text;return f;} },
    metadataCache:{resolvedLinks:{'A.md':{'B.md':4,'image.png':1},'B.md':{'A.md':2,'folder/C.md':1}},unresolvedLinks:{'A.md':{'Missing':3}},getFileCache:f=>cache[f.path]??{}},
  };
  installNativeFileManager(app);
  return {app,files};
}
test('vault graph uses cached links, folds reference counts and retains direction',()=>{
  const {app}=fixture(), options=defaultGraphOptions();
  const graph=buildVaultSnapshot(app,[],options.filter);
  assert.equal(graph.nodes.length,5);
  assert.equal(graph.edges.length,4);
  assert.equal(graph.nodes.find(n=>n.path==='A.md').degree,3);
  assert.ok(graph.nodes.some(n=>n.kind==='unresolved'));
  assert.ok(!graph.nodes.some(n=>n.kind==='attachment'||n.kind==='tag'));
});
test('tags and attachments are opt in, orphans are removed after filtering',()=>{
  const {app}=fixture(), options=defaultGraphOptions();
  options.filter.showTags=true;options.filter.showAttachments=true;options.filter.showOrphans=false;
  const graph=selectGraph(buildVaultSnapshot(app,[],options.filter),'',options.filter);
  assert.ok(graph.nodes.some(n=>n.kind==='attachment'));
  assert.ok(graph.nodes.some(n=>n.path==='#shared'));
  assert.ok(!graph.nodes.some(n=>n.path==='island.md'));
});
test('local neighborhood expands one round at a time and respects edge directions',()=>{
  const {app}=fixture(), options=defaultGraphOptions();options.filter.showUnresolved=false;
  const full=buildVaultSnapshot(app,[],options.filter);
  const one=selectGraph(full,'',options.filter,'A.md');
  assert.deepEqual(one.nodes.map(n=>n.path).sort(),['A.md','B.md']);
  assert.equal(one.nodes.find(n=>n.path==='A.md').weight,30);
  options.filter.localDepth=2;
  assert.ok(selectGraph(full,'',options.filter,'A.md').nodes.some(n=>n.path==='folder/C.md'));
  options.filter.localDepth=1;options.filter.localOutgoing=false;
  assert.deepEqual(selectGraph(full,'',options.filter,'folder/C.md').nodes.map(n=>n.path).sort(),['B.md','folder/C.md']);
});
test('shared tag cannot pull unrelated notes into a local graph',()=>{
  const {app}=fixture(), options=defaultGraphOptions();options.filter.showTags=true;options.filter.localDepth=2;options.filter.showUnresolved=false;
  app.metadataCache.resolvedLinks={};
  const graph=selectGraph(buildVaultSnapshot(app,[],options.filter),'',options.filter,'A.md');
  assert.deepEqual(graph.nodes.map(n=>n.path).sort(),['#shared','A.md']);
});
test('search changes topology and supports basic path/file/tag queries',()=>{
  const {app}=fixture(), options=defaultGraphOptions();
  const full=buildVaultSnapshot(app,[],options.filter);
  assert.equal(selectGraph(full,'path:folder',options.filter).nodes[0].path,'folder/C.md');
  assert.equal(selectGraph(full,'file:B',options.filter).nodes.length,1);
  assert.equal(selectGraph(full,'tag:shared',options.filter).nodes.length,2);
  assert.equal(selectGraph(full,'no-match',options.filter).nodes.length,0);
});
test('persisted graph options are bounded and malformed values use defaults',()=>{
  const value=loadGraphOptions({source:'bad',display:{nodeSizeMultiplier:Infinity,lineSizeMultiplier:100},forces:{repel:-1},filter:{localDepth:99},hiddenPaths:[3,'a.md']});
  assert.equal(value.source,'vault');assert.equal(value.display.nodeSizeMultiplier,1);assert.equal(value.display.lineSizeMultiplier,5);
  assert.equal(value.forces.repel,0);assert.equal(value.filter.localDepth,5);assert.deepEqual(value.hiddenPaths,['a.md']);
});
test('new thoughts automatically skip occupied names without changing existing files',async()=>{
  const {app}=fixture();
  const file=await createThought(app,'','BrainOS/Thoughts');
  assert.equal(file.path,'BrainOS/Thoughts/未命名思考.md');
  const second=await createThought(app,'未命名思考','BrainOS/Thoughts');
  const third=await createThought(app,'未命名思考','BrainOS/Thoughts');
  assert.equal(second.path,'BrainOS/Thoughts/未命名思考 1.md');
  assert.equal(third.path,'BrainOS/Thoughts/未命名思考 2.md');
  assert.equal(app.vault.getAbstractFileByPath(file.path),file);
  assert.equal(file.text,'');
});

test('a bound new thought renders before metadata indexing and does not read other thought files',async()=>{
  const {app}=fixture();const bound=new TFile('未命名思考.md');const unrelated=new TFile('其他思考.md');
  app.vault.getMarkdownFiles=()=>[bound,unrelated];
  app.metadataCache.getFileCache=file=>file===unrelated?{frontmatter:{brainos_type:'thought-file'}}:{};
  const reads=[];app.vault.cachedRead=async file=>{reads.push(file.path);return '<!-- brainos-state\n{"paths":[]}\n-->';};
  const graph=await buildSnapshot(app,bound);
  assert.deepEqual(reads,['未命名思考.md']);
  assert.deepEqual(graph.thoughts,[{path:bound.path,title:'未命名思考'}]);
  assert.equal(graph.nodes.length,1);assert.equal(graph.nodes[0].openPath,bound.path);
});
