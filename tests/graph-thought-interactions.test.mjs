import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

class Element {
  constructor(tag='div',options={}) {
    this.tag=tag;this.children=[];this.style={};this.value=options.value??'';
    this.text=options.text??'';this.options=options;this.clientWidth=900;this.clientHeight=600;this.offsetLeft=0;this.offsetTop=0;
  }
  createEl(tag,options){const child=new Element(tag,options);this.children.push(child);return child;}
  createDiv(options){return this.createEl('div',options);}
  addEventListener(type,callback){(this.listeners??={})[type]??=[];this.listeners[type].push(callback);}
  dispatchEvent(event){for(const callback of this.listeners?.[event.type]??[])callback(event);this['on'+event.type]?.(event);return true;}
  remove(){this.removed=true;}
  focus(){Element.active=this;}
  select(){this.selectionStart=0;this.selectionEnd=this.value.length;}
  empty(){this.children=[];}
  addClass(){}
  removeClass(){}
  getBoundingClientRect(){return {left:0,top:0};}
  setPointerCapture(){}
  hasPointerCapture(){return false;}
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
      'export class GraphLayout {sync(){}pin(){}movePinned(){}unpin(){}setSelected(){}configure(){}dispose(){}}':
      'export class TFile{constructor(path){this.path=path;this.extension="md";this.basename=path.replace(/.*\\//,"").slice(0,-3);}};export const normalizePath=p=>p.replace(/\\/+/g,"/");export class FileView{constructor(leaf){this.leaf=leaf;this.app=leaf.app;this.contentEl=leaf.element;}};export class Notice{constructor(text){globalThis.lastNotice=text;}};export class AbstractInputSuggest{       constructor(app,input){this.input=input;let revision=0;input.addEventListener("input",async()=>{const current=++revision;const rows=await this.getSuggestions(input.value);if(current!==revision)return;this.rendered=rows;if(rows.length)this.open();else this.close();});}       setValue(value){this.input.value=value;}open(){}close(){}     };export const prepareFuzzySearch=query=>text=>text.toLowerCase().includes(query.toLowerCase())?{score:1}:null;export class Modal{};export class SuggestModal{};export class Component{};export class MarkdownView{};export class Menu{};export class Setting{};export const MarkdownRenderer={};export const parseLinktext=p=>({path:p,subpath:""});export const getAllTags=()=>[];export const setIcon=()=>{};'}));
  }}],
});
const {BrainOSGraphView,defaultGraphOptions,buildThoughtSnapshot,nodeKey,titleID,TFile}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
async function fixture(text,path='思考.md'){
  const file=new TFile(path),files=new Map([[file.path,file]]),content=new Map([[file.path,text]]);
  const app={vault:{getAbstractFileByPath:path=>files.get(path),getMarkdownFiles:()=>[...files.values()],cachedRead:async f=>content.get(f.path),read:async f=>content.get(f.path),
    process:async(f,edit)=>content.set(f.path,edit(content.get(f.path)))},
    metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:(path,owner)=>files.get(path||owner)}};
  const session={stepKeys:[]},plugin={layout:{positions:{},viewports:{},settings:{noteFolder:''},graph:defaultGraphOptions(),sessions:[session]},
    activeSession:session,recordSessionStep:key=>session.stepKeys.push(key),saveLayout:async()=>{},refreshViews(){}};
  const element=new Element(),view=new BrainOSGraphView({app,element},plugin);view.file=file;view.thoughtPath=file.path;
  view.canvas=new Element('canvas');view.startLayoutAnimation=()=>{};view.draw=()=>{};view.positionDraftEditor=()=>{};view.scheduleLayoutSave=()=>{};
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
  assert.deepEqual(await suggest.getSuggestions('全新想法'),[]);
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
  assert.equal(options[0].kind,'reference');assert.equal(options.length,1);
  f.view.titleSuggest.selectSuggestion(options[0],{});await settle(f.view);
  assert.equal(f.content.get(f.file.path),'- 起点\n- 当前\n\n---\n\n- 起点\n- [[来源.md|共享观点]]\n');
  assert.equal(f.content.get('来源.md'),'- 共享观点\n  来源正文\n');
  assert.equal(f.view.selected,nodeKey('来源.md',titleID('共享观点')));
});
test('title suggestions respect composition, new-name insertion and cancellation',async()=>{
  const f=await fixture('- A\n- B\n');f.view.selected=f.key('B');await f.view.insertParent();
  const suggest=f.view.titleSuggest;
  assert.deepEqual(await suggest.getSuggestions('A'),[]);
  assert.deepEqual(await suggest.getSuggestions('新节点'),[]);
  f.view.composing=true;assert.deepEqual(await suggest.getSuggestions('新节点'),[]);
  suggest.selectSuggestion({kind:'reuse',node:f.view.nodes.find(node=>node.label==='A')},{});assert.equal(f.content.get(f.file.path),'- A\n- B\n');
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

test('inline title editing offers native name/path rows and reuses the selected node without losing prose',async()=>{
  const f=await fixture('- 网络\n  当前正文  \n- 网络服\n  候选正文\n');
  f.plugin.layout.positions[f.key('网络')]={x:10,y:20};
  f.plugin.layout.positions[f.key('网络服')]={x:100,y:200};
  await f.view.beginEdit(f.view.nodes.find(node=>node.label==='网络'));
  const suggest=f.view.titleSuggest,options=await suggest.getSuggestions('网络');
  assert.equal(options[0].kind,'reuse');assert.equal(options[0].node.label,'网络服');
  assert.ok(!options.some(option=>option.node.path===f.key('网络')));
  const row=new Element();suggest.renderSuggestion(options[0],row);
  assert.equal(row.children[0].options.cls,'suggestion-content');
  assert.equal(row.children[0].children[0].text,'网络服');
  assert.equal(row.children[0].children[1].text,'思考.md');
  assert.equal((await suggest.getSuggestions(''))[0].node.label,'网络服');
  suggest.selectSuggestion(options[0],{});await settle(f.view);
  assert.equal(f.content.get(f.file.path),'- 网络服\n  当前正文  \n- 网络服\n  候选正文\n');
  assert.equal(f.view.nodes.filter(node=>node.label==='网络服').length,1);
  assert.deepEqual(f.plugin.layout.positions[f.key('网络服')],{x:100,y:200});
  assert.equal(f.plugin.layout.positions[f.key('网络')],undefined);
  assert.equal(f.view.selected,f.key('网络服'));
});
test('inline editing lets native suggestion keys propagate and cancels its candidate provider',async()=>{
  const f=await fixture('- 网络\n- 网络服\n');await f.view.beginEdit(f.view.nodes[0]);
  const suggest=f.view.titleSuggest;suggest.open();
  for(const key of ['ArrowDown','ArrowUp','Enter','Escape']){
    const event=keyEvent(key);f.view.editor.onkeydown(event);
    assert.equal(event.stopped,undefined);assert.equal(event.prevented,undefined);
  }
  suggest.close();f.view.editor.onkeydown(keyEvent('Escape'));
  assert.equal(f.view.editor,undefined);assert.deepEqual(await suggest.getSuggestions('网络'),[]);
  assert.equal(f.content.get(f.file.path),'- 网络\n- 网络服\n');
});

test('Backspace removes a selected node directly without bridging the remaining path',async()=>{
  const f=await fixture('- A\n- B\n  B正文\n- C\n');f.view.selected=f.key('B');
  const event=keyEvent('Backspace');f.view.onKeyDown(event);await settle(f.view);
  assert.equal(event.prevented,true);assert.equal(event.stopped,true);
  assert.ok(!f.view.nodes.some(node=>node.label==='B'));
  assert.ok(!f.view.edges.some(edge=>edge.from===f.key('A')&&edge.to===f.key('C')));
  assert.equal(f.view.selected,undefined);
});
test('Backspace while editing or composing does not remove the node, and held keys are ignored',async()=>{
  const f=await fixture('- A\n- B\n');f.view.selected=f.key('B');
  f.view.onKeyDown(keyEvent('Backspace',{repeat:true}));await settle(f.view);
  f.view.onKeyDown(keyEvent('Backspace',{isComposing:true}));await settle(f.view);
  await f.view.beginEdit(f.view.nodes.find(node=>node.label==='B'));
  f.view.onKeyDown(keyEvent('Backspace'));await settle(f.view);
  const event=keyEvent('Backspace');f.view.editor.onkeydown(event);assert.equal(event.prevented,undefined);
  assert.equal(f.content.get(f.file.path),'- A\n- B\n');
});
test('Backspace removes a reference from the current thought without deleting its source',async()=>{
  const f=await fixture('- A\n- [[来源.md|共享]]\n');f.addFile('来源.md','- 共享\n  来源正文\n');await f.view.refresh();
  f.view.selected=nodeKey('来源.md',titleID('共享'));f.view.onKeyDown(keyEvent('Backspace'));await settle(f.view);
  assert.equal(f.content.get('来源.md'),'- 共享\n  来源正文\n');
  assert.ok(!f.content.get(f.file.path).includes('[[来源.md|共享]]'));
});

test('title search only matches node titles, never file names or paths',async()=>{
  const f=await fixture('- 普通节点\n');f.addFile('网络服/文件标题.md','- 玩法设计\n');
  await f.view.beginCreate({x:0,y:0});const suggest=f.view.titleSuggest;
  assert.deepEqual(await suggest.getSuggestions('网络服'),[]);
  assert.deepEqual(await suggest.getSuggestions('文件标题'),[]);
  const options=await suggest.getSuggestions('玩法');assert.equal(options.length,1);
  assert.equal(options[0].node.label,'玩法设计');assert.equal(options[0].node.ownerPath,'网络服/文件标题.md');
  const input=f.view.editor.find('input')[0];input.value='全新节点';f.view.editor.requestSubmit();await settle(f.view);
  assert.ok(f.view.nodes.some(node=>node.label==='全新节点'));
});

test('typing and deleting updates native candidates immediately, including during Chinese composition',async()=>{
  const f=await fixture('- 起点\n- 网络服\n- 网络同步\n');await f.view.beginEdit(f.view.nodes.find(node=>node.label==='起点'));
  const form=f.view.editor,input=form.find('input')[0],suggest=f.view.titleSuggest;
  input.dispatchEvent(new Event('compositionstart'));
  input.value='网络';input.dispatchEvent(new Event('input'));await settle(f.view);
  assert.equal(f.view.composing,true);assert.equal(suggest.rendered.length,2);assert.equal(suggest.isShowing,true);
  input.value='网络服';input.dispatchEvent(new Event('input'));await settle(f.view);
  assert.equal(suggest.rendered.length,1);assert.equal(suggest.rendered[0].node.label,'网络服');
  suggest.selectSuggestion(suggest.rendered[0],{isComposing:true});assert.equal(f.view.editor,form);
  input.value='网络';input.dispatchEvent(new Event('compositionend'));await settle(f.view);
  assert.equal(f.view.composing,false);assert.equal(suggest.rendered.length,2);
  input.value='完全不匹配';input.dispatchEvent(new Event('input'));await settle(f.view);
  assert.equal(suggest.isShowing,false);assert.deepEqual(suggest.rendered,[]);
  assert.equal(f.content.get(f.file.path),'- 起点\n- 网络服\n- 网络同步\n');
});
test('creation input searches while typing without submitting the new node',async()=>{
  const f=await fixture('- 网络服\n');await f.view.beginCreate({x:0,y:0});
  const input=f.view.editor.find('input')[0],suggest=f.view.titleSuggest;
  input.value='网';input.dispatchEvent(new Event('input'));await settle(f.view);
  assert.equal(suggest.isShowing,true);assert.equal(suggest.rendered[0].node.label,'网络服');
  f.view.closeEditor();input.dispatchEvent(new Event('compositionend'));await settle(f.view);
  assert.equal(suggest.isShowing,false);assert.equal(f.content.get(f.file.path),'- 网络服\n');
});

test('node candidate search only offers nodes under the configured thought directory',async()=>{
  const f=await fixture('- 当前\n','BrainOS/思考.md');f.plugin.layout.settings.noteFolder='BrainOS';
  f.addFile('BrainOS/子目录/其他.md','- 网络服\n');f.addFile('外部/其他.md','- 网络杂音\n');f.addFile('BrainOS-other/其他.md','- 网络相似目录\n');
  const read=f.app.vault.cachedRead;const reads=[];f.app.vault.cachedRead=async file=>{reads.push(file.path);return read(file);};
  await f.view.beginCreate({x:0,y:0});const options=await f.view.titleSuggest.getSuggestions('网络');
  assert.deepEqual(options.map(option=>option.node.label),['网络服']);
  assert.ok(reads.every(path=>path.startsWith('BrainOS/')));
});

function placeEdgeNodes(f){
  for(const [label,x,y] of [['A',-100,0],['B',100,0],['C',100,150]]){
    const node=f.view.nodes.find(node=>node.label===label);if(node){node.x=x;node.y=y;}
  }
}
function pointerAt(x,y){return {button:0,pointerId:1,pointerType:'mouse',clientX:x,clientY:y,preventDefault(){}};}
test('hover highlights a line without editing and a single click disconnects it',async()=>{
  const f=await fixture('- A\n  A正文\n- B\n  B正文\n- C\n');placeEdgeNodes(f);
  const original=f.content.get(f.file.path),event=pointerAt(450,302);
  f.view.onPointerMove(event);
  assert.equal(f.view.hoveredEdge.from,f.key('A'));assert.equal(f.view.hoveredEdge.to,f.key('B'));
  assert.equal(f.content.get(f.file.path),original);
  f.view.onPointerDown(event);f.view.onPointerUp(event);await settle(f.view);
  assert.equal(f.view.hoveredEdge,undefined);
  assert.deepEqual(f.view.nodes.map(node=>node.label).sort(),['A','B','C']);
  assert.match(f.content.get(f.file.path),/A正文/);assert.match(f.content.get(f.file.path),/B正文/);
  assert.ok(!f.view.edges.some(edge=>edge.from===f.key('A')&&edge.to===f.key('B')));
  assert.ok(f.view.edges.some(edge=>edge.from===f.key('B')&&edge.to===f.key('C')));
});
test('moving away clears line hover and clicking a node never disconnects its links',async()=>{
  const original='- A\n- B\n',f=await fixture(original);placeEdgeNodes(f);
  f.view.onPointerMove(pointerAt(450,302));assert.ok(f.view.hoveredEdge);
  f.view.onPointerMove(pointerAt(450,200));assert.equal(f.view.hoveredEdge,undefined);
  f.view.onPointerMove(pointerAt(450,302));
  f.view.onPointerMove(pointerAt(350,300));assert.equal(f.view.hoveredEdge,undefined);assert.equal(f.view.hovered,f.key('A'));
  f.view.onPointerDown(pointerAt(350,300));f.view.onPointerUp(pointerAt(350,300));await settle(f.view);
  assert.equal(f.view.selected,f.key('A'));assert.equal(f.content.get(f.file.path),original);
});
test('single click disconnects both visual directions while keeping nodes and prose',async()=>{
  const f=await fixture('- A\n  第一次\n- B\n  中间\n- A\n  第二次\n');placeEdgeNodes(f);
  const event=pointerAt(450,302);f.view.onPointerDown(event);f.view.onPointerUp(event);await settle(f.view);
  assert.equal(f.view.edges.length,0);assert.deepEqual(f.view.nodes.map(node=>node.label).sort(),['A','B']);
  for(const body of ['第一次','中间','第二次'])assert.ok(f.content.get(f.file.path).includes(body));
});
test('dragging or clicking blank canvas never disconnects a line',async()=>{
  const f=await fixture('- A\n- B\n');placeEdgeNodes(f);const original=f.content.get(f.file.path);
  const event=pointerAt(450,302);f.view.onPointerDown(event);f.view.gesture.moved=true;
  f.view.onPointerUp(event);await settle(f.view);assert.equal(f.content.get(f.file.path),original);
  f.view.onPointerDown(pointerAt(450,200));f.view.onPointerUp(pointerAt(450,200));await settle(f.view);
  assert.equal(f.content.get(f.file.path),original);
});

test('Command Z restores disconnected lines and Command Shift Z repeats the disconnect',async()=>{
  const original='- A\n  第一次\n- B\n  B正文\n- A\n  第二次\n',f=await fixture(original);placeEdgeNodes(f);
  const event=pointerAt(450,302);f.view.onPointerDown(event);f.view.onPointerUp(event);await settle(f.view);
  const disconnected=f.content.get(f.file.path);assert.equal(f.view.edges.length,0);
  const undo=keyEvent('z',{metaKey:true});f.view.onKeyDown(undo);await settle(f.view);
  assert.equal(undo.prevented,true);assert.equal(undo.stopped,true);
  assert.equal(f.content.get(f.file.path),original);assert.equal(f.view.edges.length,2);
  f.view.onKeyDown(keyEvent('Z',{metaKey:true,shiftKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),disconnected);assert.equal(f.view.edges.length,0);
});
test('undo restores deleted nodes and a new edit invalidates redo',async()=>{
  const original='- A\n- B\n  正文\n',f=await fixture(original);f.view.selected=f.key('B');
  f.view.onKeyDown(keyEvent('Backspace'));await settle(f.view);assert.ok(!f.view.nodes.some(node=>node.label==='B'));
  f.view.onKeyDown(keyEvent('z',{ctrlKey:true}));await settle(f.view);assert.equal(f.content.get(f.file.path),original);
  await f.view.beginCreate({x:0,y:0});f.view.editor.find('input')[0].value='C';f.view.editor.requestSubmit();await settle(f.view);
  const fresh=f.content.get(f.file.path);f.view.onKeyDown(keyEvent('z',{ctrlKey:true,shiftKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),fresh);assert.ok(f.view.nodes.some(node=>node.label==='B'));
});
test('undo and redo rename source and incoming references together and restore node positions',async()=>{
  const original='- [[来源.md|原名]]\n  引用正文\n',source='- 原名\n  来源正文  \n',f=await fixture(original);
  f.addFile('来源.md',source);await f.view.refresh();const oldKey=nodeKey('来源.md',titleID('原名')),newKey=nodeKey('来源.md',titleID('改名'));
  f.plugin.layout.positions[oldKey]={x:42,y:64};f.view.selected=oldKey;f.session.stepKeys=[oldKey];
  await f.view.beginEdit(f.view.nodes.find(node=>node.label==='原名'));f.view.editor.find('input')[0].value='改名';f.view.editor.requestSubmit();await settle(f.view);
  assert.ok(f.content.get(f.file.path).includes('改名'));assert.deepEqual(f.session.stepKeys,[newKey]);
  f.view.onKeyDown(keyEvent('z',{metaKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),original);assert.equal(f.content.get('来源.md'),source);
  assert.deepEqual(f.plugin.layout.positions[oldKey],{x:42,y:64});assert.equal(f.plugin.layout.positions[newKey],undefined);assert.deepEqual(f.session.stepKeys,[oldKey]);
  f.view.onKeyDown(keyEvent('Z',{metaKey:true,shiftKey:true}));await settle(f.view);
  assert.equal(f.content.get('来源.md'),source.replace('原名','改名'));assert.ok(f.content.get(f.file.path).includes('改名'));
  assert.deepEqual(f.plugin.layout.positions[newKey],{x:42,y:64});assert.deepEqual(f.session.stepKeys,[newKey]);
});
test('undo refuses external modifications before restoring any file in a multi-file edit',async()=>{
  const f=await fixture('- [[来源.md|原名]]\n');f.addFile('来源.md','- 原名\n');await f.view.refresh();
  await f.view.beginEdit(f.view.nodes[0]);f.view.editor.find('input')[0].value='改名';f.view.editor.requestSubmit();await settle(f.view);
  const changedSource=f.content.get('来源.md');f.content.set(f.file.path,'外部新增内容\n'+f.content.get(f.file.path));
  const external=f.content.get(f.file.path);f.view.onKeyDown(keyEvent('z',{metaKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),external);assert.equal(f.content.get('来源.md'),changedSource);assert.match(globalThis.lastNotice,/其他位置修改/);
});
test('a failure partway through multi-file undo rolls back completed restores and retains the undo entry',async()=>{
  const original='- [[来源.md|原名]]\n',source='- 原名\n',f=await fixture(original);f.addFile('来源.md',source);await f.view.refresh();
  await f.view.beginEdit(f.view.nodes[0]);f.view.editor.find('input')[0].value='改名';f.view.editor.requestSubmit();await settle(f.view);
  const after=f.content.get(f.file.path),afterSource=f.content.get('来源.md'),process=f.app.vault.process;let fail=true;
  f.app.vault.process=async(file,edit)=>{if(file.path===f.file.path&&fail){fail=false;throw new Error('模拟写入失败');}return process(file,edit);};
  f.view.onKeyDown(keyEvent('z',{metaKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),after);assert.equal(f.content.get('来源.md'),afterSource);
  f.view.onKeyDown(keyEvent('z',{metaKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),original);assert.equal(f.content.get('来源.md'),source);
});
test('Command Z during title input is left to native text undo',async()=>{
  const f=await fixture('- A\n');await f.view.beginEdit(f.view.nodes[0]);
  const form=f.view.editor,event=keyEvent('z',{metaKey:true});form.onkeydown(event);f.view.onKeyDown(event);await settle(f.view);
  assert.equal(event.prevented,undefined);assert.equal(f.view.editor,form);assert.equal(f.content.get(f.file.path),'- A\n');
});

test('left drag selects multiple nodes without moving the canvas or disconnecting crossed edges, and batch deletion is one undo',async()=>{
  const original='- A\n  A正文\n- B\n  B正文\n- C\n',f=await fixture(original);placeEdgeNodes(f);
  f.view.onPointerDown(pointerAt(300,250));f.view.onPointerMove(pointerAt(600,350));f.view.onPointerUp(pointerAt(600,350));await settle(f.view);
  assert.deepEqual([...f.view.selectedNodes].sort(),[f.key('A'),f.key('B')].sort());
  assert.deepEqual(f.view.pan,{x:0,y:0});assert.equal(f.content.get(f.file.path),original);
  f.view.onKeyDown(keyEvent('Delete'));await settle(f.view);assert.deepEqual(f.view.nodes.map(node=>node.label),['C']);
  f.view.onKeyDown(keyEvent('z',{metaKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),original);assert.equal(f.view.selectedNodes.size,2);
});
test('left dragging a node moves it while right dragging pans without opening a menu',async()=>{
  const f=await fixture('- A\n- B\n- C\n');placeEdgeNodes(f);const a=f.view.nodes.find(node=>node.label==='A');
  f.view.onPointerDown(pointerAt(350,300));f.view.onPointerMove(pointerAt(600,350));f.view.onPointerUp(pointerAt(600,350));
  assert.equal(a.x,150);assert.equal(a.y,50);assert.equal(f.view.selected,f.key('A'));assert.equal(f.view.selectedNodes.size,0);
  let menus=0;f.view.showContextMenu=()=>menus++;
  const right=(x,y)=>({...pointerAt(x,y),button:2});
  f.view.onPointerDown(right(450,300));f.view.onPointerMove(right(490,330));f.view.onPointerUp(right(490,330));
  assert.deepEqual(f.view.pan,{x:40,y:30});assert.equal(menus,0);assert.equal(f.view.selectedNodes.size,0);
  f.view.onContextMenu(right(490,330));assert.equal(menus,0);
  f.view.onPointerDown(right(450,300));f.view.onPointerUp(right(450,300));assert.equal(menus,1);
  f.view.onContextMenu(right(450,300));assert.equal(menus,1);
});
test('reverse rectangle selection and Escape work at a changed zoom and pan',async()=>{
  const f=await fixture('- A\n- B\n- C\n');placeEdgeNodes(f);f.view.zoom=0.5;f.view.pan={x:40,y:20};
  f.view.onPointerDown(pointerAt(530,340));f.view.onPointerMove(pointerAt(400,280));f.view.onPointerUp(pointerAt(400,280));
  assert.deepEqual([...f.view.selectedNodes].sort(),[f.key('A'),f.key('B')].sort());
  f.view.onKeyDown(keyEvent('Escape'));assert.equal(f.view.selectedNodes.size,0);
  assert.equal(f.content.get(f.file.path),'- A\n- B\n- C\n');
});
test('batch removal of references preserves source Markdown',async()=>{
  const f=await fixture('- A\n- [[来源.md|共享]]\n- C\n');f.addFile('来源.md','- 共享\n  来源正文\n');await f.view.refresh();
  f.view.selectedNodes=new Set([f.key('A'),nodeKey('来源.md',titleID('共享'))]);
  f.view.onKeyDown(keyEvent('Backspace'));await settle(f.view);
  assert.deepEqual(f.view.nodes.map(node=>node.label),['C']);assert.equal(f.content.get('来源.md'),'- 共享\n  来源正文\n');
  f.view.onKeyDown(keyEvent('z',{metaKey:true}));await settle(f.view);
  assert.equal(f.content.get(f.file.path),'- A\n- [[来源.md|共享]]\n- C\n');
});
test('directed edges render moving dashes with separate reverse lanes and reset dash state',async()=>{
  const f=await fixture('- A\n- B\n- A\n');placeEdgeNodes(f);
  const oldWindow=globalThis.window,oldStyle=globalThis.getComputedStyle,oldPerformance=globalThis.performance;
  let time=1000,dash=[],start,end;const strokes=[];
  const ctx=new Proxy({setLineDash(value){dash=[...value];},moveTo(x,y){start={x,y};},lineTo(x,y){end={x,y};},stroke(){if(dash[0]===8)strokes.push({start,end,offset:this.lineDashOffset,dash:[...dash]});},measureText(text){return {width:text.length*8};}}, {get(target,key){return key in target?target[key]:()=>{};}});
  try{
    globalThis.window={devicePixelRatio:1};globalThis.getComputedStyle=()=>({getPropertyValue:()=> '#888'});
    Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>time}});
    f.view.canvas.getContext=()=>ctx;f.view.search=new Element('input');f.view.status={setText(){}};f.view.contentEl.querySelector=()=>null;
    BrainOSGraphView.prototype.draw.call(f.view);
    assert.equal(strokes.length,2);assert.deepEqual(strokes[0].dash,[8,6]);
    assert.equal(Math.sign(strokes[0].end.x-strokes[0].start.x),1);
    assert.equal(Math.sign(strokes[1].end.x-strokes[1].start.x),-1);
    assert.notEqual(strokes[0].start.y,strokes[1].start.y);const firstOffset=strokes[0].offset;
    time=1100;BrainOSGraphView.prototype.draw.call(f.view);assert.notEqual(strokes[2].offset,firstOffset);
    assert.deepEqual(dash,[]);assert.equal(ctx.lineDashOffset,0);assert.notEqual(f.view.rendererFrame,undefined);
  }finally{
    globalThis.window=oldWindow;globalThis.getComputedStyle=oldStyle;Object.defineProperty(globalThis,'performance',{configurable:true,value:oldPerformance});
  }
});

function wheelEvent(overrides={}) {
  return {deltaX:0,deltaY:10,deltaMode:0,ctrlKey:false,clientX:350,clientY:250,preventDefault(){this.prevented=true;},...overrides};
}
function macCanvas(view){view.canvas.ownerDocument={defaultView:{navigator:{platform:'MacIntel'}}};}
test('Mac precise two-finger scroll pans in screen pixels and cancels pending pinch zoom',async()=>{
  const {view}=await fixture('- A\n');macCanvas(view);view.zoom=2;view.pan={x:10,y:20};
  view.targetZoom=3;view.cameraFrame=1;view.zoomAnchor={x:350,y:250};
  const event=wheelEvent({deltaX:24,deltaY:18,wheelDeltaY:-54});view.onWheel(event);
  assert.equal(event.prevented,true);assert.deepEqual(view.pan,{x:-2,y:11});assert.equal(view.zoom,2);
  assert.equal(view.targetZoom,undefined);assert.equal(view.cameraFrame,undefined);
  view.onWheel(wheelEvent({deltaX:-8,deltaY:0,wheelDeltaY:0}));assert.deepEqual(view.pan,{x:2,y:11});
});
test('Mac pinch keeps cursor-anchored zoom while mouse wheels and other platforms retain zoom',async()=>{
  for(const [platform,input] of [
    ['MacIntel',{ctrlKey:true,deltaY:-8,wheelDeltaY:24}],
    ['MacIntel',{deltaY:100,wheelDeltaY:-120}],
    ['MacIntel',{deltaMode:1,deltaY:3,wheelDeltaY:-120}],
    ['Win32',{deltaY:18,wheelDeltaY:-54}],
  ]){
    const {view}=await fixture('- A\n');view.canvas.ownerDocument={defaultView:{navigator:{platform}}};
    view.onWheel(wheelEvent(input));assert.deepEqual(view.pan,{x:0,y:0});
    assert.notEqual(view.targetZoom,undefined);assert.deepEqual(view.zoomAnchor,{x:350,y:250});
    // Run the existing animation to completion and check the cursor's world point.
    const before=view.screenToWorld(350,250),oldRAF=globalThis.requestAnimationFrame;
    const frames=[];globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
    try{view.cameraFrame=undefined;view.animateZoom();while(frames.length)frames.shift()();}
    finally{globalThis.requestAnimationFrame=oldRAF;}
    const after=view.screenToWorld(350,250);assert.ok(Math.abs(before.x-after.x)<1e-8);assert.ok(Math.abs(before.y-after.y)<1e-8);
  }
});
test('wheel input leaves the camera unchanged during inline editing',async()=>{
  const {view}=await fixture('- A\n');macCanvas(view);view.editor={};
  view.onWheel(wheelEvent({deltaX:24,deltaY:18,wheelDeltaY:-54}));
  assert.deepEqual(view.pan,{x:0,y:0});assert.equal(view.targetZoom,undefined);
});
