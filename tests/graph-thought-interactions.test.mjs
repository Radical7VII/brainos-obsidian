import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

class Element {
  constructor(tag='div',options={}) {
    this.tag=tag;this.children=[];this.style={};this.value=options.value??'';
    this.text=options.text??'';this.options=options;this.clientWidth=900;this.clientHeight=600;
  }
  createEl(tag,options){const child=new Element(tag,options);this.children.push(child);return child;}
  createDiv(options){return this.createEl('div',options);}
  addEventListener(){}
  remove(){this.removed=true;}
  focus(){}
  empty(){this.children=[];}
  addClass(){}
  requestSubmit(){this.onsubmit?.({preventDefault(){}});}
  find(tag){return this.children.flatMap(child=>[child,...child.find(tag)]).filter(child=>child.tag===tag);}
}
globalThis.requestAnimationFrame=()=>1;
globalThis.cancelAnimationFrame=()=>{};
const bundle=await build({
  stdin:{contents:'export {BrainOSGraphView} from "./src/graph-view";export {defaultGraphOptions} from "./src/graph-options";export {buildThoughtSnapshot} from "./src/thought-store";export {nodeKey,titleID} from "./src/thought-document";export {TFile} from "obsidian";',resolveDir:process.cwd()},
  bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',
  plugins:[{name:'graph-runtime',setup(b){
    b.onResolve({filter:/^\.\/graph-layout$/},()=>({path:'layout',namespace:'mock'}));
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:args.path==='layout'?
      'export class GraphLayout {sync(){}pin(){}unpin(){}setSelected(){}configure(){}dispose(){}}':
      'export class TFile{constructor(path){this.path=path;this.extension="md";this.basename=path.replace(/.*\\//,"").slice(0,-3);}};export const normalizePath=p=>p.replace(/\\/+/g,"/");export class FileView{constructor(leaf){this.leaf=leaf;this.app=leaf.app;this.contentEl=leaf.element;}};export class Notice{constructor(text){globalThis.lastNotice=text;}};export class Modal{};export class SuggestModal{};export class Component{};export class MarkdownView{};export class Menu{};export class Setting{};export const MarkdownRenderer={};export const parseLinktext=p=>({path:p,subpath:""});export const getAllTags=()=>[];export const setIcon=()=>{};'}));
  }}],
});
const {BrainOSGraphView,defaultGraphOptions,buildThoughtSnapshot,nodeKey,titleID,TFile}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
async function fixture(text){
  const file=new TFile('思考.md'),files=new Map([[file.path,file]]),content=new Map([[file.path,text]]);
  const app={vault:{getAbstractFileByPath:path=>files.get(path),getMarkdownFiles:()=>[...files.values()],cachedRead:async f=>content.get(f.path),
    process:async(f,edit)=>content.set(f.path,edit(content.get(f.path)))},
    metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:(path,owner)=>files.get(path||owner)}};
  const session={stepKeys:[]},plugin={layout:{positions:{},viewports:{},settings:{noteFolder:''},graph:defaultGraphOptions(),sessions:[session]},
    activeSession:session,recordSessionStep:key=>session.stepKeys.push(key),saveLayout:async()=>{},refreshViews(){}};
  const element=new Element(),view=new BrainOSGraphView({app,element},plugin);view.file=file;view.thoughtPath=file.path;
  view.canvas=new Element('canvas');view.startLayoutAnimation=()=>{};view.draw=()=>{};view.positionDraftEditor=()=>{};
  view.refresh=async()=>{view.snapshot=await buildThoughtSnapshot(app,file);view.filterSnapshot();};
  view.addMarkdownPreviewToggle=()=>{};
  await view.refresh();
  return {view,app,file,plugin,element,content,session,key:name=>nodeKey(file.path,titleID(name))};
}
async function settle(view){
  for(let count=0;count<20;count++){
    await new Promise(resolve=>setImmediate(resolve));
    if(!view.busy)return;
  }
  assert.fail('graph edit did not settle');
}

test('inline same-name creation reuses the existing position and records the return',async()=>{
  const f=await fixture('- A\n- B\n');
  f.plugin.layout.positions[f.key('A')]={x:10,y:20};
  const b=f.view.nodes.find(node=>node.label==='B');f.view.selected=b.path;
  await f.view.createRelative(true);
  const form=f.view.editor,input=form.find('input')[0];input.value='A';form.requestSubmit();
  await settle(f.view);
  assert.equal(f.view.selected,f.key('A'));assert.equal(f.view.nodes.length,2);
  assert.deepEqual(f.plugin.layout.positions[f.key('A')],{x:10,y:20});
  assert.deepEqual(f.session.stepKeys,[f.key('B'),f.key('A')]);
  assert.equal(f.content.get(f.file.path),'- A\n- B\n- A\n');
});
test('empty-canvas creation stays independent and branching uses the most recent occurrence predecessor',async()=>{
  const f=await fixture('- A\n- B\n\n---\n\n- C\n- B\n');
  f.view.selected=f.key('B');
  await f.view.createRelative(false);
  assert.equal(f.view.draftParent,f.key('C'));f.view.closeEditor();
  await f.view.beginCreate({x:100,y:100});
  f.view.editor.find('input')[0].value='独立';f.view.editor.requestSubmit();await settle(f.view);
  assert.ok(!f.view.edges.some(edge=>edge.to===f.key('独立')));
  assert.match(f.content.get(f.file.path),/---\n\n- 独立\n$/);
});
test('the occurrence selector edits only that visit and renames every appearance',async()=>{
  const f=await fixture('- A\n  第一次\n- B\n\n---\n\n- A\n  第二次\n');
  const node=f.view.nodes.find(node=>node.label==='A');
  await f.view.beginEdit(node);
  let form=f.view.editor,select=form.find('select')[0];
  assert.equal(select.children.length,2);assert.equal(select.value,'1');
  select.value='0';select.onchange();await settle(f.view);
  form=f.view.editor;
  assert.equal(form.find('textarea')[0].value,'第一次');
  form.find('input')[0].value='改名';form.find('textarea')[0].value='只改第一次';form.requestSubmit();await settle(f.view);
  const text=f.content.get(f.file.path);
  assert.match(text,/- 改名\n  只改第一次/);assert.match(text,/- 改名\n  第二次/);
  assert.equal(f.view.selected,f.key('改名'));
});
test('switching occurrences never silently discards unsaved prose',async()=>{
  const f=await fixture('- A\n  第一次\n\n---\n\n- A\n  第二次\n');
  await f.view.beginEdit(f.view.nodes[0]);
  const form=f.view.editor,select=form.find('select')[0],body=form.find('textarea')[0];
  body.value='尚未保存';select.value='0';select.onchange();await settle(f.view);
  assert.equal(f.view.editor,form);assert.equal(body.value,'尚未保存');assert.equal(select.value,'1');
  assert.match(globalThis.lastNotice,/请先保存或取消/);
});
