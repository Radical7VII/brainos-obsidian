// Simulate Obsidian's native creation boundary for plugin tests.
export function installNativeFileManager(app) {
  const calls=[];
  app.vault.getRoot=()=>({path:''});
  app.vault.getFolderByPath=path=>app.vault.getAbstractFileByPath(path);
  app.fileManager={createNewMarkdownFile:async(parent,name,content)=>{
    calls.push({parent:parent.path,name,content});
    const base=(parent.path?parent.path+'/':'')+name;
    let path=base+'.md';
    for(let suffix=1;app.vault.getAbstractFileByPath(path);suffix++)path=base+' '+suffix+'.md';
    return app.vault.create(path,content);
  }};
  return calls;
}
