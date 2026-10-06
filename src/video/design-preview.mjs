import {sceneDesign} from './design.mjs';
export function editableComposition(scene,profile={}){
  const design=sceneDesign(scene,profile);
  return {...design,layout:'canvas',layers:design.layers.map(layer=>({...layer,duration:scene.composition?.layers?.find(item=>item.id===layer.id)?.duration??null}))};
}
export function previewSceneMedia(project,scene,{audio=false}={}){
  const output=project.tasks?.find(task=>task.kind==='scene'&&task.sceneId===scene.id&&task.status==='completed')?.output||project.tasks?.find(task=>task.kind==='visual'&&task.sceneId===scene.id&&task.status==='completed')?.output||{};
  const file=value=>value?'/api/projects/'+project.id+'/files/'+value:null;
  const primaryAsset=project.assets?.find(asset=>asset.id===scene.visual?.assetId),primaryRecording=project.recordings?.find(item=>item.id===scene.visual?.recordingId&&item.status==='completed');
  const layers=sceneDesign(scene,{...project.profile,format:project.output?.format}).layers.filter(layer=>layer.type==='media').map(layer=>{
    const asset=project.assets?.find(item=>item.id===layer.media?.assetId),recording=project.recordings?.find(item=>item.id===layer.media?.recordingId&&item.status==='completed');
    const source=asset||recording||primaryAsset||primaryRecording||{path:output.visualPath||output.recordingPath,kind:output.visualKind||'video'};
    const resource=project.resources?.find(item=>item.assetId===source.id);
    return {layerId:layer.id,url:file(source.path),kind:recording||source===primaryRecording?'video':source.kind||'video',duration:resource?.metadata?.duration||source.durationSeconds||output.visualDuration||output.recordingDuration,prepared:false,recordingAudio:layer.id==='primary'&&audio&&(source.systemAudio===true||output.recordingAudio===true)};
  });
  return {duration:audio?output.duration||scene.duration:scene.duration,layerMedia:layers,visualKind:primaryAsset?.kind||output.visualKind,visualUrl:file(primaryAsset?.path||output.visualPath),recordingUrl:file(primaryRecording?.path||output.recordingPath),...(audio?{audioUrl:file(output.audioPath),speechDuration:output.speechDuration,words:output.words}:{})};
}
export function previewMedia(project){return Object.fromEntries((project.storyboard?.scenes||[]).map(scene=>[scene.id,previewSceneMedia(project,scene,{audio:true})]));}
export function compositionForClip(scene,profile={}){
  const composition=editableComposition(scene,profile);
  if(!scene.composition?.layers?.length&&!composition.layers.some(layer=>layer.type==='media')&&profile.format!=='portrait'){
    const nodes=composition.layers.filter(layer=>/^(point|node)-/.test(layer.id)),height=Math.min(13,44/Math.max(1,nodes.length)),gap=2;
    nodes.forEach((layer,index)=>{layer.box={x:6,y:34+index*height,w:31,h:height-gap};layer.style={...layer.style,fontSize:Math.min(25,Math.max(16,height*2))};});
    composition.layers.filter(layer=>layer.type==='line').forEach((layer,index)=>{layer.box={x:20,y:34+(index+1)*height-gap,w:1.5,h:gap};});
  }
  return composition;
}
