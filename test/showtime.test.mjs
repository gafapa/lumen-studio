// Ideas adoptadas de Showtime: sellos de revisión, inspección temporal, historial de looks, contrato del
// storyboard, recibo y referencia de estilo con guardián anti-copia.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import {execute} from '../server/process.mjs';
import {Store} from '../server/store.mjs';
import {stampImages,checkSeenCodes,cutsSheet} from '../server/review-pack.mjs';
import {prepareWorkspace} from '../server/scene-code.mjs';
import {inspectScene} from '../server/inspect.mjs';
import {lookOf,recordLook,lookRepeat} from '../server/looks.mjs';
import {validate} from '../server/schemas.mjs';
import {receipt} from '../server/receipt.mjs';
import {analyzeReference,nearCopy,referenceBrief} from '../server/style-reference.mjs';

async function temporary(t){const directory=await mkdtemp(path.join(os.tmpdir(),'lumen-showtime-'));t.after(()=>rm(directory,{recursive:true,force:true}));return directory;}
const run=async args=>{const result=await execute(ffmpeg,['-y','-v','error',...args],{timeout:120000});assert.equal(result.code,0,result.stderr);};

test('las imágenes de revisión llevan un código que el revisor debe devolver y nunca va en el nombre',async t=>{
  const dir=await temporary(t),images=[];for(const index of [0,1,2]){const file=path.join(dir,`f${index}.png`);await sharp({create:{width:640,height:360,channels:3,background:{r:20,g:30,b:40}}}).png().toFile(file);images.push({path:file,time:index});}
  const stamped=await stampImages(images,path.join(dir,'out'));assert.equal(stamped.length,3);
  for(const item of stamped){assert.match(item.code,/^\d{5}$/);assert.ok(!item.path.includes(item.code));const before=await sharp(item.original).raw().toBuffer(),after=await sharp(item.path).raw().toBuffer();assert.notDeepEqual(before,after);}
  assert.equal(checkSeenCodes(stamped,stamped.map(item=>item.code)).ok,true);
  assert.equal(checkSeenCodes(stamped,[stamped[0].code]).ok,false);
  assert.equal(checkSeenCodes(stamped,[...stamped.map(item=>item.code),'12345']).ok,false,'un código inventado invalida la revisión');
  const video=path.join(dir,'v.mp4');await run(['-f','lavfi','-i','testsrc2=s=320x180:r=25:d=4','-pix_fmt','yuv420p',video]);
  const sheet=await cutsSheet(video,[1,2.5],25,path.join(dir,'cuts.jpg'));const meta=await sharp(sheet).metadata();assert.ok(meta.width>320*6&&meta.height>180);
});

