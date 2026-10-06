import React from 'react';
import {AbsoluteFill,Img,OffthreadVideo,Sequence,Loop,useCurrentFrame,useVideoConfig} from 'remotion';
import {sceneDesign,themeFor,layerPose,layerCss,layerContent,cameraPose,backgroundCss,clamp} from './design.mjs';
function MediaLayer({layer,source,fps,profile}){
  if(!source?.url)return <div style={{width:'100%',height:'100%',background:'#192638',display:'grid',placeItems:'center',fontSize:22,opacity:.7}}>Recurso pendiente</div>;
  const style={width:'100%',height:'100%',objectFit:layer.media?.fit||'cover',background:'#101218'};
  if(source.kind==='image')return <Img src={source.url} style={style}/>;
  const raw=source.prepared===false,from=raw?(layer.media?.from||0):0,rate=raw?(layer.media?.rate||1):1;
  const length=raw&&layer.media?.to!=null?layer.media.to-from:source.duration;
  const volume=layer.media?.volume??source.volume??0,audible=volume>0||source.recordingAudio;
  const video=<OffthreadVideo src={source.url} muted={!audible} volume={volume>0?volume:profile?.recordingVolume??.25} style={style} trimBefore={Math.round(from*fps)} {...(raw&&layer.media?.to!=null?{durationInFrames:Math.max(1,Math.round(length*fps))}:{})} playbackRate={rate}/>;
  return <Sequence from={Math.round(layer.start*fps)} durationInFrames={Math.max(1,Math.round(layer.duration*fps))} layout="none">{length?<Loop layout="none" durationInFrames={Math.max(1,Math.floor(length*fps/rate))}>{video}</Loop>:video}</Sequence>;
}
export function LayeredScene({scene,style='editorial',profile={},media={},duration=media.duration||scene.duration}){
  const frame=useCurrentFrame(),{fps,width,height}=useVideoConfig(),time=frame/fps;
  const design=sceneDesign(scene,{...profile,format:height>width?'portrait':profile.format},duration),theme=themeFor(style,profile),camera=cameraPose(design.camera,time,duration);
  return <AbsoluteFill style={{background:backgroundCss(design,theme),backgroundSize:design.background==='grid'?'32px 32px,32px 32px,100% 100%,100% 100%':undefined,color:theme.ink,overflow:'hidden'}}>
    <AbsoluteFill style={{transform:`translate(${camera.x}%,${camera.y}%) scale(${camera.scale})`}}>
      {design.layers.map(layer=>{const pose=layerPose(layer,time,duration),source=media.layerMedia?.find(item=>item.layerId===layer.id)||(layer.id==='primary'?media.recordingUrl?{url:media.recordingUrl,kind:'video',duration:media.recordingDuration,recordingAudio:media.recordingAudio}:{url:media.visualUrl,kind:media.visualKind,duration:media.visualDuration}:null);
        const reveal=layer.type==='chart'||layer.type==='counter'?clamp((time-layer.start)/1):pose.reveal;
        return <div key={layer.id} data-layer-id={layer.id} style={{...layerCss(layer,theme),opacity:pose.opacity,transform:`translate(${pose.x}%,${pose.y}%) scale(${pose.scale}) rotate(${pose.rotation}deg)`,clipPath:layer.motion==='wipe'?`inset(0 ${100*(1-pose.reveal)}% 0 0)`:undefined}}>{layer.type==='media'?<MediaLayer layer={layer} source={source} fps={fps} profile={profile}/>:<div style={{display:'flex',alignItems:'center',width:'100%',height:'100%'}} dangerouslySetInnerHTML={{__html:layerContent(layer,theme,reveal)}}/>}</div>;
      })}
    </AbsoluteFill>
  </AbsoluteFill>;
}
