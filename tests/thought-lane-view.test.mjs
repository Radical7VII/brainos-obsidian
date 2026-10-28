import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';

const bundle = await build({
  stdin: {contents: 'export {ThoughtLaneView} from "./src/thought-lane-view";export {TFile} from "obsidian";', resolveDir: process.cwd()},
  bundle: true, write: false, format: 'esm', platform: 'node',
  plugins: [{name: 'obsidian', setup(b) {
    b.onResolve({filter: /^obsidian$/}, () => ({path: 'obsidian', namespace: 'mock'}));
    b.onLoad({filter: /.*/, namespace: 'mock'}, () => ({contents: `
      export class TFile { constructor(path) { this.path=path; this.extension='md'; this.basename=path.slice(0,-3); } }
      export class Component { addChild(c) { return c; } removeChild() {} registerDomEvent(el,type,fn) { el.addEventListener(type,fn); } }
      export class Notice { constructor(message) { globalThis.laneNotice=message; } }
      export class Menu {}
      export class AbstractInputSuggest { constructor() {} close() {} open() {} setValue() {} }
      export const MarkdownRenderer={render:async (_app,text,el,owner)=>{ (globalThis.laneRenders??=[]).push({text,owner});el.setText(text); }};
      export const normalizePath=p=>p;
      export const getAllTags=()=>[];
      export const parseLinktext=p=>({path:p,subpath:''});
      export const prepareFuzzySearch=query=>text=>text.includes(query)?{score:1}:null;
    `}));
  }}],
});
const {ThoughtLaneView, TFile} = await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
class Element {
  constructor(doc, tag='div', options={}) {
    this.doc=doc; this.tag=tag; this.children=[]; this.attrs={...options.attr}; this.classes=new Set((options.cls??'').split(' '));
    this.text=options.text??''; this.value=options.value??''; this.scrollTop=0; this.style={setProperty(){}};
    this.win={requestAnimationFrame:()=>1,cancelAnimationFrame(){}};
  }
  createEl(tag, options) { const child=new Element(this.doc,tag,options); this.children.push(child); return child; }
  createDiv(options) { return this.createEl('div',options); }
  createSpan(options) { return this.createEl('span',options); }
  addClass(cls) { this.classes.add(cls); }
  toggleClass(cls,on) { if(on)this.classes.add(cls);else this.classes.delete(cls); }
  setAttribute(key,value) { this.attrs[key]=value; }
  setText(text) { this.text=text; }
  appendChild(child) { this.children.push(child); }
  addEventListener(type,fn) { ((this.events??={})[type]??=[]).push(fn); }
  dispatchEvent(event) { for(const fn of this.events?.[event.type]??[])fn(event); this['on'+event.type]?.(event); }
  empty() { this.children=[]; }
  all() { return this.children.flatMap(child=>[child,...child.all()]); }
  contains(el) { return this===el||this.all().includes(el); }
  querySelector(selector) { return this.all().find(el=>selector[0]==='.' ? el.classes.has(selector.slice(1)) : el.attrs['data-visit']===selector.match(/"(.*)"/)?.[1]); }
  closest() { return null; }
  focus() { this.doc.activeElement=this; }
  select() {}
  scrollIntoView() {}
}
globalThis.ResizeObserver=class {observe() {} disconnect() {}};
async function fixture(text='- A\n  → B\n\n- B\n') {
  const doc={createElementNS:(_ns,tag)=>new Element(doc,tag)};
  const container=new Element(doc), file=new TFile('思考.md');
  const contents=new Map([[file.path,text]]), files=new Map([[file.path,file]]);
  const app={vault:{cachedRead:async f=>contents.get(f.path),read:async f=>contents.get(f.path),getAbstractFileByPath:path=>files.get(path),
    getMarkdownFiles:()=>[...files.values()],process:async(f,edit)=>contents.set(f.path,edit(contents.get(f.path)))},metadataCache:{getFileCache:()=>({}),getFirstLinkpathDest:path=>files.get(path)}};
  const raw=[],nodes=[];const view=new ThoughtLaneView(app,container,{raw:line=>raw.push(line),changed(){},loadNodes:async()=>nodes});
  view.onload(); await view.show(file);
  const button=label=>container.all().find(el=>el.tag==='button'&&el.text===label);
  return {view,container,contents,file,raw,button,nodes,addFile(path,text){const f=new TFile(path);files.set(path,f);contents.set(path,text);return f;}};
}
async function settle() { for(let i=0;i<15;i++)await new Promise(resolve=>setImmediate(resolve)); }
function key(el,key,extra={}) {
  const event={type:'keydown',target:el,key,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},...extra};
  el.dispatchEvent(event);return event;
}
function type(f,value) { const input=f.container.querySelector('.brainos-lanes-title-input');input.value=value;input.oninput();return input; }