test('la inspección temporal detecta textos que no dan tiempo a leer, letra diminuta y poco contraste',{timeout:180000},async t=>{
  const folder=await temporary(t);await mkdir(path.join(folder,'media'));await run(['-f','lavfi','-i','sine=f=440:d=4',path.join(folder,'media','voz.wav')]);
  const project={id:'p',prompt:'x',style:'technology',output:{format:'landscape',resolution:'720p',fps:30},profile:{font:'Inter'},assets:[],recordings:[],storyboard:{title:'T',scenes:[]}};
  const scene={id:'uno',engine:'hyperframes',title:'Prueba',narration:'x',points:[],type:'title',duration:4};project.storyboard.scenes.push(scene);
  const {dir,brief}=await prepareWorkspace(project,scene,{duration:4,speechDuration:3,audioPath:'media/voz.wav',words:[]},folder);
  await writeFile(path.join(dir,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}#root{position:relative;width:1280px;height:720px;background:#111;font-family:Inter,sans-serif}.t{position:absolute;margin:0;color:#fff}</style><script src="gsap.min.js"></script></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1280" data-height="720"><h1 class="t" style="left:80px;top:80px;font-size:72px">Título bien</h1><p class="t" style="left:80px;top:220px;font-size:13px">letra diminuta de prueba</p><p class="t" style="left:80px;top:320px;font-size:40px;color:#1d1d1d">Casi invisible</p><p class="t" id="fugaz" style="left:80px;top:460px;font-size:36px">Una frase bastante larga que aparece solo medio segundo</p></div><script>window.__timelines={};const tl=gsap.timeline({paused:true});tl.set('#fugaz',{opacity:0},0);tl.to('#fugaz',{opacity:1,duration:0.05},1);tl.to('#fugaz',{opacity:0,duration:0.05},1.5);tl.to({},{duration:4},0);window.__timelines.main=tl;</script></body></html>`);
  const result=await inspectScene(dir,brief),rules=result.warnings.map(item=>item.rule);
  for(const rule of ['short_text','tiny_text','low_contrast'])assert.ok(rules.includes(rule),rule+': '+JSON.stringify(result.warnings));
  assert.ok(!result.warnings.some(item=>item.message.includes('Título bien')),'el título correcto no genera avisos');
  assert.ok(result.crops.length>0&&result.warnings.every(item=>item.time==null||Number.isFinite(item.time)));
});

test('el historial de looks avisa cuando un storyboard repite apertura, transición y estructura',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'lumen-showtime-')),store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const scenes=(components,transition)=>components.map((component,index)=>({id:'s'+index,title:'E'+index,duration:[3,5,8][index%3],transition,component}));
  for(const index of [1,2,3])await recordLook(store,{id:'v'+index,title:'Vídeo '+index,collectionId:'c',profile:{},storyboard:{scenes:scenes(['Intro','Diagrama','Cierre'],'wipe')}});
  const look=lookOf({id:'x',storyboard:{scenes:scenes(['Intro','Diagrama','Cierre'],'wipe')}});assert.equal(look.opening,'Intro');assert.equal(look.primaryTransition,'wipe');
  const repeated=await lookRepeat(store,{id:'nuevo',collectionId:'c',profile:{},storyboard:{scenes:scenes(['Intro','Diagrama','Cierre'],'wipe')}},{kitComponents:['Intro','Diagrama','Cierre','CifraDestacada']});
  const what=repeated.warnings.map(item=>item.what);for(const item of ['apertura','transición principal','estructura','secuencia de componentes'])assert.ok(what.includes(item),item);
  assert.ok(repeated.warnings.find(item=>item.what==='apertura').alternatives.some(text=>text.includes('CifraDestacada')));
  const fresh=await lookRepeat(store,{id:'otro',collectionId:'c',profile:{},storyboard:{scenes:[...scenes(['CifraDestacada','Intro'],'cut'),{id:'z',title:'Z',duration:12,transition:'cut',component:'Cierre'}]}});
  assert.ok(!fresh.warnings.some(item=>item.what==='apertura'||item.what==='transición principal'));
});

test('el storyboard exige un enfoque inesperado y se revisa con dos «no» en la comprobación de personalidad',()=>{
  const base={title:'T',scenes:[{id:'uno',title:'Uno',duration:4,narration:'Hola.',type:'title',eyebrow:'',points:[],sourceIds:[],engine:'hyperframes',direction:'x',voiceover:null}]};
  const concept=unexpected=>({title:'A',idea:'Idea',sees:'Se ve',hook:'Gancho',unexpected});
  assert.doesNotThrow(()=>validate('storyboard',{...base,contract:{audience:'alumnos',claim:'DHCP falla por el rango'},concepts:[concept(false),concept(true)],chosenConcept:1,rejectedTypical:'Tutorial paso a paso',distinctness:[{question:'¿Sorpresa?',answer:true},{question:'¿Ritmo variado?',answer:false}]}));
  assert.throws(()=>validate('storyboard',{...base,concepts:[concept(false),concept(false),concept(false)]}),/inesperado/);
  assert.throws(()=>validate('storyboard',{...base,distinctness:[{question:'a',answer:false},{question:'b',answer:false},{question:'c',answer:true}]}),/dos o más/);
  assert.doesNotThrow(()=>validate('storyboard',base),'los campos nuevos son opcionales');
});

