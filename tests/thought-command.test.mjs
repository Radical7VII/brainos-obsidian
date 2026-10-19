import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
const bundled=await build({
  stdin:{contents:'export {default as BrainOSPlugin} from "./src/main";export {Modal,TFile,MarkdownView} from "obsidian";',resolveDir:process.cwd()},
  bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'obsidian-test',setup(b){
    b.onResolve({filter:/^\.\/graph-view$/},()=>({path:'graph',namespace:'mock'}));
    b.onResolve({filter:/^obsidian$/},()=>({path:'obsidian',namespace:'mock'}));
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:args.path==='graph'?`
      export const VIEW_TYPE='brainos-graph-view';export class BrainOSGraphView {}
    `:`
      export class TFile {constructor(path){this.path=path;this.extension='md';this.basename=path.split('/').pop().slice(0,-3);}}
      export const normalizePath=path=>path.replace(/\\/+/g,'/');
      export class MarkdownView{};export class Notice{constructor(text){globalThis.lastNotice=text;}}
      export class Modal{static opened=0;open(){Modal.opened++;}}
      export class PluginSettingTab{constructor(){}}
      export class Setting{}
      export class Plugin{
        commands=[];async loadData(){return null;}async saveData(){}registerEvent(){}registerView(){}
        addRibbonIcon(){}addSettingTab(){}addCommand(command){this.commands.push(command);}
      }
    `}));
  }}],
});
const {BrainOSPlugin,TFile,Modal,MarkdownView}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
function fixture(){
  const files=new Map(),states=[];let tabs=0;
  const leaf={view:{getViewType:()=> 'empty'},setViewState:async state=>states.push(state)};
  const plugin=new BrainOSPlugin();plugin.app={
    vault:{getAbstractFileByPath:path=>files.get(path),getMarkdownFiles:()=>[...files.values()].filter(f=>f instanceof TFile),createFolder:async path=>files.set(path,{path}),create:async(path,text)=>{if(files.has(path))throw new Error('exists');const f=new TFile(path);f.text=text;files.set(path,f);return f;},on:()=>({})},
    metadataCache:{on:()=>({})},
    workspace:{getActiveFile:()=>null,on:()=>({}),onLayoutReady:()=>{},getLeavesOfType:()=>[],getLeaf:()=>{tabs++;return leaf;},revealLeaf:async()=>{}},
  };
  return {plugin,files,states,get tabs(){return tabs;}};
}
test('new thought command creates an ordinary default MD and opens it directly in mind view',async()=>{
  const f=fixture();await f.plugin.onload();
  const command=f.plugin.commands.find(c=>c.id==='create-thought');assert.equal(command.name,'新建思考');
  // Exercise the same method called by the command, awaiting completion.
  await f.plugin.createNewThought();
  const file=f.files.get('未命名思考.md');assert.ok(file instanceof TFile);
  assert.equal(file.text,'');
  assert.deepEqual(f.states,[{type:'brainos-graph-view',state:{file:file.path},active:true}]);assert.equal(f.tabs,1);
  const original=file.text,dialogs=Modal.opened;
  await f.plugin.createNewThought();
  assert.equal(f.files.get(file.path).text,original);assert.equal(f.tabs,1);
  assert.equal(Modal.opened,dialogs+1);assert.equal([...f.files.keys()].filter(p=>p.endsWith('.md')).length,1);
  await f.plugin.createNewThought('第二个方向');
  assert.ok(f.files.has('第二个方向.md'));
});
test('rapid new thought commands create just one file and one tab',async()=>{
  const f=fixture();await Promise.all([f.plugin.createNewThought(),f.plugin.createNewThought()]);
  assert.equal([...f.files.keys()].filter(p=>p.endsWith('.md')).length,1);assert.equal(f.tabs,1);
});

test('Markdown header integration adds one mind-view icon per tab and removes stale actions',async()=>{
  const f=fixture();let actionCount=0;const view=new MarkdownView();
  view.file=new TFile('A.md');view.addAction=(icon,title,callback)=>{actionCount++;return {icon,title,callback,isConnected:true,addClass(){},parentElement:{prepend(){}},remove(){this.isConnected=false;}};};
  const leaf={view};let leaves=[leaf];f.plugin.app.workspace.iterateAllLeaves=fn=>leaves.forEach(fn);
  f.plugin.syncHeaderActions();f.plugin.syncHeaderActions();assert.equal(actionCount,1);
  const action=f.plugin.headerActions.get(view);assert.equal(action.title,'切换到思维视图');
  leaves=[];f.plugin.syncHeaderActions();assert.equal(action.isConnected,false);assert.equal(f.plugin.headerActions.size,0);
});


test('configured destination is used directly and existing saved destinations remain intact',async()=>{
  const f=fixture();f.plugin.loadData=async()=>({settings:{noteFolder:'项目/思考'}});
  await f.plugin.onload();await f.plugin.createNewThought('设计');
  assert.ok(f.files.has('项目/思考/设计.md'));
  assert.ok(!f.files.has('项目/思考/BrainOS'));assert.ok(!f.files.has('项目/思考/Thoughts'));
});
test('Session retains revisits instead of deduplicating the thought route',()=>{
  const f=fixture();f.plugin.startSession('思考.md');
  for(const key of ['A','B','A','A','C'])f.plugin.recordSessionStep(key,'思考.md');
  assert.deepEqual(f.plugin.activeSession.stepKeys,['A','B','A','A','C']);
});
