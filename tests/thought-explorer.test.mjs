import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/thought-explorer.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {ThoughtExplorer}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
function target(path,explorer=true){
  const row={getAttribute:()=>path,closest:()=>explorer?{}:null};
  return {closest:()=>row};
}
function fixture(){
  const previews=[],selections=[];let active=true;
  const bridge=new ThoughtExplorer({accepts:path=>path.startsWith('Thoughts/')&&path.endsWith('.md'),
    preview:path=>previews.push(path),select:path=>{if(!active)return false;selections.push(path);return true;}});
  return {bridge,previews,selections,setActive:value=>active=value};
}
test('native explorer child transitions preserve preview; switching rows and leaving restore focus',()=>{
  const f=fixture(),a=target('Thoughts/A.md'),b=target('Thoughts/sub/B.md');
  f.bridge.over({target:a});f.bridge.over({target:a});f.bridge.out({relatedTarget:a});
  assert.deepEqual(f.previews,['Thoughts/A.md']);
  f.bridge.out({relatedTarget:b});f.bridge.over({target:b});f.bridge.out({relatedTarget:null});
  assert.deepEqual(f.previews,['Thoughts/A.md','Thoughts/sub/B.md',undefined]);assert.deepEqual(f.selections,[]);
});
test('only eligible Markdown files in the native explorer drive previews',()=>{
  const f=fixture();
  for(const node of [target('Outside.md'),target('Thoughts/image.png'),target('Thoughts/A.md',false)])f.bridge.over({target:node});
  assert.deepEqual(f.previews,[]);
});
test('plain clicks select in the canvas while modified clicks and normal Markdown editing stay native',()=>{
  const f=fixture();
  const event=(extra={})=>({target:target('Thoughts/A.md'),button:0,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra});
  const plain=event();f.bridge.click(plain);assert.equal(plain.prevented,true);assert.equal(plain.stopped,true);
  for(const extra of [{metaKey:true},{ctrlKey:true},{shiftKey:true},{altKey:true},{button:1}]){
    const modified=event(extra);f.bridge.click(modified);assert.equal(modified.prevented,undefined);
  }
  f.setActive(false);const native=event();f.bridge.click(native);assert.equal(native.prevented,undefined);
  assert.deepEqual(f.selections,['Thoughts/A.md']);
});
