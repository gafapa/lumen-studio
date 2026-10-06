import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile,stat,readFile} from 'node:fs/promises';
import express from 'express';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import ffmpeg from 'ffmpeg-static';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {produceScene,renderProject,closeMedia} from '../server/media.mjs';
import {reviewMedia} from '../server/production.mjs';
import {execute} from '../server/process.mjs';
import {validate} from '../server/schemas.mjs';
const root=path.resolve('.data/verification/design-'+Date.now()),store=new Store(root),harness=new Harness(store,{}),signal=AbortSignal.timeout(900000),app=express();app.use('/api/projects/:id/files', (req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');next();},(req,res,next)=>express.static(harness.folder(req.params.id))(req,res,next));
const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const previous=process.env.LUMEN_SERVER_URL;process.env.LUMEN_SERVER_URL='http://127.0.0.1:'+server.address().port;
const results=[];
try{
  const project=await harness.create({prompt:'Verificación de composición multicapa, imágenes y fragmentos de vídeo.',duration:15,runtime:'demo',architecture:'single',context:'minimal',style:'technology',concurrency:1,desktop:false,sources:[],output:{format:'landscape',resolution:'720p',fps:24},profile:{visualIntensity:'cinematic'},options:{externalMedia:false}}),folder=harness.folder(project.id);await mkdir(path.join(folder,'media'),{recursive:true});
  const source=path.join(folder,'media/source.mp4'),generated=await execute(ffmpeg,['-y','-v','error','-f','lavfi','-i','color=c=red:s=640x360:r=24:d=2','-f','lavfi','-i','color=c=blue:s=640x360:r=24:d=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',source],{signal});assert.equal(generated.code,0);
  const canvas=createCanvas(640,360),ctx=canvas.getContext('2d');const gradient=ctx.createLinearGradient(0,0,640,360);gradient.addColorStop(0,'#282057');gradient.addColorStop(1,'#3aa6a4');ctx.fillStyle=gradient;ctx.fillRect(0,0,640,360);ctx.strokeStyle='#97f5e0';ctx.lineWidth=3;for(let i=0;i<8;i++){ctx.beginPath();ctx.arc(500,190,30+i*22,0,Math.PI*2);ctx.stroke();}ctx.fillStyle='white';ctx.font='bold 44px sans-serif';ctx.fillText('UNA RED',42,160);ctx.fillText('EN MOVIMIENTO',42,222);await writeFile(path.join(folder,'media/reference.png'),canvas.toBuffer('image/png'));
  project.assets=[{id:'resource-video',name:'Dos planos de prueba',path:'media/source.mp4',kind:'video'},{id:'resource-image',name:'Imagen de apoyo',path:'media/reference.png',kind:'image'}];project.resources=project.assets.map(asset=>({...asset,assetId:asset.id,status:'ready',metadata:asset.kind==='video'?{duration:4,width:640,height:360}:{width:640,height:360}}));
  const scene={id:'scene-01',title:'Una escena. Varias formas de explicar.',duration:6,narration:'El cliente solicita una dirección. El servidor responde y configura la red.',type:'diagram',eyebrow:'LUMEN / COMPOSICIÓN MULTICAPA',points:['Cliente','Servidor'],sourceIds:[],composition:{layout:'canvas',background:'grid',camera:'push',layers:[
    {id:'heading',type:'text',text:'Una escena. Varias formas de explicar.',box:{x:6,y:11,w:88,h:16},start:0,duration:null,motion:'rise',style:{fontSize:48}},
    {id:'eyebrow',type:'text',text:'LUMEN / DISEÑO CON CAPAS',box:{x:6,y:5,w:88,h:5},start:0,motion:'fade',style:{fontSize:15,color:'accent'}},
    {id:'rule',type:'shape',shape:'pill',box:{x:6,y:29,w:12,h:.5},start:.1,motion:'wipe',style:{fill:'accent'}},
    {id:'client',type:'card',icon:'computer',text:'Cliente',box:{x:6,y:35,w:28,h:14},start:.2,motion:'pop',style:{fontSize:28,radius:20,glow:true}},
    {id:'arrow',type:'line',box:{x:18,y:50,w:3,h:6},start:.5,motion:'draw',style:{color:'accent'}},
    {id:'server',type:'card',icon:'server',text:'Servidor DHCP',box:{x:6,y:58,w:28,h:14},start:.7,motion:'rise',style:{fontSize:26,radius:20}},
    {id:'image',type:'media',box:{x:43,y:34,w:51,h:42},start:0,duration:2.2,motion:'ken-burns',media:{assetId:'resource-image',from:0,to:null,rate:1,fit:'cover'},style:{radius:24}},
    {id:'clip-blue',type:'media',box:{x:43,y:34,w:51,h:44},start:2,duration:1.8,motion:'fade',media:{assetId:'resource-video',from:2.1,to:3.9,rate:1,fit:'cover'},style:{radius:24}},
    {id:'clip-red',type:'media',box:{x:43,y:34,w:51,h:44},start:3.6,duration:2,motion:'fade',media:{assetId:'resource-video',from:0,to:2,rate:1,fit:'cover'},style:{radius:24}},
    {id:'clip-label',type:'text',text:'Imagen → fragmento azul → fragmento rojo',box:{x:43,y:78,w:51,h:3},start:.3,motion:'rise',style:{fontSize:16,color:'accent'}},
  ]}};
  project.storyboard={title:'Mezcla de gráficos, imagen y cortes de recursos',scenes:[scene]};validate('storyboard',project.storyboard);
  const output=await produceScene(project,scene.id,folder,signal);assert.equal(output.layerMedia.length,3);assert.equal(output.layerMedia.find(layer=>layer.layerId==='clip-blue').sourceFrom,2.1);project.tasks=[{id:'media-scene-01',kind:'scene',sceneId:scene.id,status:'completed',output}];
  for(const renderer of ['remotion','hyperframes']){
    project.renderer=renderer;project.render=await renderProject(project,folder,signal,p=>console.log(renderer,p+'%'));const reviewed=await reviewMedia(project,folder,signal);assert.equal(reviewed.approved,true);
    const frames=[];for(const at of [1,2.9,4.7]){const name='review/'+renderer+'-'+at+'.png';const result=await execute(ffmpeg,['-y','-v','error','-ss',String(at),'-i',path.join(folder,project.render.path),'-frames:v','1',path.join(folder,name)],{signal});assert.equal(result.code,0);frames.push(name);if(at!==1){const canvas=createCanvas(1280,720),ctx=canvas.getContext('2d');ctx.drawImage(await loadImage(path.join(folder,name)),0,0);const rgb=ctx.getImageData(850,410,1,1).data;assert.ok(at===2.9?rgb[2]>220&&rgb[0]<30:rgb[0]>220&&rgb[2]<30,renderer+' reproduce el corte de color esperado.');}}
    const repeat=await renderProject(project,folder,signal);assert.equal(repeat.reusedSegments,1);assert.ok((await stat(path.join(folder,project.render.path))).size>10000);results.push({renderer,render:project.render,frames});await writeFile(path.join(folder,renderer+'-render.json'),JSON.stringify(project.render,null,2));console.log('PASS',renderer,project.render.path);
  }
  store.save(project);await harness.export(project.id);await writeFile(path.join(root,'report.json'),JSON.stringify({passed:true,projectId:project.id,folder,results},null,2));console.log('REPORT',path.join(root,'report.json'));
}finally{await closeMedia();if(previous===undefined)delete process.env.LUMEN_SERVER_URL;else process.env.LUMEN_SERVER_URL=previous;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();}
