import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:'export * from "./src/thought-reading-layout";export * from "./src/graph-label-placement";export {GraphLayout} from "./src/graph-layout";',resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',plugins:[{name:'worker-test',setup(b){
  b.onResolve({filter:/\?worker$/},()=>({path:'worker',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export default ""',loader:'js'}));
}}]});
const {ThoughtReadingLayout,RectIndex,rectsOverlap,placeGraphLabels,GraphLayout}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const node=(path,x=0,y=0)=>({path,label:path,openPath:'T.md',thoughts:['T'],x,y,degree:0});
const visits=(paths,thought='T')=>paths.flatMap((path,pathIndex)=>path.map((key,ordinal)=>({key,thoughtPath:thought,pathIndex,ordinal,title:key,body:''})));
const size=()=>({width:180,top:-10,bottom:60});
const box=(p,s=size())=>({left:p.x-s.width/2,right:p.x+s.width/2,top:p.y+s.top,bottom:p.y+s.bottom});

test('branches and uneven merges read left to right without changing base coordinates',()=>{
  const nodes=['A','B','Z','C','D','E'].map((id,i)=>node(id,400-i*80,(i%2)*12));const before=structuredClone(nodes);
  const result=new ThoughtReadingLayout().sync('T',nodes,visits([['A','B','Z'],['A','C','D','E','Z']]),size);
  for(const path of [['A','B','Z'],['A','C','D','E','Z']])for(let i=1;i<path.length;i++)assert.ok(result[path[i]].x>result[path[i-1]].x);
  assert.notEqual(result.B.y,result.C.y);assert.deepEqual(nodes,before);
  for(const [a,p] of Object.entries(result))for(const [b,q] of Object.entries(result))if(a!==b)assert.ok(!rectsOverlap(box(p),box(q)));
});
test('real cycles retain return edges, independent roots, and one identity per node',()=>{
  const nodes=['A','B','C','D','Root','Tail'].map(id=>node(id));
  const result=new ThoughtReadingLayout().sync('T',nodes,visits([['A','B','C','A','D'],['Root','Tail']]),size);
  assert.equal(Object.keys(result).length,6);
  assert.ok(result.A.x<result.B.x&&result.B.x<result.C.x);assert.ok(result.C.x>result.A.x);
  assert.ok(result.A.x<result.D.x);assert.ok(result.Root.x<result.Tail.x);
  assert.notEqual(result.Root.y,result.A.y);assert.ok(Object.values(result).every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
test('appending and adding siblings preserve all old reading positions and distant background',()=>{
  const layout=new ThoughtReadingLayout(),nodes=['A','B','C','Far'].map((id,i)=>node(id,i===3?-2000:0,i===3?2000:0));
  const first=structuredClone(layout.sync('T',nodes,visits([['A','B','C']]),size));
  const extended=layout.sync('T',[...nodes,node('D'),node('Sibling')],visits([['A','B','C','D'],['A','Sibling']]),size);
  for(const key of ['A','B','C'])assert.deepEqual(extended[key],first[key]);
  assert.deepEqual(nodes[3],node('Far',-2000,2000));assert.ok(extended.D.x>extended.C.x);
});
test('long measured titles reserve enough room and widening only moves necessary successors',()=>{
  const layout=new ThoughtReadingLayout(),nodes=['A','B','C'].map(id=>node(id));const steps=visits([['A','B','C']]);
  const first=structuredClone(layout.sync('T',nodes,steps,size));
  const wide=n=>({width:n.path==='B'?300:180,top:-10,bottom:n.path==='B'?130:60});
  const result=layout.sync('T',nodes,steps,wide);
  assert.deepEqual(result.A,first.A);assert.ok(result.B.x>first.B.x);assert.ok(result.C.x>first.C.x);
  for(const a of nodes)for(const b of nodes)if(a!==b)assert.ok(!rectsOverlap(box(result[a.path],wide(a)),box(result[b.path],wide(b))));
});
test('contexts preserve manual reading positions and switching thoughts restores their own geometry',()=>{
  const layout=new ThoughtReadingLayout(),nodes=['A','B','C'].map(id=>node(id));const t=visits([['A','B']]),u=visits([['C','B']],'U');
  const first=layout.sync('T',nodes,t,size);layout.move('T','A',{x:first.A.x,y:first.A.y+100});
  const remembered=structuredClone(first);layout.sync('U',nodes,u,size);
  assert.deepEqual(layout.sync('T',nodes,t,size),remembered);
});
test('screen titles avoid each other and dots at multiple zooms, with focused labels taking precedence',()=>{
  for(const zoom of [0.45,1,2]){
    const dots=Array.from({length:10},(_,i)=>({key:String(i),point:{x:100+(i%5)*60*zoom,y:100+Math.floor(i/5)*90*zoom},radius:10*Math.sqrt(zoom)}));
    const labels=dots.map(dot=>({...dot,width:150*Math.sqrt(zoom),height:38*Math.sqrt(zoom),priority:dot.key==='4'?3:1}));
    const placed=placeGraphLabels(labels,dots);assert.ok(placed.has('4'));
    for(const [key,rect] of placed){
      for(const [other,second] of placed)if(key!==other)assert.ok(!rectsOverlap(rect,second,3));
      for(const dot of dots)assert.ok(!rectsOverlap(rect,{left:dot.point.x-dot.radius,right:dot.point.x+dot.radius,top:dot.point.y-dot.radius,bottom:dot.point.y+dot.radius}));
    }
    assert.deepEqual(placeGraphLabels([...labels].reverse(),dots),placed);
  }
});
test('spatial hash handles negative coordinates, replacements and removal',()=>{
  const index=new RectIndex();index.set('A',{left:-200,right:-100,top:-100,bottom:0});
  assert.equal(index.collides({left:-180,right:-140,top:-80,bottom:-20}),true);
  index.set('A',{left:200,right:300,top:100,bottom:200});
  assert.equal(index.collides({left:-180,right:-140,top:-80,bottom:-20}),false);index.delete('A');
  assert.equal(index.collides({left:220,right:280,top:120,bottom:180}),false);
});
test('shared graph edits move nearby nodes, preserve distant nodes, and retain motion after release',()=>{
  const layout=new GraphLayout(()=>{}),nodes=[node('A',500,200),node('Far',-3000,700)];
  let time=0;const tick=()=>layout.tick(nodes,time+=1000/60);
  try{
    layout.sync(nodes,[],{},true);const before=layout.snapshot();assert.equal(layout.isRunning,false);
    nodes.push(node('B',NaN,NaN));layout.sync(nodes,[{from:'A',to:'B',thoughts:['T']}],{},true);
    for(let i=0;i<50;i++)tick();
    assert.notDeepEqual(layout.snapshot().A,before.A);assert.deepEqual(layout.snapshot().Far,before.Far);
    layout.pin('A',before.A);layout.movePinned('A',{x:650,y:220});tick();
    assert.deepEqual(layout.snapshot().A,{x:650,y:220});layout.unpin('A');
    for(let i=0;i<60;i++)tick();
    assert.notDeepEqual(layout.snapshot().A,{x:650,y:220});assert.deepEqual(layout.snapshot().Far,before.Far);
    layout.sync(nodes,[],{},false);assert.equal(layout.isRunning,true);tick();assert.notDeepEqual(layout.snapshot().Far,before.Far);
  }finally{layout.dispose();}
});


test('global physics has equal trajectories at 60 Hz and 120 Hz, then cools',()=>{
  const simulate=hz=>{
    const layout=new GraphLayout(()=>{}),nodes=[node('A',-500,200),node('B',500,-200),node('Far',1800,900)];
    try{
      layout.sync(nodes,[{from:'A',to:'B',thoughts:['T']}],{},false);
      for(let frame=0;frame<=hz;frame++)layout.tick(nodes,frame*1000/hz);
      const afterSecond=layout.snapshot();
      assert.notDeepEqual(afterSecond.Far,{x:1800,y:900});
      for(let frame=hz+1;frame<=hz*6;frame++)layout.tick(nodes,frame*1000/hz);
      assert.equal(layout.isRunning,false);
      return afterSecond;
    }finally{layout.dispose();}
  };
  assert.deepEqual(simulate(60),simulate(120));
});

test('resuming after a long pause limits physics catch-up',()=>{
  const layout=new GraphLayout(()=>{}),nodes=[node('A',500,200)];
  try{
    layout.sync(nodes,[],{},false);layout.tick(nodes,0);layout.tick(nodes,60000);
    assert.equal(layout.isRunning,true,'does not fast-forward the entire cooling period');
    assert.ok(Number.isFinite(nodes[0].x));
  }finally{layout.dispose();}
});
