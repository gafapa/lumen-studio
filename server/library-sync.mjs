// Biblioteca de material del proyecto: se sube e indexa una vez en collections/<id>/ y se enlaza (hard links)
// en cada vídeo, de modo que todo el pipeline existente la trata como material del vídeo sin copiar archivos.
// Los archivos del índice también se enlazan: las descripciones visuales que guarda un agente son comunes.
import path from 'node:path';
import {mkdir,readdir,link,copyFile,stat,rm} from 'node:fs/promises';
import {indexDirectory} from './media-index.mjs';

export const collectionFolder=(store,collectionId)=>path.join(store.root,'collections',collectionId);
// Interfaz de almacén para que las funciones del índice operen sobre un proyecto como si fuera un vídeo.
export const collectionStore=store=>({get:id=>store.getCollection(id),save:value=>store.saveCollection(value),event:()=>{}});

async function exists(file){try{await stat(file);return true;}catch{return false;}}
async function linkFile(source,target){if(await exists(target))return;await mkdir(path.dirname(target),{recursive:true});try{await link(source,target);}catch{await copyFile(source,target);}}
async function linkTree(source,target){let entries=[];try{entries=await readdir(source,{withFileTypes:true});}catch{return;}for(const entry of entries){const from=path.join(source,entry.name),to=path.join(target,entry.name);if(entry.isDirectory())await linkTree(from,to);else await linkFile(from,to);}}

// Incorpora al vídeo el material del proyecto (scope: 'project') y retira lo que el proyecto ya no tiene.
export async function syncLibrary(store,videoId,folderFor){
  const video=store.get(videoId);if(!video?.collectionId)return video;
  const collection=store.getCollection(video.collectionId);if(!collection)return video;
  const source=collectionFolder(store,collection.id),target=folderFor(videoId),library=collection.assets||[],ids=new Set(library.map(asset=>asset.id));
  const assets=(video.assets||[]).filter(asset=>asset.scope!=='project'||ids.has(asset.id));
  for(const asset of library){
    const file='media/'+path.basename(asset.path);
    try{await linkFile(path.join(source,asset.path),path.join(target,file));}catch{continue;}
    const index=collection.mediaIndex?.[asset.id];
    if(index?.status==='ready'){const indexTarget=indexDirectory(target,asset.id);if(!await exists(path.join(indexTarget,'index.json'))){await rm(indexTarget,{recursive:true,force:true});await linkTree(indexDirectory(source,asset.id),indexTarget);}}
    const entry={...asset,path:file,scope:'project'},at=assets.findIndex(item=>item.id===asset.id);if(at>=0)assets[at]=entry;else assets.push(entry);
  }
  const latest=store.get(videoId);latest.assets=assets;latest.mediaIndex={...Object.fromEntries(Object.entries(latest.mediaIndex||{}).filter(([id])=>!ids.has(id)||collection.mediaIndex?.[id])),...Object.fromEntries(library.filter(asset=>collection.mediaIndex?.[asset.id]).map(asset=>[asset.id,collection.mediaIndex[asset.id]]))};
  for(const id of Object.keys(latest.mediaIndex))if(!assets.some(asset=>asset.id===id)&&!(latest.recordings||[]).some(recording=>recording.id===id))delete latest.mediaIndex[id];
  return store.save(latest);
}
export async function syncCollection(store,collectionId,folderFor,active=new Map()){
  for(const video of store.list().filter(item=>item.collectionId===collectionId&&!active.has(item.id)))await syncLibrary(store,video.id,folderFor).catch(()=>{});
}
