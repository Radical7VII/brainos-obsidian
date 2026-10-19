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
  focus(){Element.active=this;}
  select(){this.selectionStart=0;this.selectionEnd=this.value.length;}
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
      'export class TFile{constructor(path){this.path=path;this.extension="md";this.basename=path.replace(/.*\\//,"").slice(0,-3);}};export const normalizePath=p=>p.replace(/\\/+/g,"/");export class FileView{constructor(leaf){this.leaf=leaf;this.app=leaf.app;this.contentEl=leaf.element;}};export class Notice{constructor(text){globalThis.lastNotice=text;}};export class AbstractInputSuggest{constructor(app,input){this.input=input;}setValue(value){this.input.value=value;}open(){}close(){}};export const prepareFuzzySearch=query=>text=>text.toLowerCase().includes(query.toLowerCase())?{score:1}:null;export class Modal{};export class SuggestModal{};export class Component{};export class MarkdownView{};export class Menu{};export class Setting{};export const MarkdownRenderer={};export const parseLinktext=p=>({path:p,subpath:""});export const getAllTags=()=>[];export const setIcon=()=>{};'}));
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
  return {view,app,file,plugin,element,content,session,addFile:(path,text)=>{const added=new TFile(path);files.set(path,added);content.set(path,text);return added;},key:name=>nodeKey(file.path,titleID(name))};
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
test('editing is one inline title input and preserves every body byte for byte',async()=>{
  const original='- A\n  第一次  \n  `代码`\n- B\n\n---\n\n- A\n  第二次\n';
  const f=await fixture(original);await f.view.beginEdit(f.view.nodes.find(node=>node.label==='A'));
  const form=f.view.editor;
  assert.equal(form.options.cls,'brainos-node-title-editor');
  assert.equal(form.find('input').length,1);assert.equal(form.find('textarea').length,0);
  assert.equal(form.find('select').length,0);assert.equal(form.find('button').length,0);
  form.find('input')[0].value='改名';form.requestSubmit();await settle(f.view);
  assert.equal(f.content.get(f.file.path),original.replaceAll('- A\n','- 改名\n'));
  assert.equal(f.view.selected,f.key('改名'));assert.equal(f.view.editor,undefined);
});
test('inline title editing cancels without writing and keeps the editor after conflicts',async()=>{
  const original='- A\n  正文\n- B\n',f=await fixture(original);
  await f.view.beginEdit(f.view.nodes[0]);let form=f.view.editor;
  form.find('input')[0].value='取消修改';form.onkeydown(keyEvent('Escape'));
  assert.equal(f.view.editor,undefined);assert.equal(f.content.get(f.file.path),original);
  await f.view.beginEdit(f.view.nodes[0]);form=f.view.editor;
  form.find('input')[0].value='B';form.requestSubmit();await settle(f.view);
  assert.equal(f.view.editor,form);assert.equal(f.content.get(f.file.path),original);assert.match(globalThis.lastNotice,/另一个节点/);
  f.content.set(f.file.path,original.replace('正文','外部修改'));
  form.find('input')[0].value='新标题';form.requestSubmit();await settle(f.view);
  assert.equal(f.view.editor,form);assert.match(f.content.get(f.file.path),/外部修改/);assert.match(globalThis.lastNotice,/其他位置修改/);
});

