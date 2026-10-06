// Página de inspección para escenas Remotion: un Thumbnail de @remotion/player que muestra el fotograma pedido,
// empaquetado con esbuild. Permite medir el DOM (textos, cajas, colores) igual que en HyperFrames.
import path from 'node:path';
import {mkdir,writeFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exists=async file=>{try{await stat(file);return true;}catch{return false;}};

export async function buildRemotionInspector(dir,brief){
  const scene=await exists(path.join(dir,'Scene.tsx'))?'Scene.tsx':'Scene.jsx',out=path.join(dir,'.lumen','inspect-page'),frames=Math.max(1,Math.round(brief.durationSeconds*brief.fps));
  await mkdir(out,{recursive:true});
  const entry=path.join(out,'entry.jsx');
  await writeFile(entry,`import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Thumbnail} from '@remotion/player';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/dm-sans/400.css';
import '@fontsource/dm-sans/700.css';
import Scene from '../../${scene}';
let setFrame=()=>{};
const App=()=>{const [frame,set]=useState(0);setFrame=set;return <Thumbnail component={Scene} compositionWidth={${brief.width}} compositionHeight={${brief.height}} durationInFrames={${frames}} fps={${brief.fps}} frameToDisplay={frame} style={{width:${brief.width},height:${brief.height}}} inputProps={{}}/>;};
window.__lumenSeek=frame=>new Promise(resolve=>{setFrame(Math.min(${frames-1},Math.max(0,frame)));requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,30)));});
createRoot(document.getElementById('root')).render(<App/>);
setTimeout(()=>{window.__lumenReady=true;},400);
`);
  const {build}=await import('esbuild');
  await build({entryPoints:[entry],bundle:true,outfile:path.join(out,'bundle.js'),format:'iife',jsx:'automatic',loader:{'.woff2':'file','.woff':'file','.ttf':'file','.png':'file','.jpg':'file','.svg':'file'},nodePaths:[path.join(root,'node_modules')],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent',publicPath:'/'});
  await writeFile(path.join(out,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:#000}</style><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);
  return {dir:out,fallback:path.join(dir,'assets')};
}
