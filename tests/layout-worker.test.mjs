import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import {build} from 'esbuild';

const bundle=await build({entryPoints:['src/layout-worker.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
test('layout worker handles sync and pin messages using worker-local timers',()=>{
  const messages=[],timers=[];
  const self={postMessage:message=>messages.push(message),setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length;}};
  // No window or global setTimeout is supplied: workers have their own event loop.
  vm.runInNewContext(bundle.outputFiles[0].text,{self,performance:{now:()=>0}});
  const node={path:'a',label:'A',openPath:'a.md',degree:0,thoughts:[],x:30,y:20};
  self.onmessage({data:{type:'sync',revision:8,commandVersion:1,nodes:[node],edges:[],saved:{},local:false}});
  assert.equal(messages.at(-1).revision,8);assert.equal(messages.at(-1).commandVersion,1);
  assert.equal(messages.at(-1).positions.length,2);assert.equal(timers.length,1);
  self.onmessage({data:{type:'pin',path:'a',point:{x:120,y:80},commandVersion:2}});
  timers.shift().callback();
  assert.deepEqual(Array.from(messages.at(-1).positions),[120,80]);
  assert.equal(messages.at(-1).commandVersion,2);
  assert.ok(timers.length>0,'simulation continues on the worker timer');
});