function keyEvent(key,overrides={}){
  return {key,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...overrides};
}
test('Space edits the selected title with its text selected and preserves every visit body',async()=>{
  const f=await fixture('- A\n  第一次\n- B\n- A\n  第二次\n');
  f.view.selected=f.key('A');
  const event=keyEvent(' ');f.view.onKeyDown(event);await settle(f.view);
  const form=f.view.editor,title=form.find('input')[0];
  assert.equal(event.prevented,true);assert.equal(Element.active,title);
  assert.equal(title.selectionStart,0);assert.equal(title.selectionEnd,1);
  title.value='新标题';form.requestSubmit();await settle(f.view);
  assert.equal(f.content.get(f.file.path).trimEnd(),'- 新标题\n  第一次\n- B\n- 新标题\n  第二次');
  assert.equal(f.view.selected,f.key('新标题'));
});
test('Space does not start title editing without selection or during other keyboard input',async()=>{
  const f=await fixture('- A\n');
  f.view.onKeyDown(keyEvent(' '));assert.equal(f.view.editor,undefined);
  f.view.selected=f.key('A');
  for(const overrides of [{isComposing:true},{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true}]){
    f.view.onKeyDown(keyEvent(' ',overrides));await settle(f.view);
    assert.equal(f.view.editor,undefined);
  }
  await f.view.beginEdit(f.view.nodes[0]);
  const form=f.view.editor;assert.equal(Element.active,form.find('input')[0]);
  f.view.onKeyDown(keyEvent(' '));assert.equal(f.view.editor,form);
});

test('Command Enter inserts between the latest parent and selected node, preserving other paths and bodies',async()=>{
  const f=await fixture('- A\n  A正文\n- B\n  B第一次\n\n---\n\n- C\n  C正文\n- B\n  B第二次\n- D\n');
  f.view.selected=f.key('B');
  const c=f.view.nodes.find(node=>node.label==='C'),b=f.view.nodes.find(node=>node.label==='B');
  c.x=20;c.y=40;b.x=220;b.y=80;
  const event=keyEvent('Enter',{metaKey:true});f.view.onKeyDown(event);await settle(f.view);
  assert.equal(event.prevented,true);assert.equal(f.view.draftParent,f.key('C'));
  assert.equal(f.view.draftChild,f.key('B'));assert.equal(f.view.draftNode.x,120);assert.equal(f.view.draftNode.y,60);
  f.view.editor.find('input')[0].value='中间';f.view.editor.requestSubmit();await settle(f.view);
  assert.equal(f.content.get(f.file.path),'- A\n  A正文\n- B\n  B第一次\n\n---\n\n- C\n  C正文\n- 中间\n- B\n  B第二次\n- D\n');
  assert.equal(f.view.selected,f.key('中间'));
  const has=(from,to)=>f.view.edges.some(edge=>edge.from===f.key(from)&&edge.to===f.key(to));
  assert.ok(has('A','B'));assert.ok(has('C','中间'));assert.ok(has('中间','B'));assert.ok(has('B','D'));
  assert.ok(!has('C','B'));
});
test('insert-parent shortcut cancels without writing and rejects a root or repeat/composition keys',async()=>{
  const original='- A\n- B\n',f=await fixture(original);
  f.view.selected=f.key('B');
  for(const flags of [{metaKey:true,repeat:true},{metaKey:true,isComposing:true},{metaKey:true,altKey:true},{metaKey:true,shiftKey:true}]){
    f.view.onKeyDown(keyEvent('Enter',flags));await settle(f.view);assert.equal(f.view.editor,undefined);
  }
  f.view.onKeyDown(keyEvent('Enter',{ctrlKey:true}));await settle(f.view);
  assert.ok(f.view.editor);f.view.editor.onkeydown({key:'Escape',preventDefault(){},stopPropagation(){}});
  assert.equal(f.view.editor,undefined);assert.equal(f.content.get(f.file.path),original);
  f.view.selected=f.key('A');f.view.onKeyDown(keyEvent('Enter',{metaKey:true}));await settle(f.view);
  assert.equal(f.view.editor,undefined);assert.match(globalThis.lastNotice,/没有父节点/);
});
test('insertion refuses existing names and changed parents without modifying the document',async()=>{
  const f=await fixture('- A\n- B\n');f.view.selected=f.key('B');await f.view.insertParent();
  const form=f.view.editor,title=form.find('input')[0];title.value='A';form.requestSubmit();await settle(f.view);
  assert.equal(f.content.get(f.file.path),'- A\n- B\n');assert.equal(f.view.editor,form);
  assert.match(globalThis.lastNotice,/同名/);
  f.content.set(f.file.path,'- C\n- B\n');title.value='插入';form.requestSubmit();await settle(f.view);
  assert.equal(f.content.get(f.file.path),'- C\n- B\n');assert.match(globalThis.lastNotice,/父节点或路径已变化/);
});

