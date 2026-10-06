import path from 'node:path';
import {outputSpec} from '../src/video/output.mjs';
import {sceneDesign,themeFor,layerCss,layerContent,motionFrames,cameraPose,backgroundCss,cssText,escapeHtml} from '../src/video/design.mjs';
import {captionGroups} from './captions.mjs';
export function designAnimation(scene,media,project){
  const design=sceneDesign(scene,{...project.profile,format:outputSpec(project.output).format},media.duration),duration=media.duration;
  const pose=frame=>({xPercent:frame.x,yPercent:frame.y,scale:frame.scale,rotation:frame.rotation,opacity:frame.opacity});
  let script="const timeline=gsap.timeline({paused:true});";
  design.layers.forEach((layer,index)=>{
    const selector='#layer-'+index,frames=motionFrames(layer,duration),opacity=layer.style.opacity??1;
    const values=frame=>({...pose(frame),opacity:frame.opacity*opacity});
    script+="timeline.set("+JSON.stringify(selector)+",{opacity:0},0);timeline.set("+JSON.stringify(selector)+","+JSON.stringify(values(frames[0]))+","+layer.start+");";
    for(let i=1;i<frames.length;i++)script+="timeline.to("+JSON.stringify(selector)+","+JSON.stringify({...values(frames[i]),duration:frames[i].time-frames[i-1].time,ease:'power2.out'})+","+frames[i-1].time+");";
    script+="timeline.set("+JSON.stringify(selector)+",{opacity:0},"+(layer.start+layer.duration)+");";
    if(layer.motion==='wipe')script+="timeline.fromTo("+JSON.stringify(selector)+",{clipPath:'inset(0 100% 0 0)'},{clipPath:'inset(0 0% 0 0)',duration:.65,ease:'none'},"+layer.start+");";
    if(layer.type==='line'||layer.type==='chart'&&layer.chart.type==='line')script+="timeline.fromTo("+JSON.stringify(selector+(layer.type==='line'?' path':' .chart-path'))+",{strokeDashoffset:1000},{strokeDashoffset:0,duration:"+(layer.type==='line'?.65:1)+",ease:'none'},"+layer.start+");";
    if(layer.type==='chart'&&layer.chart.type==='bars')script+="timeline.fromTo("+JSON.stringify(selector+' .chart-bar')+",{scaleY:0},{scaleY:1,duration:1,ease:'none'},"+layer.start+");";
    if(layer.type==='chart'&&layer.chart.type==='donut')script+="timeline.fromTo("+JSON.stringify(selector+' circle')+",{opacity:0},{opacity:1,duration:1,ease:'none'},"+layer.start+");";
    if(layer.type==='counter')for(let i=0;i<=30;i++)script+="timeline.set("+JSON.stringify(selector+' .counter-number')+","+JSON.stringify({textContent:Math.round(layer.chart.values[0]*i/30).toLocaleString('es')+(layer.chart.unit||'')})+","+(layer.start+i/30)+");";
  });
  const from=cameraPose(design.camera,0,duration),to=cameraPose(design.camera,duration,duration);
  script+="timeline.fromTo('#camera',"+JSON.stringify({xPercent:from.x,yPercent:from.y,scale:from.scale})+","+JSON.stringify({xPercent:to.x,yPercent:to.y,scale:to.scale,duration,ease:'none'})+",0);timeline.to({}, {duration:"+duration+"},0);window.__timelines=window.__timelines||{};window.__timelines.main=timeline;timeline.seek(0);";
  return script.replaceAll('<','\\u003c');
}
export function layeredHtml(scene,media,project){
  const spec=outputSpec(project.output),design=sceneDesign(scene,{...project.profile,format:spec.format},media.duration),theme=themeFor(project.style,project.profile),esc=escapeHtml;
  const layers=design.layers.map((layer,index)=>{
    let content=layerContent(layer,theme);
    if(layer.type==='media'){
      const source=media.layerMedia?.find(item=>item.layerId===layer.id)||(layer.id==='primary'?{path:media.recordingPath||media.visualPath,kind:media.recordingPath?'video':media.visualKind}:null);
      content=source?.path?(source.kind==='image'?'<img src="'+esc(path.basename(source.path))+'" style="width:100%;height:100%;object-fit:'+(layer.media?.fit||'cover')+'"/>':'<video id="video-'+index+'" class="clip" data-start="'+layer.start+'" data-duration="'+layer.duration+'" data-track-index="'+(index+1)+'" src="'+esc(path.basename(source.path))+'" '+((layer.media?.volume??source.volume??0)>0?'data-has-audio="true" data-volume="'+(layer.media?.volume??source.volume)+'"':'muted')+' loop playsinline style="width:100%;height:100%;object-fit:'+(layer.media?.fit||'cover')+'"></video>'):'';
    }
    return '<div id="layer-'+index+'" data-layer-id="'+layer.id+'" style="'+esc(cssText(layerCss(layer,theme)))+'">'+content+'</div>';
  }).join('');
  const captions=captionGroups(project.profile?.captions===true?media.words||[]:[]).map((group,index)=>'<div class="caption clip" id="caption-'+index+'" data-start="'+group.start+'" data-duration="'+Math.max(.02,group.end-group.start)+'" data-track-index="30">'+esc(group.text)+'</div>').join('');
  return '<!doctype html><html lang="es"><head><meta charset="utf-8"><style>@font-face{font-family:Inter;src:url(\'inter.woff2\')}@font-face{font-family:Inter;src:url(\'inter-bold.woff2\');font-weight:600 900}@font-face{font-family:"DM Sans";src:url(\'dm-sans.woff2\')}@font-face{font-family:"DM Sans";src:url(\'dm-sans-bold.woff2\');font-weight:600 900}*{box-sizing:border-box}html,body{margin:0;width:'+spec.width+'px;height:'+spec.height+'px;overflow:hidden;font-family:"'+esc(project.profile?.font||'Inter')+'",Arial,sans-serif}#root{position:relative;width:100%;height:100%;overflow:hidden}#stage{position:absolute;width:'+spec.layoutWidth+'px;height:'+spec.layoutHeight+'px;transform:scale('+spec.width/spec.layoutWidth+');transform-origin:top left;background:'+backgroundCss(design,theme)+';'+(design.background==='grid'?'background-size:32px 32px,32px 32px,100% 100%,100% 100%;':'')+'}#camera{position:absolute;inset:0}.caption{position:absolute;bottom:'+(spec.format==='portrait'?100:68)+'px;left:'+(spec.format==='portrait'?45:120)+'px;right:'+(spec.format==='portrait'?45:120)+'px;text-align:center;color:white;background:#151329df;padding:12px 22px;border-radius:12px;font-size:25px;line-height:1.5}.logo{position:absolute;right:60px;top:35px;max-width:130px;max-height:65px}</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="'+media.duration+'" data-width="'+spec.width+'" data-height="'+spec.height+'"><div id="stage"><div id="camera">'+layers+'</div>'+(media.logoPath?'<img class="logo" src="'+esc(path.basename(media.logoPath))+'"/>':'')+(media.audioPath?'<audio id="voice" class="clip" data-start="0" data-duration="'+media.speechDuration+'" data-track-index="29" src="'+esc(path.basename(media.audioPath))+'"></audio>':'')+captions+'</div></div></body></html>';
}
