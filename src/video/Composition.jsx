import React from 'react';
import {AbsoluteFill,Sequence,Loop,Audio,Img,OffthreadVideo,useCurrentFrame,useVideoConfig,interpolate,Composition} from 'remotion';
import {LayeredScene} from './LayeredScene.jsx';
import {advancedDesign} from './design.mjs';
import {outputSpec} from './output.mjs';
const palettes={editorial:{background:'#eae5ff',ink:'#302654',accent:'#7957df',card:'#f8f6ff'},technology:{background:'#111b31',ink:'#f5f8ff',accent:'#65dacf',card:'#1d2b45'},whiteboard:{background:'#f7f3e9',ink:'#292f32',accent:'#dc8652',card:'#ffffff'}};
export function SceneVisual({scene,style='editorial',profile={},animated=false}) {
  const frame=useCurrentFrame();const portrait=useVideoConfig().height>useVideoConfig().width;const theme={...(palettes[style]||palettes[['documentary','news'].includes(style)?'technology':style==='presentation'?'whiteboard':'editorial']),...profile.palette};
  const progress=animated?interpolate(frame,[0,18],[0,1],{extrapolateRight:'clamp'}):1;
  const points=scene.points||[];
  return <AbsoluteFill style={{background:theme.background,color:theme.ink,fontFamily:`${profile.font||'Inter'}, Arial, sans-serif`,padding:portrait?50:80,justifyContent:'center',overflow:'hidden'}}>
    <div style={{position:'absolute',width:620,height:620,right:-220,top:-280,borderRadius:'50%',border:`90px solid ${theme.accent}15`}}/>
    <div style={{opacity:0.85+progress*0.15,transform:`translateY(${(1-progress)*24}px)`,position:'relative'}}>
      <div style={{fontSize:18,fontWeight:700,letterSpacing:4,textTransform:'uppercase',color:theme.accent,marginBottom:24}}>{scene.eyebrow||'LUMEN · APRENDE ALGO NUEVO'}</div>
      <h1 style={{fontFamily:'inherit',fontSize:portrait?50:scene.type==='title'?76:58,lineHeight:1.12,letterSpacing:-2,margin:'0 0 42px',maxWidth:1020}}>{scene.title}</h1>
      {scene.type==='code'?<pre style={{background:theme.card,padding:32,borderRadius:22,fontSize:25,lineHeight:1.6,whiteSpace:'pre-wrap',margin:0}}><code>{points.join('\n')}</code></pre>
      :scene.type==='quote'?<blockquote style={{fontSize:38,lineHeight:1.5,borderLeft:`6px solid ${theme.accent}`,paddingLeft:30,margin:0}}>{points.join(' ')}</blockquote>
      :scene.type==='timeline'?<div style={{display:'flex',gap:24,borderTop:`4px solid ${theme.accent}`,paddingTop:24}}>{points.map((point,index)=><div key={index} style={{flex:1,fontSize:25,lineHeight:1.4}}><strong style={{display:'block',color:theme.accent,marginBottom:12}}>{index+1}</strong>{point}</div>)}</div>
      :scene.type==='map'?<div style={{position:'relative',background:theme.card,borderRadius:22,padding:35,minHeight:220,display:'flex',justifyContent:'space-around',alignItems:'center',gap:24}}>{points.map((point,index)=><div key={index} style={{fontSize:25,textAlign:'center'}}><span style={{fontSize:50,color:theme.accent,display:'block'}}>⌖</span>{point}</div>)}<small style={{position:'absolute',bottom:12,fontSize:13,opacity:.5}}>Esquema de ubicaciones</small></div>
      :scene.type==='diagram'?<div style={{display:'flex',flexDirection:portrait?'column':'row',gap:14,alignItems:'stretch'}}>{points.map((point,index)=><React.Fragment key={index}><div style={{flex:1,background:theme.card,borderRadius:22,padding:24,minHeight:portrait?120:160,display:'flex',flexDirection:'column',justifyContent:'center',boxShadow:'0 8px 22px #00000005'}}><span style={{fontSize:17,color:theme.accent,fontWeight:800,marginBottom:18}}>{String(index+1).padStart(2,'0')}</span><span style={{fontSize:25,fontWeight:650,lineHeight:1.3}}>{point}</span></div>{index<points.length-1&&<div style={{alignSelf:'center',color:theme.accent,fontSize:32}}>{portrait?'↓':'→'}</div>}</React.Fragment>)}</div>
      :scene.type==='comparison'?<div style={{display:'grid',gridTemplateColumns:portrait?'1fr':'1fr 1fr',gap:24}}>{points.map((point,index)=><div key={index} style={{background:theme.card,padding:34,borderRadius:22,fontSize:28,lineHeight:1.4,borderTop:`5px solid ${theme.accent}`}}>{point}</div>)}</div>
      :<div style={{display:'flex',flexDirection:'column',gap:20}}>{points.map((point,index)=><div key={index} style={{fontSize:29,lineHeight:1.35,display:'flex',gap:18,alignItems:'center'}}><span style={{width:10,height:10,borderRadius:'50%',background:theme.accent,flexShrink:0}}/>{point}</div>)}</div>}
    </div>
    <div style={{position:'absolute',bottom:38,left:80,right:80,fontSize:14,opacity:0.55}}><span>lumen studio</span></div>
  </AbsoluteFill>;
}
function VideoScene({scene,style,profile,media,output}) {
  const frame=useCurrentFrame();const {fps,width}=useVideoConfig();const spec=outputSpec(output);
  const words=scene.narration.split(/\s+/);const groups=[];for(let index=0;index<words.length;index+=12)groups.push(words.slice(index,index+12).join(' '));
  const activeWord=media?.words?.findIndex(word=>frame/fps>=word.start&&frame/fps<word.end);
  const caption=media?.words?.length?(activeWord>=0?media.words.slice(Math.floor(activeWord/8)*8,Math.floor(activeWord/8)*8+8).map(word=>word.text).join(' '):''):groups[Math.min(groups.length-1,Math.floor(frame/(Math.max(1,(media?.speechDuration||scene.duration)*fps)/groups.length)))];
  const rich=advancedDesign(scene,profile);const videoUrl=media?.recordingUrl||(media?.visualKind==='video'?media.visualUrl:null);
  const recording=videoUrl?<OffthreadVideo src={videoUrl} muted={!media.recordingAudio} volume={profile?.recordingVolume??.25} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',background:'#101218'}}/>:null;
  const transition=scene.transition||profile?.transition||'fade',opacity=transition==='cut'?1:interpolate(frame,[0,12],[.85,1],{extrapolateRight:'clamp'});
  return <AbsoluteFill style={{width:spec.layoutWidth,height:spec.layoutHeight,transformOrigin:'top left',fontFamily:`${profile?.font||'Inter'},Arial,sans-serif`,opacity,transform:`scale(${width/spec.layoutWidth}) ${transition==='slide'?`translateX(${interpolate(frame,[0,15],[25,0],{extrapolateRight:'clamp'})}px)`:''}`}}>{rich?<LayeredScene scene={scene} style={style} profile={profile} media={media}/>:<SceneVisual scene={scene} style={style} profile={profile} animated/>}{!rich&&media?.visualKind==='image'&&media.visualUrl&&<Img src={media.visualUrl} style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'contain',background:'#101218',transform:`scale(${1+frame/Math.max(1,scene.duration*fps)*.04})`}}/>}{!rich&&recording&&((media.recordingDuration||media.visualDuration)?<Loop durationInFrames={Math.max(1,Math.floor((media.recordingDuration||media.visualDuration)*fps))}>{recording}</Loop>:recording)}{media?.logoUrl&&<Img src={media.logoUrl} style={{position:'absolute',top:35,right:60,maxWidth:130,maxHeight:65}}/>}{media?.audioUrl&&<Audio src={media.audioUrl}/>}<div style={{position:'absolute',bottom:spec.format==='portrait'?100:68,left:spec.format==='portrait'?45:120,right:spec.format==='portrait'?45:120,textAlign:'center'}}>{caption&&profile?.captions===true&&<span style={{background:'#151329df',color:'white',borderRadius:12,padding:'12px 22px',fontSize:25,lineHeight:1.6,boxDecorationBreak:'clone'}}>{caption}</span>}</div></AbsoluteFill>;
}
export function LumenVideo({storyboard,style='editorial',profile={},media={},output={}}) {
  const {fps}=useVideoConfig();let offset=0;
  return <AbsoluteFill>{storyboard.scenes.map(scene=>{const duration=Math.round((media[scene.id]?.duration||scene.duration)*fps);const from=offset;offset+=duration;return <Sequence key={scene.id} from={from} durationInFrames={duration}><VideoScene scene={scene} style={style} profile={profile} media={media[scene.id]} output={output}/></Sequence>;})}</AbsoluteFill>;
}
export const defaultStoryboard={title:'Tu próxima historia',scenes:[{id:'scene-01',title:'Una idea. Un vídeo.',narration:'Convierte tus ideas en historias que enseñan.',duration:10,type:'title',points:['Un estudio que trabaja contigo'],eyebrow:'BIENVENIDO A LUMEN'}]};
export function VideoRoot(){return <Composition id="LumenVideo" component={LumenVideo} width={1280} height={720} fps={30} durationInFrames={300} defaultProps={{storyboard:defaultStoryboard}} calculateMetadata={({props})=>{const {width,height,fps}=outputSpec(props.output);return {width,height,fps,durationInFrames:props.storyboard.scenes.reduce((sum,scene)=>sum+Math.round((props.media?.[scene.id]?.duration||scene.duration)*fps),0)};}}/>;}