test('native title candidates distinguish reuse, references and creation, and reuse preserves position',async()=>{
  const f=await fixture('- 方案\n  旧正文\n- 起点\n');f.addFile('其他.md','- 方案\n  外部正文\n');
  f.plugin.layout.positions[f.key('方案')]={x:22,y:33};f.view.selected=f.key('起点');await f.view.createRelative(true);
  const suggest=f.view.titleSuggest,options=await suggest.getSuggestions('方案');
  assert.deepEqual(options.map(option=>option.kind),['reuse','reference']);
  assert.equal(options[0].node.ownerPath,'思考.md');assert.equal(options[1].node.ownerPath,'其他.md');
  assert.deepEqual(await suggest.getSuggestions('全新想法'),[{kind:'create',title:'全新想法'}]);
  suggest.selectSuggestion(options[0],{});await settle(f.view);
  assert.equal(f.view.selected,f.key('方案'));assert.deepEqual(f.plugin.layout.positions[f.key('方案')],{x:22,y:33});
  assert.match(f.content.get(f.file.path),/- 起点\n- 方案\n$/);
  assert.equal(f.content.get('其他.md'),'- 方案\n  外部正文\n');
  assert.deepEqual(await suggest.getSuggestions('方案'),[]);
});
test('choosing a cross-file title candidate inserts a reference on a fresh sibling path',async()=>{
  const f=await fixture('- 起点\n- 当前\n');f.addFile('来源.md','- 共享观点\n  来源正文\n');
  f.view.selected=f.key('当前');await f.view.createRelative(false);
  const options=await f.view.titleSuggest.getSuggestions('共享');
  assert.equal(options[0].kind,'reference');assert.equal(options.at(-1).kind,'create');
  f.view.titleSuggest.selectSuggestion(options[0],{});await settle(f.view);
  assert.equal(f.content.get(f.file.path),'- 起点\n- 当前\n\n---\n\n- 起点\n- [[来源.md|共享观点]]\n');
  assert.equal(f.content.get('来源.md'),'- 共享观点\n  来源正文\n');
  assert.equal(f.view.selected,nodeKey('来源.md',titleID('共享观点')));
});
test('title suggestions respect composition, new-name insertion and cancellation',async()=>{
  const f=await fixture('- A\n- B\n');f.view.selected=f.key('B');await f.view.insertParent();
  const suggest=f.view.titleSuggest;
  assert.deepEqual(await suggest.getSuggestions('A'),[]);
  assert.deepEqual(await suggest.getSuggestions('新节点'),[{kind:'create',title:'新节点'}]);
  f.view.composing=true;assert.deepEqual(await suggest.getSuggestions('新节点'),[]);
  suggest.selectSuggestion({kind:'create',title:'新节点'},{});assert.equal(f.content.get(f.file.path),'- A\n- B\n');
  f.view.composing=false;const pending=suggest.getSuggestions('新节点');f.view.closeEditor();
  assert.deepEqual(await pending,[]);assert.equal(f.content.get(f.file.path),'- A\n- B\n');
});

test('inline editing a referenced title preserves source body and updates incoming references',async()=>{
  const f=await fixture('- [[来源.md|来源节点]]\n  引用正文\n');
  f.addFile('来源.md','- 来源节点\n  来源正文  \n');await f.view.refresh();
  await f.view.beginEdit(f.view.nodes.find(node=>node.label==='来源节点'));
  const form=f.view.editor;assert.equal(form.find('textarea').length,0);
  form.find('input')[0].value='改名';form.requestSubmit();await settle(f.view);
  assert.equal(f.content.get('来源.md'),'- 改名\n  来源正文  \n');
  assert.equal(f.content.get(f.file.path),'- [[来源.md|改名]]\n  引用正文\n');
  assert.equal(f.view.selected,nodeKey('来源.md',titleID('改名')));
});
