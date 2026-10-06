import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {Store} from '../server/store.mjs';
const folders=(await readdir('.data')).filter(name=>name.startsWith('ui-tests-')).sort();
for(const name of folders.slice(-1)){
  const store=new Store(path.resolve('.data',name));
  for(const project of store.list().filter(item=>!item.example))console.log({id:project.id,status:project.status,error:project.error,tasks:project.tasks.map(task=>({id:task.id,status:task.status,error:task.error})),events:store.events(project.id).filter(event=>event.type==='render.progress'||event.type==='task.retry')});store.close();
}
