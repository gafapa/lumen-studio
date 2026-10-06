import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export class Store {
  constructor(root) {
    this.root=path.resolve(root);mkdirSync(this.root,{recursive:true});
    this.db=new DatabaseSync(path.join(root,'studio.sqlite'));
    this.db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, data TEXT NOT NULL);');
    this.listeners=new Set();
    this.db.exec('CREATE TABLE IF NOT EXISTS collections (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS provider_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS library_entries (id TEXT PRIMARY KEY, data TEXT NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS knowledge (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_id TEXT NOT NULL, data TEXT NOT NULL); CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_search USING fts5(id UNINDEXED, project_id UNINDEXED, content, tokenize="unicode61 remove_diacritics 2");');
  }
  list(){return this.db.prepare('SELECT data FROM projects ORDER BY rowid DESC').all().map(row=>JSON.parse(row.data));}
  get(id){const row=this.db.prepare('SELECT data FROM projects WHERE id=?').get(id);return row?JSON.parse(row.data):null;}
  save(project){project.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO projects(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(project.id,JSON.stringify(project));for(const listener of this.listeners)listener({type:'project',projectId:project.id});return project;}
  event(id,type,data={}){const event={type,at:new Date().toISOString(),...data};const row=this.db.prepare('INSERT INTO events(project_id,data) VALUES(?,?)').run(id,JSON.stringify(event));for(const listener of this.listeners)listener({type:'event',projectId:id,event});return {...event,seq:Number(row.lastInsertRowid)};}
  events(id){return this.db.prepare('SELECT seq,data FROM events WHERE project_id=? ORDER BY seq DESC LIMIT 300').all(id).reverse().map(row=>({...JSON.parse(row.data),seq:row.seq}));}
  // Proyectos (colecciones de vídeos). Cada fila de projects es un vídeo con collectionId.
  collections(){return this.db.prepare('SELECT data FROM collections ORDER BY rowid DESC').all().map(row=>JSON.parse(row.data));}
  getCollection(id){const row=this.db.prepare('SELECT data FROM collections WHERE id=?').get(id);return row?JSON.parse(row.data):null;}
  saveCollection(collection){collection.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO collections(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(collection.id,JSON.stringify(collection));for(const listener of this.listeners)listener({type:'collection',collectionId:collection.id});return collection;}
  deleteCollection(id){this.db.prepare('DELETE FROM collections WHERE id=?').run(id);for(const listener of this.listeners)listener({type:'collection',collectionId:id});}
  deleteProject(id){for(const table of ['projects','events','snapshots','provider_jobs'])this.db.prepare(`DELETE FROM ${table} WHERE ${table==='projects'?'id':'project_id'}=?`).run(id);this.db.prepare('DELETE FROM knowledge WHERE project_id=?').run(id);this.db.prepare('DELETE FROM knowledge_search WHERE project_id=?').run(id);for(const listener of this.listeners)listener({type:'project',projectId:id});}
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  setting(id,fallback=null){const row=this.db.prepare('SELECT data FROM settings WHERE id=?').get(id);return row?JSON.parse(row.data):fallback;}
  setSetting(id,data){this.db.prepare('INSERT INTO settings(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id,JSON.stringify(data));return data;}
  job(id){const row=this.db.prepare('SELECT data FROM provider_jobs WHERE id=?').get(id);return row?JSON.parse(row.data):null;}
  saveJob(job){job.updatedAt=new Date().toISOString();this.db.prepare('INSERT INTO provider_jobs(id,project_id,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(job.id,job.projectId,JSON.stringify(job));return job;}
  jobs(projectId){return this.db.prepare('SELECT data FROM provider_jobs WHERE project_id=? ORDER BY rowid DESC').all(projectId).map(row=>JSON.parse(row.data));}
  entries(table){this.assertTable(table);return this.db.prepare(`SELECT data FROM ${table} ORDER BY rowid DESC`).all().map(row=>JSON.parse(row.data));}
  entry(table,id){this.assertTable(table);const row=this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);return row?JSON.parse(row.data):null;}
  putEntry(table,value){this.assertTable(table);value.updatedAt=new Date().toISOString();this.db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(value.id,JSON.stringify(value));return value;}
  assertTable(table){if(!['library_entries'].includes(table))throw new Error('Colección inválida.');}
  snapshot(project,label){const id=randomUUID();const value={id,projectId:project.id,label,at:new Date().toISOString(),project:structuredClone(project)};this.db.prepare('INSERT INTO snapshots(id,project_id,data) VALUES(?,?,?)').run(id,project.id,JSON.stringify(value));return value;}
  snapshots(id){return this.db.prepare('SELECT data FROM snapshots WHERE project_id=? ORDER BY rowid DESC').all(id).map(row=>{const {project,...meta}=JSON.parse(row.data);return meta;});}
  getSnapshot(id,projectId){const row=this.db.prepare('SELECT data FROM snapshots WHERE id=? AND project_id=?').get(id,projectId);return row?JSON.parse(row.data):null;}
  recover(){for(const project of this.list()){if(['running','planning','rendering'].includes(project.status)){project.status='paused';for(const task of project.tasks)if(task.status==='running')task.status='pending';this.save(project);this.event(project.id,'recovered',{message:'Sesión recuperada. Puedes continuar las tareas pendientes.'});}}}
  close(){this.db.close();}
}