test('selected node shows content without an operation toolbar',async()=>{
  const f=await fixture(); f.button('A').onclick(); await settle();
  const title=f.button('A'),details=f.container.all().find(el=>el.id===title.attrs['aria-controls']);
  assert.equal(title.attrs['aria-expanded'],'true');assert.ok(details);
  assert.equal(f.container.querySelector('.brainos-lanes-actions'),undefined);
  assert.equal(f.container.querySelector('.brainos-lanes-shortcuts'),undefined);
});

test('Escape restores selection and focus without writing a draft',async()=>{
  const f=await fixture();f.button('A').onclick();await settle();
  const original=f.contents.get(f.file.path);
  key(f.button('A'),'Tab');await settle();
  assert.equal(f.button('确认'),undefined);assert.equal(f.button('取消'),undefined);
  key(f.container.querySelector('.brainos-lanes-title-input'),'Escape');await settle();
  assert.equal(f.contents.get(f.file.path),original);
  assert.equal(f.container.doc.activeElement,f.button('A'));
  assert.equal(f.button('A').attrs['aria-expanded'],'true');
});

test('Enter saves a continuation and does not duplicate the parent node',async()=>{
  const f=await fixture();key(f.button('A'),'Tab');await settle();
  key(type(f,'C'),'Enter');await settle();
  assert.match(f.contents.get(f.file.path),/→ C/);
  assert.ok(f.button('C'));assert.equal(f.container.querySelector('.brainos-lanes-title-input'),undefined);
  assert.equal(f.container.doc.activeElement,f.button('C'));
});

test('split views use distinct detail region IDs',async()=>{
  const a=await fixture(),b=await fixture();
  a.button('A').onclick();b.button('A').onclick();await settle();
  assert.notEqual(a.button('A').attrs['aria-controls'],b.button('A').attrs['aria-controls']);
});

test('keyboard alone creates the first node, extends with Tab and edits with Space',async()=>{
  const f=await fixture('');
  assert.equal(key(f.container,'Tab').defaultPrevented,true);await settle();
  key(type(f,'起点'),'Tab');await settle();
  assert.ok(f.container.querySelector('.brainos-lanes-title-input'));
  key(type(f,'子节点'),'Enter');await settle();
  assert.equal(f.container.doc.activeElement,f.button('子节点'));
  key(f.button('子节点'),' ');await settle();
  key(type(f,'已改名'),'Enter');await settle();
  assert.equal(f.container.doc.activeElement,f.button('已改名'));
  assert.match(f.contents.get(f.file.path),/→ 已改名/);
  assert.doesNotMatch(f.contents.get(f.file.path),/子节点/);
});

test('Enter branches from the latest record arrival rather than the last visually sorted parent',async()=>{
  const f=await fixture('- A\n  → B\n\n- C\n  → B\n\n- B\n\n- A\n  → B\n\n- B\n');
  key(f.button('B'),'Enter');await settle();
  key(type(f,'同级'),'Enter');await settle();
  assert.match(f.contents.get(f.file.path),/- A\n  → 同级\n\n- 同级/);
  assert.equal(f.container.doc.activeElement,f.button('同级'));
});

test('IME confirmation and repeated keys never save a partial draft',async()=>{
  const f=await fixture();key(f.button('A'),'Tab');await settle();
  const input=type(f,'输入中'),before=f.contents.get(f.file.path);
  key(input,'Enter',{isComposing:true});key(input,'Tab',{repeat:true});await settle();
  assert.equal(f.contents.get(f.file.path),before);
  key(input,'Escape');await settle();assert.equal(f.contents.get(f.file.path),before);
});

