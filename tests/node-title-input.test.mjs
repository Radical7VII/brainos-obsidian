import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const compiled=await transform(await readFile(new URL('../src/node-title-input.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {titleKeyAction}=await import('data:text/javascript;base64,'+Buffer.from(compiled.code).toString('base64'));
const key=value=>({key:value,isComposing:false,keyCode:0,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false});
test('Enter confirms, Tab confirms and continues, Escape cancels the inline draft',()=>{
  assert.equal(titleKeyAction(key('Enter')),'commit');
  assert.equal(titleKeyAction(key('Tab')),'continue');
  assert.equal(titleKeyAction(key('Escape')),'cancel');
});
test('native KeyboardEvent prototype properties are preserved',()=>{
  const event=Object.create({key:'Enter',isComposing:false,ctrlKey:false,metaKey:false,altKey:false,shiftKey:false});
  assert.equal(Object.keys(event).length,0);
  assert.equal(titleKeyAction(event),'commit');
});
test('Chinese composition confirmation never creates a node prematurely',()=>{
  assert.equal(titleKeyAction({...key('Enter'),isComposing:true}),'none');
  assert.equal(titleKeyAction({...key('Enter'),keyCode:229}),'none');
});
test('modified shortcuts and Shift-Tab retain normal keyboard behavior',()=>{
  assert.equal(titleKeyAction({...key('Tab'),shiftKey:true}),'none');
  assert.equal(titleKeyAction({...key('Enter'),metaKey:true}),'none');
  assert.equal(titleKeyAction({...key('Enter'),ctrlKey:true}),'none');
});
