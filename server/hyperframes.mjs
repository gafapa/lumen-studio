import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {execute} from './process.mjs';
import {captionGroups} from './captions.mjs';
import {layeredHtml,designAnimation} from './design-html.mjs';
import {advancedDesign} from '../src/video/design.mjs';
import {outputSpec} from '../src/video/output.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const escape=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export function compositionHtml(scene,media,project){
  if(advancedDesign(scene,project.profile))return layeredHtml(scene,media,project);
  const themes={technology:{background:'#111b31',ink:'#f5f8ff',accent:'#65dacf',card:'#1d2b45'},whiteboard:{background:'#f7f3e9',ink:'#292f32',accent:'#dc8652',card:'#ffffff'}};
  const theme={...(themes[project.style]||themes[['documentary','news'].includes(project.style)?'technology':project.style==='presentation'?'whiteboard':'editorial']||{background:'#eae5ff',ink:'#302654',accent:'#7957df',card:'#f8f6ff'}),...project.profile?.palette};
  const spec=outputSpec(project.output),portrait=spec.format==='portrait';
  const duration=media.duration,visual=media.visualPath||media.recordingPath;
  const font=['Inter','DM Sans','Arial'].includes(project.profile?.font)?project.profile.font:'Inter';
  let picture='';if(visual){const src=escape(path.basename(visual));picture=media.visualKind==='image'?`<img class="background" src="${src}"/>`:`<video id="recording" class="background clip" data-start="0" data-duration="${duration}" data-track-index="1" src="${src}" muted loop playsinline></video>`;}
  const points=scene.points.map((point,index)=>`${scene.type==='diagram'&&index>0?`<div style="align-self:center;color:${theme.accent};font-size:34px">${portrait?'↓':'→'}</div>`:''}<div class="point"><span>${String(index+1).padStart(2,'0')}</span>${escape(point)}</div>`).join('');
  const groups=captionGroups(project.profile?.captions===true?media.words||[]:[]);const captions=groups.map((group,index)=>`<div class="caption clip" id="caption-${index}" data-start="${group.start}" data-duration="${Math.max(0.02,group.end-group.start)}" data-track-index="4">${escape(group.text)}</div>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>@font-face{font-family:Inter;src:url('inter.woff2')}@font-face{font-family:'DM Sans';src:url('dm-sans.woff2')}*{box-sizing:border-box}html,body{margin:0;width:${spec.width}px;height:${spec.height}px;overflow:hidden;background:${theme.background};font-family:'${font}',sans-serif;color:${theme.ink}}#root{position:relative;width:${spec.width}px;height:${spec.height}px;overflow:hidden}#stage{position:absolute;width:${spec.layoutWidth}px;height:${spec.layoutHeight}px;transform:scale(${spec.width/spec.layoutWidth});transform-origin:top left}.scene{position:absolute;inset:0;padding:${portrait?50:80}px;display:flex;flex-direction:column;justify-content:center}.eyebrow{font-size:18px;letter-spacing:4px;font-weight:700;color:${theme.accent};margin-bottom:24px}h1{font-size:${portrait?50:scene.type==='title'?76:58}px;line-height:1.12;letter-spacing:-2px;margin:0 0 42px;max-width:${spec.layoutWidth-100}px}.points{display:${['diagram','comparison','timeline'].includes(scene.type)?'flex':'block'};flex-direction:${portrait?'column':'row'};gap:18px}.point{flex:1;border-radius:22px;padding:22px;background:${theme.card};font-size:26px;line-height:1.35;margin-bottom:12px}.point span{display:block;font-size:17px;color:${theme.accent};margin-bottom:12px}.background{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#101218}.caption{position:absolute;bottom:${portrait?100:68}px;left:${portrait?45:120}px;right:${portrait?45:120}px;text-align:center;color:white;background:#151329df;padding:12px 22px;border-radius:12px;font-size:25px;line-height:1.5}.brand{position:absolute;bottom:35px;left:80px;font-size:14px;opacity:.6}.logo{position:absolute;right:60px;top:35px;max-width:130px;max-height:65px}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="${duration}" data-width="${spec.width}" data-height="${spec.height}"><div id="stage"><div class="scene clip" id="scene" data-start="0" data-duration="${duration}" data-track-index="0"><div class="eyebrow">${escape(scene.eyebrow)}</div><h1>${escape(scene.title)}</h1><div class="points">${points}</div><div class="brand">lumen studio</div></div>${picture}${media.logoPath?`<img class="logo" src="${escape(path.basename(media.logoPath))}"/>`:''}<audio id="voice" class="clip" data-start="0" data-duration="${media.speechDuration}" data-track-index="3" src="${escape(path.basename(media.audioPath))}"></audio>${captions}</div></div></body></html>`;
}
export async function renderHyperframesSegment(project,scene,media,folder,output,signal,onProgress){
  const workspace=path.join(folder,'hyperframes',path.basename(output,'.mp4'));await mkdir(workspace,{recursive:true});
  for(const file of [...new Set([media.audioPath,media.recordingPath,media.visualPath,media.logoPath,...(media.layerMedia||[]).map(layer=>layer.path)])].filter(Boolean))await copyFile(path.join(folder,file),path.join(workspace,path.basename(file)));
  await copyFile(path.join(root,'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'),path.join(workspace,'inter.woff2'));
  await copyFile(path.join(root,'node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2'),path.join(workspace,'dm-sans.woff2'));
  for(const [font,file] of [['inter','inter'],['dm-sans','dm-sans']])await copyFile(path.join(root,'node_modules/@fontsource/'+font+'/files/'+file+'-latin-700-normal.woff2'),path.join(workspace,font+'-bold.woff2'));
  await copyFile(path.join(root,'node_modules/gsap/dist/gsap.min.js'),path.join(workspace,'gsap.min.js'));
  const transition=scene.transition||project.profile?.transition||'fade';
  const intro=transition==='cut'?"timeline.set('#scene',{opacity:1},0);":transition==='slide'?"timeline.fromTo('#scene',{opacity:0.85,x:25},{opacity:1,x:0,duration:0.5},0);":"timeline.fromTo('#scene',{opacity:0.85},{opacity:1,duration:0.5},0);";
  const animation=advancedDesign(scene,project.profile)?designAnimation(scene,media,project):`const timeline=gsap.timeline({paused:true});${intro}timeline.to({}, {duration:${Math.max(0.01,media.duration-.5)}},.5);window.__timelines=window.__timelines||{};window.__timelines.main=timeline;timeline.seek(0);`;
  const html=compositionHtml(scene,media,project).replace('</head>','<script src="gsap.min.js"></script></head>').replace('</body>',`<script>${animation}</script></body>`);
  await writeFile(path.join(workspace,'index.html'),html);
  const chrome=path.join(root,'node_modules/.remotion/chrome-headless-shell/win64/chrome-headless-shell-win64/chrome-headless-shell.exe');
  const env={...process.env,HYPERFRAMES_FFMPEG_PATH:ffmpeg,HYPERFRAMES_FFPROBE_PATH:ffprobe.path,HYPERFRAMES_BROWSER_PATH:chrome,HYPERFRAMES_NO_UPDATE_CHECK:'1',HYPERFRAMES_TELEMETRY_DISABLED:'1',DO_NOT_TRACK:'1',PRODUCER_LOW_MEMORY_MODE:'1'};
  const cli=path.join(root,'node_modules/hyperframes/bin/hyperframes.mjs');
  const lint=await execute(process.execPath,[cli,'lint',workspace,'--json'],{signal,env,timeout:60000});await writeFile(path.join(workspace,'lint.json'),lint.stdout);if(lint.code!==0)throw new Error(`HyperFrames: composición inválida. ${lint.stderr.slice(-800)} ${lint.stdout.slice(-800)}`);
  const render=await execute(process.execPath,[cli,'render',workspace,'--output',output,'--fps',String(outputSpec(project.output).fps),'--workers','1','--quality','standard','--low-memory-mode','--json'],{signal,env,timeout:1800000,onLine:line=>{const match=/(\d+)%/.exec(line);if(match)onProgress?.(Number(match[1]));}});await writeFile(path.join(workspace,'render.log'),render.stdout+'\n'+render.stderr);if(render.code!==0)throw new Error(`HyperFrames no completó el render: ${render.stderr.slice(-1800)} ${render.stdout.slice(-1000)}`);
  return {workspace:path.relative(folder,workspace).replaceAll('\\','/'),renderer:'hyperframes'};
}