test('el recibo suma el trabajo por rol, cuenta las rondas de crítica y solo calcula coste con precios',()=>{
  const project={id:'v',title:'Vídeo',prompt:'Explica DHCP',status:'completed',runtime:'claude',storyboard:{scenes:[{id:'a',title:'A'}]},metrics:{byRole:{'scene-code':{calls:2,inputTokens:2000000,cachedTokens:1000000,outputTokens:100000,durationMs:1000,model:'sonnet'},'scene-critic':{calls:3,inputTokens:30000,cachedTokens:0,outputTokens:3000,durationMs:500,model:'haiku'}}},tasks:[{kind:'scene-code',sceneId:'a',output:{rounds:2,critique:{score:20,wouldPost:true,verified:false,history:[{},{}]}}}]};
  const plain=receipt(project);assert.equal(plain.total.calls,5);assert.equal(plain.cost,null);assert.equal(plain.critic.rounds,2);assert.equal(plain.critic.unverified,1);assert.equal(plain.request,'Explica DHCP');
  const priced=receipt(project,{prices:{sonnet:{input:3,output:15,cached:0.3}}});assert.equal(priced.cost.complete,false);assert.ok(Math.abs(priced.cost.amount-(1*3+1*0.3+0.1*15))<1e-9);
});

test('la referencia de estilo mide ritmo, planos y paleta, y el guardián distingue una copia de un vídeo con el mismo estilo',{timeout:300000},async t=>{
  const dir=await temporary(t),ref=path.join(dir,'ref.mp4'),copy=path.join(dir,'copy.mp4'),same=path.join(dir,'same.mp4');
  const card=(width,color,ground,x=60,y=120)=>`color=c=${ground}:s=640x360:r=25,drawbox=x=${x}:y=${y}:w=420:h=60:color=${color}:t=fill,drawbox=x=${x}:y=${y+110}:w=${width}:h=8:color=${color}:t=fill`;
  const film=(out,parts)=>run([...parts.flatMap(part=>['-t','3','-f','lavfi','-i',part]),'-filter_complex',parts.map((_,i)=>`[${i}:v]`).join('')+`concat=n=${parts.length}:v=1[v]`,'-map','[v]','-c:v','libx264','-pix_fmt','yuv420p',out]);
  await film(ref,[card(300,'white','navy'),card(200,'black','orange'),'testsrc2=s=640x360:r=25']);await run(['-i',ref,'-vf','eq=brightness=0.03','-c:v','libx264','-crf','30','-pix_fmt','yuv420p',copy]);
  await film(same,[card(150,'white','navy',170,40),card(380,'black','orange',40,200),'smptehdbars=s=640x360:r=25']);
  const {spec,files}=await analyzeReference(ref,path.join(dir,'analysis'),{withType:false});
  assert.equal(spec.shots.count,3);assert.ok(Math.abs(spec.shots.median-3)<0.3);assert.ok(spec.palette.ground.startsWith('#'));assert.ok(files.shots&&files.sheet);
  assert.match(referenceBrief('Ref',spec),/Nunca su contenido/);
  assert.equal((await nearCopy(copy,path.join(dir,'analysis'),spec,spec.cuts,path.join(dir,'c1'),ref)).result,'fail');
  assert.equal((await nearCopy(same,path.join(dir,'analysis'),spec,spec.cuts,path.join(dir,'c2'),ref)).result,'pass');
});

