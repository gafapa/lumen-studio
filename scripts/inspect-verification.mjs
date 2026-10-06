import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.data/verification');
for(const name of (await readdir(root)).filter(name=>name.startsWith('desktop-')).sort().slice(-2)){
  const base=path.join(root,name,'projects');
  for(const project of await readdir(base)){
    const folder=path.join(base,project);
    try{const result=JSON.parse(await readFile(path.join(folder,'runs/codex/result.json'),'utf8'));console.log('Resultado',name,result);}catch{}
    try{console.log('Stderr',await readFile(path.join(folder,'runs/codex/stderr.txt'),'utf8'));}catch{}
    try{const events=(await readFile(path.join(folder,'runs/codex/events.jsonl'),'utf8')).split('\n').filter(Boolean).map(JSON.parse);console.log('Tipos',events.map(event=>event.item?.type||event.type));for(const event of events){const item=event.item;if(item?.type==='mcp_tool_call')console.log('Herramienta',{type:event.type,server:item.server,tool:item.tool,status:item.status,error:item.error,text:item.result?.content?.filter(block=>block.type==='text').map(block=>block.text)});}}catch{}
    const {Store}=await import('../server/store.mjs');const store=new Store(path.join(root,name));console.log('Grabaciones',store.get(project)?.recordings);store.close();
  }
}
