import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {transform} from 'esbuild';
const compiled = await transform(await readFile(new URL('../src/mind-view-mode.ts',import.meta.url),'utf8'), {loader:'ts',format:'esm'});
const {MindViewMode,VIEW_TYPE} = await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
function fixture(path='笔记/A.md',mode='source') {
  const calls=[];
  const ephemeral={cursor:{line:8,ch:2},scroll:120};
  const leaf={
    view:{getViewType:()=> 'markdown',getState:()=>({file:path,mode,source:false}),getEphemeralState:()=>ephemeral},
    async setViewState(state) {
      calls.push(state);
      this.view={getViewType:()=>state.type,getState:()=>state.state,getEphemeralState:()=>this.ephemeral??{},setEphemeralState:value=>{this.ephemeral=value;}};
    },
  };
  return {leaf,calls,ephemeral};
}
test('same leaf switches to its file and restores native reading mode, cursor and scroll',async()=>{
  const {leaf,calls,ephemeral}=fixture('笔记/A.md','preview');const modes=new MindViewMode();
  await modes.showMind(leaf,'笔记/A.md');
  assert.deepEqual(calls[0],{type:VIEW_TYPE,state:{file:'笔记/A.md'},active:true});
  await modes.showMarkdown(leaf,'笔记/A.md');
  assert.equal(calls[1].type,'markdown');assert.equal(calls[1].state.mode,'preview');
  assert.deepEqual(leaf.ephemeral,ephemeral);
});
test('Raw round trips retain the selected occurrence, display mode and lane scroll',async()=>{
  const {leaf}=fixture();const modes=new MindViewMode();
  await modes.showMind(leaf,'笔记/A.md');
  const selected={selected:4,scrollTop:180,displayMode:'lanes'};
  leaf.view.getEphemeralState=()=>selected;
  await modes.showMarkdown(leaf,'笔记/A.md');
  await modes.showMind(leaf,'笔记/A.md');
  assert.deepEqual(leaf.ephemeral,selected);
});
test('following another file in mind view does not reuse the previous file cursor',async()=>{
  const {leaf,calls}=fixture();const modes=new MindViewMode();
  await modes.showMind(leaf,'笔记/A.md');await modes.showMarkdown(leaf,'笔记/B.md');
  assert.deepEqual(calls[1].state,{file:'笔记/B.md',mode:'source'});
  assert.equal(leaf.ephemeral,undefined);
});
test('a new thought and restored workspace view can switch to a normal Markdown editor',async()=>{
  const {leaf,calls}=fixture();leaf.view.getViewType=()=>VIEW_TYPE;
  const modes=new MindViewMode();await modes.showMarkdown(leaf,'未命名思考.md');
  assert.deepEqual(calls[0],{type:'markdown',state:{file:'未命名思考.md',mode:'source'},active:true});
});
test('each split retains its own editor mode',async()=>{
  const a=fixture('A.md','preview'),b=fixture('B.md','source');const modes=new MindViewMode();
  await modes.showMind(a.leaf,'A.md');await modes.showMind(b.leaf,'B.md');
  await modes.showMarkdown(a.leaf,'A.md');await modes.showMarkdown(b.leaf,'B.md');
  assert.equal(a.calls[1].state.mode,'preview');assert.equal(b.calls[1].state.mode,'source');
});
test('rapid clicks do not duplicate view replacement, and a failure releases the switch',async()=>{
  const {leaf,calls}=fixture();const modes=new MindViewMode();
  let finish;leaf.setViewState=async state=>{calls.push(state);await new Promise(resolve=>finish=resolve);};
  const first=modes.showMind(leaf,'笔记/A.md');await modes.showMind(leaf,'笔记/A.md');
  assert.equal(calls.length,1);finish();await first;
  leaf.setViewState=async()=>{throw new Error('view failed');};
  await assert.rejects(()=>modes.showMarkdown(leaf,'笔记/A.md'),/view failed/);
  leaf.setViewState=async state=>calls.push(state);
  await modes.showMind(leaf,'笔记/A.md');assert.equal(calls.length,2);
});