test('el montaje mide la voz frente a la música bajo la voz',{timeout:180000},async t=>{
  const {assemble}=await import('../server/production.mjs');const dir=await temporary(t);await mkdir(path.join(dir,'media'));
  for(const name of ['a','b'])await run(['-f','lavfi','-i','testsrc2=s=320x180:r=30:d=3','-f','lavfi','-i','sine=f=300:d=3:sample_rate=48000','-shortest','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,'media',name+'.mp4')]);
  await run(['-f','lavfi','-i','anoisesrc=d=8:c=pink:a=0.5',path.join(dir,'media','musica.wav')]);
  const project={output:{format:'landscape',resolution:'720p',fps:30},profile:{musicAssetId:'m',musicVolume:0.12},assets:[{id:'m',kind:'music',path:'media/musica.wav'}],storyboard:{scenes:[{id:'a'},{id:'b',transition:'cut'}]}};
  const {mix}=await assemble(project,dir,['a','b'].map(name=>({sceneId:name,path:`media/${name}.mp4`,duration:3})),path.join(dir,'final.mp4'),AbortSignal.timeout(120000));
  assert.ok(mix&&Number.isFinite(mix.voiceToMusicDb),JSON.stringify(mix));assert.ok(mix.windows>5);assert.ok(mix.voiceDb>mix.musicUnderVoiceDb);
  const quiet={...project,profile:{...project.profile,musicVolume:0.002}},second=await assemble(quiet,dir,['a','b'].map(name=>({sceneId:name,path:`media/${name}.mp4`,duration:3})),path.join(dir,'final2.mp4'),AbortSignal.timeout(120000));
  assert.ok(second.mix.voiceToMusicDb>mix.voiceToMusicDb+20,'bajar la música amplía el margen');
});

test('el presupuesto se calcula con tokens y coste y se amplía un 50 %',async()=>{
  const {budgetState}=await import('../server/receipt.mjs');
  const project={options:{budgetTokens:1000,budgetCost:null},metrics:{byRole:{'scene-code':{calls:1,inputTokens:900,outputTokens:200,cachedTokens:0,durationMs:1,model:'sonnet'}}},tasks:[]};
  assert.equal(budgetState(project).exceeded,true);assert.equal(budgetState({...project,budgetExtra:0.5}).exceeded,false);
  assert.equal(budgetState({...project,options:{}}).limited,false);
  assert.equal(budgetState({...project,options:{budgetCost:1}},{sonnet:{input:1000,output:1000}}).exceeded,true);
});

test('el plan verifica los datos antes de producir, corrige el storyboard, repite la revisión sin prueba de mirada, publica y se detiene en el límite de gasto',{timeout:300000},async t=>{
  const {Harness}=await import('../server/harness.mjs'),dir=await mkdtemp(path.join(os.tmpdir(),'lumen-quality-')),store=new Store(dir);t.after(async()=>{store.close();await rm(dir,{recursive:true,force:true});});
  const board=port=>({title:'DHCP',scenes:[{id:'uno',title:'Uno',duration:4,narration:`DHCP usa el puerto ${port}.`,type:'title',eyebrow:'',points:[],sourceIds:[],engine:'json',direction:'',voiceover:null}]});
  let boards=0,checks=0,reviews=0;const reviewSeen=[];
  const runtimeInvoke=async({kind,task,context})=>{const metrics={kind,durationMs:1,inputTokens:10,outputTokens:10};
    if(kind==='plan')return {output:{reasoning:'Uno',tasks:[{id:'board',kind:'storyboard',role:'storyboard',label:'Storyboard',dependencies:[],instruction:'Diseña.'}]},metrics};
    if(kind==='storyboard'){boards++;if(boards>1)assert.match(task.feedback.issues[0].message,/incorrecto/);return {output:board(boards>1?'67':'80'),metrics};}
    if(kind==='fact-check'){checks++;assert.ok(context.storyboard.scenes.length);const wrong=context.storyboard.scenes[0].narration.includes('80');return {output:{summary:wrong?'Un dato mal':'Todo bien',claims:[{sceneId:'uno',claim:'DHCP usa el puerto '+(wrong?'80':'67'),status:wrong?'wrong':'verified',evidence:'RFC 2131',source:'rfc2131',fix:wrong?'67':null}],licenses:[]},metrics};}
    if(kind==='final-review'){reviews++;reviewSeen.push(task.instruction);return {output:{approved:true,summary:'Bien',issues:[],seenCodes:reviews===1?[]:['12345'],wouldPost:true,poster:1},metrics};}
    if(kind==='publish'){assert.ok(context.render.segments.length);return {output:{title:'DHCP en 4 segundos',description:'Qué puerto usa DHCP.',chapters:[{time:0,title:'Inicio'}],tags:['dhcp','redes'],posterTime:null,shareText:'DHCP explicado'},metrics};}
    throw new Error('Inesperado: '+kind);};
  const harness=new Harness(store,{owner:null,tokens:new Map()},{runtimeInvoke,sceneProducer:async(project,id)=>({sceneId:id,audioPath:`media/${id}.wav`,duration:4,speechDuration:3,words:[]}),renderer:async()=>({path:'media/v.mp4',duration:4,segments:[{sceneId:'uno',start:0,duration:4}]}),mediaReviewer:async(project,folder)=>{await mkdir(path.join(folder,'review'),{recursive:true});await writeFile(path.join(folder,'review','.codes.json'),JSON.stringify(['12345']));return {approved:true,summary:'ok',issues:[],frames:[]};}});
  harness.run=async function(id){const controller=new AbortController();const operation=this.execute(id,controller.signal);this.active.set(id,{controller,operation});try{await operation;}finally{this.active.delete(id);}return store.get(id);};
  const project=await harness.create({prompt:'Un vídeo sobre el puerto de DHCP.',duration:15,runtime:'codex',authoring:'json',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:false,sources:[],options:{autonomousProduction:false,finalReview:true,audioReview:false,factCheck:true,publish:true}});
  await harness.run(project.id);
  let current=store.get(project.id);
  assert.equal(boards,2,'el storyboard se corrige una vez');assert.equal(checks,2);assert.equal(current.factCheck.claims[0].status,'verified');assert.match(current.storyboard.scenes[0].narration,/67/);
  assert.ok(current.tasks.find(item=>item.id==='media-uno').dependencies.includes('fact-check'));
  assert.equal(reviews,2,'la revisión sin códigos se repite');assert.match(reviewSeen[1],/códigos/);
  assert.equal(current.publication.title,'DHCP en 4 segundos');assert.equal(current.status,'completed');
  // Límite de gasto: con el consumo ya hecho, pedir otra revisión se detiene y pide permiso.
  current.options={...current.options,budgetTokens:10};current.tasks.find(item=>item.id==='publish').status='pending';store.save(current);
  await harness.run(project.id);current=store.get(project.id);assert.equal(current.status,'needs-approval');assert.equal(current.awaiting,'budget');
  current.options={...current.options,budgetTokens:1000000};store.save(current);await harness.continueBudget(project.id);current=store.get(project.id);assert.equal(current.status,'completed');assert.equal(current.budgetExtra,0.5);
});

test('el texto que se teclea cuenta como un solo texto y no genera avisos por cada letra',{timeout:180000},async t=>{
  const folder=await temporary(t);await mkdir(path.join(folder,'media'));await run(['-f','lavfi','-i','sine=f=440:d=4',path.join(folder,'media','voz.wav')]);
  const project={id:'p',prompt:'x',style:'technology',output:{format:'landscape',resolution:'720p',fps:30},profile:{font:'Inter'},assets:[],recordings:[],storyboard:{title:'T',scenes:[]}};
  const scene={id:'uno',engine:'hyperframes',title:'Prueba',narration:'x',points:[],type:'title',duration:4};project.storyboard.scenes.push(scene);
  const {dir,brief}=await prepareWorkspace(project,scene,{duration:4,speechDuration:3,audioPath:'media/voz.wav',words:[]},folder);
  await writeFile(path.join(dir,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}#root{position:relative;width:1280px;height:720px;background:#111;font-family:Consolas,monospace}#cmd{position:absolute;left:80px;top:300px;margin:0;color:#fff;font-size:40px}</style><script src="gsap.min.js"></script></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="4" data-width="1280" data-height="720"><p id="cmd">$</p></div><script>window.__timelines={};const full='$ ip addr show',tl=gsap.timeline({paused:true}),state={n:1};tl.to(state,{n:full.length,duration:1.4,ease:'none',onUpdate:()=>{document.getElementById('cmd').textContent=full.slice(0,Math.round(state.n));}},0.2);tl.to({},{duration:4},0);window.__timelines.main=tl;</script></body></html>`);
  const result=await inspectScene(dir,brief);
  assert.ok(!result.warnings.some(item=>item.rule==='short_text'),JSON.stringify(result.warnings));assert.equal(result.texts,1);
});
