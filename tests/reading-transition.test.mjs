import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/reading-transition.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {ReadingTransition}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const node=(path,x,y)=>({path,x,y});
const run=(transition,nodes,targets,requested,zoom,from,count=240)=>{
  let moving;
  for(let i=0;i<count;i++)moving=transition.step(nodes,targets,requested,zoom,from+i*16);
  return moving;
};
test('reading unfolds smoothly and returns completely to untouched free coordinates',()=>{
  const transition=new ReadingTransition(),nodes=[node('A',0,0),node('B',-100,80)],targets={A:{x:0,y:0},B:{x:500,y:0}},before=structuredClone(nodes);
  assert.equal(transition.step(nodes,targets,true,1,0),true);
  const first=transition.get('B');assert.ok(first.x>-100&&first.x<500);assert.ok(first.y>0&&first.y<80);
  assert.equal(run(transition,nodes,targets,true,1,16),false);assert.ok(transition.get('B').x>450);
  const reading={...transition.get('B')};transition.step(nodes,{},false,1,4000);
  assert.ok(transition.get('B').x<reading.x&&transition.get('B').x>-100);
  assert.equal(run(transition,nodes,{},false,1,4016),false);assert.deepEqual(transition.get('B'),{x:-100,y:80});
  assert.deepEqual(nodes,before);
});
test('overview zoom restores freedom and zooming in restores the requested reading state',()=>{
  const t=new ReadingTransition(),nodes=[node('A',0,0)],targets={A:{x:400,y:100}};
  run(t,nodes,targets,true,1,0);assert.ok(t.get('A').x>350);
  run(t,nodes,targets,true,0.3,4000);assert.deepEqual(t.get('A'),{x:0,y:0});
  run(t,nodes,targets,true,1,8000);assert.ok(t.get('A').x>350);
});
test('the interaction anchor stays fixed, held drags follow exactly and reduced motion is immediate',()=>{
  const t=new ReadingTransition(),nodes=[node('A',50,20),node('B',100,20)],targets={A:{x:500,y:200},B:{x:700,y:200}};
  for(let i=0;i<240;i++)t.step(nodes,targets,true,1,i*16,{x:-450,y:-180});
  assert.deepEqual(t.get('A'),{x:50,y:20});assert.ok(t.get('B').x>200);
  t.step(nodes,targets,false,1,4000,{x:0,y:0},{key:'B',point:{x:900,y:300}});
  assert.deepEqual(t.get('B'),{x:900,y:300});
  t.step(nodes,targets,false,1,4016,undefined,undefined,true);assert.deepEqual(t.get('B'),{x:100,y:20});
});
test('frame timing is bounded after suspension and dead node presentation is removed',()=>{
  const t=new ReadingTransition(),nodes=[node('A',0,0),node('B',0,0)],targets={A:{x:10000,y:0},B:{x:10,y:10}};
  t.step(nodes,targets,true,1,0);const before=t.get('A').x;
  t.step(nodes,targets,true,1,100000);assert.ok(t.get('A').x-before<=96.01);
  t.step([nodes[0]],targets,false,1,100016);assert.equal(t.get('B'),undefined);
});