test('Space edits title and body on the graph and preserves other records and edges',async()=>{
  const f=await fixture('- A\n  第一段\n  → B\n\n- B\n\n- A\n  第二段\n');
  key(f.button('A'),' ');await settle();
  const title=type(f,'改名'),body=f.container.querySelector('.brainos-lanes-body-input');
  assert.equal(body.value,'第二段');
  key(title,'ArrowDown');assert.equal(f.container.doc.activeElement,body);
  body.value='直接在图里编辑\n保留换行';body.oninput();
  key(body,'Enter',{ctrlKey:true});await settle();
  assert.equal(f.raw.length,0);
  assert.match(f.contents.get(f.file.path),/第一段/);
  assert.match(f.contents.get(f.file.path),/直接在图里编辑\n  保留换行/);
  assert.match(f.contents.get(f.file.path),/→ B/);
  assert.equal(f.container.doc.activeElement,f.button('改名'));
});

test('Space edits a referenced source on the current graph instead of opening Raw',async()=>{
  const f=await fixture('- [[来源.md|来源节点]]\n');
  f.addFile('来源.md','- 来源节点\n  来源正文\n');
  key(f.button('来源节点'),' ');await settle();
  assert.equal(f.raw.length,0);
  const body=f.container.querySelector('.brainos-lanes-body-input');
  assert.equal(body.value,'来源正文');body.value='原位更新正文';body.oninput();
  key(body,'Enter',{metaKey:true});await settle();
  assert.match(f.contents.get('来源.md'),/原位更新正文/);
  assert.match(f.contents.get(f.file.path),/\[\[来源.md\|来源节点\]\]/);
  assert.equal(f.raw.length,0);
});


test('normal continuation suggests local and external ideas and directly saves a reference',async()=>{
  const f=await fixture();f.addFile('其他思考.md','- 外部想法\n  正文\n');
  f.nodes.push({path:'其他思考.md#brainos='+encodeURIComponent('name:外部想法'),nodeId:'name:外部想法',ownerPath:'其他思考.md',label:'外部想法'},
    {path:'思考.md#brainos=name:A',nodeId:'name:A',ownerPath:'思考.md',label:'A'});
  f.button('A').onclick();await settle();
  assert.equal(f.button('＋ 链接其他思考'),undefined);
  key(f.button('A'),'Tab');await settle();
  const suggest=f.view.titleSuggest;
  assert.equal((await suggest.getSuggestions('')).length,2);
  const choices=await suggest.getSuggestions('外部');assert.equal(choices.length,1);
  suggest.selectSuggestion(choices[0],{});await settle();
  assert.match(f.contents.get(f.file.path),/→ \[\[其他思考.md\|外部想法\]\]/);
  assert.equal(f.contents.get('其他思考.md'),'- 外部想法\n  正文\n');
  assert.ok(f.container.all().some(el=>el.classes.has('brainos-lanes-origin')&&el.text.includes('其他思考')));
});

test('reference preview uses source-relative links and retains local annotations',async()=>{
  const f=await fixture('- [[目录/来源.md|来源节点]]\n  本地补充\n');
  f.addFile('目录/来源.md','- 来源节点\n  [[相对链接]]\n');
  globalThis.laneRenders=[];
  f.button('来源节点').onclick();await settle();
  assert.ok(globalThis.laneRenders.some(r=>r.text==='[[相对链接]]'&&r.owner==='目录/来源.md'));
  assert.ok(globalThis.laneRenders.some(r=>r.text==='本地补充'&&r.owner==='思考.md'));
  assert.ok(f.button('↗ 打开来源思考'));
});

test('broken reference stays visible and removable without changing source files',async()=>{
  const f=await fixture('- [[不存在.md|失效想法]]\n  保留补充\n');
  f.button('失效想法').onclick();await settle();
  assert.ok(f.container.querySelector('.brainos-lanes-reference-error'));
  assert.ok(f.container.all().some(el=>el.text==='保留补充'));
  key(f.button('失效想法'),'Delete');await settle();
  assert.doesNotMatch(f.contents.get(f.file.path),/不存在/);
});
