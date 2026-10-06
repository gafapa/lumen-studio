import Ajv from 'ajv';
import {compositionSchema,validateDesign} from '../src/video/design.mjs';
const text = {type:'string',minLength:1};
const list = (items,maxItems=100)=>({type:'array',items,maxItems});
const object = properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
// Transiciones entre escenas: nombres de xfade de FFmpeg (fade y slide se conservan por compatibilidad).
export const transitions=['cut','fade','slide','dissolve','fadeblack','fadewhite','wipeleft','wiperight','wipeup','wipedown','slideleft','slideright','slideup','slidedown','smoothleft','smoothright','circleopen','circleclose','radial','zoomin','pixelize','hblur','distance'];
export const sceneSchema = object({id:{type:'string',pattern:'^[a-z0-9-]+$'},title:{...text,maxLength:100},duration:{type:'number',minimum:2,maximum:120},narration:{...text,maxLength:4000},type:{enum:['title','diagram','comparison','bullets','quote','screencast']},eyebrow:{type:'string',maxLength:80},points:list({...text,maxLength:160},6),sourceIds:list(text,20)});
sceneSchema.properties.type.enum.push('image','video','stock','timeline','code','map');
Object.assign(sceneSchema.properties,{composition:compositionSchema,visual:{type:'object',properties:{prompt:{type:'string',maxLength:4000},assetId:{type:['string','null']},recordingId:{type:['string','null']},providerIds:list(text,8)},additionalProperties:false},transition:{enum:transitions}});
export const ANCHORS=['A','B','C','D','E','F'].flatMap(column=>[1,2,3,4,5,6].map(row=>column+row)).concat('full');
Object.assign(sceneSchema.properties,{shots:list(object({start:{type:'number',minimum:0,maximum:120},duration:{type:'number',minimum:0.3,maximum:60},job:{...text,maxLength:200},focal:{...text,maxLength:200},anchor:{enum:ANCHORS},scale:{enum:['xl','l','m','s']},mediaId:{type:['string','null']},cue:{type:['string','null'],maxLength:80}}),12)});
Object.assign(sceneSchema.properties,{component:{type:['string','null'],maxLength:80},newComponent:{type:['object','null'],properties:{name:{type:'string',minLength:2,maxLength:80},description:{type:'string',maxLength:1000}},required:['name','description'],additionalProperties:false}});
// Datos neutrales respecto al motor (cifras con su unidad y fuente) y conceptos que la escena presenta o da por sabidos.
Object.assign(sceneSchema.properties,{data:{type:['object','null'],properties:{title:{type:'string',maxLength:200},unit:{type:'string',maxLength:40},items:{type:'array',maxItems:40,items:{type:'object',properties:{label:{type:'string',maxLength:120},value:{type:'number'}},required:['label','value'],additionalProperties:false}},source:{type:['string','null'],maxLength:400}},required:['title','unit','items','source'],additionalProperties:false},introduces:{type:'array',maxItems:8,items:{type:'string',maxLength:80}},uses:{type:'array',maxItems:8,items:{type:'string',maxLength:80}}});
Object.assign(sceneSchema.properties,{engine:{enum:['json','hyperframes','remotion','manim','revideo']},direction:{type:'string',maxLength:3000},voiceover:{type:['object','null'],properties:{assetId:{type:'string'},from:{type:'number',minimum:0,maximum:7200},to:{type:['number','null'],minimum:0.1,maximum:7200}},additionalProperties:false}});
export const schemas = {
  plan:object({reasoning:text,tasks:{...list(object({id:{...text,pattern:'^[a-z0-9-]+$'},label:text,role:{enum:['investigador','guionista','storyboard','revisor','operador']},kind:{enum:['research','script','storyboard','review','screencast']},dependencies:list(text,20),instruction:text}),32),minItems:1}}),
  research:object({summary:text,sources:list(object({id:text,title:text,url:{type:'string'},claims:list(text,30)}),30)}),
  script:object({title:text,scenes:{...list(object({id:{...text,pattern:'^[a-z0-9-]+$'},title:text,narration:text,sourceIds:list(text,20)}),40),minItems:1}}),
  storyboard:object({title:text,scenes:{...list(sceneSchema,40),minItems:1}}),
  // Opcionales: contrato, enfoques propuestos y comprobación de personalidad del plan.
  review:object({approved:{type:'boolean'},summary:text,issues:list(object({severity:{enum:['error','warning']},sceneId:{type:['string','null']},message:text}),40)}),
  screencast:object({summary:text,recordingId:text}),
  'final-review':object({approved:{type:'boolean'},summary:text,issues:list(object({severity:{enum:['error','warning']},sceneId:{type:['string','null']},message:text}),40)}),
  'production-plan':object({reasoning:text,tasks:{...list(object({id:{...text,pattern:'^[a-z0-9-]+$'},kind:{enum:['voice','visual','captions','scene','render','technical-review','audio-review','final-review']},sceneId:{type:['string','null']},role:text,label:text,instruction:text,providerId:{type:['string','null']},dependencies:list(text,60)}),200),minItems:1}}),
};
schemas.research.properties.resources=list(object({kind:{enum:['image','video']},url:text,name:text,sourceUrl:{type:'string'},author:{type:'string'},license:{type:'string'},licenseUrl:{type:'string'}}),12);
schemas['scene-code']=object({summary:text,engine:{enum:['hyperframes','remotion','manim','revideo']},files:list(text,60),verified:object({lint:{type:'boolean'},check:{type:'boolean'},snapshotsReviewed:{type:'boolean'}}),mediaUsed:list(text,40),notes:list(text,20)});
// Agentes de proyecto.
const hex={type:'string',pattern:'^#[0-9a-fA-F]{6}$'};
schemas['creative-plan']=object({reasoning:text,objective:{type:'string',maxLength:4000},audience:{type:'string',maxLength:1000},styleGuide:{...text,maxLength:20000},rules:list(object({text:{...text,maxLength:500},locked:{type:'boolean'}}),30),captions:object({enabled:{type:'boolean'},style:{type:'string',maxLength:1000}}),palette:{type:['object','null'],properties:{background:hex,ink:hex,accent:hex,card:hex},required:['background','ink','accent','card'],additionalProperties:false},videos:list(object({title:{...text,maxLength:120},prompt:{...text,minLength:10,maxLength:8000},duration:{type:'integer',minimum:15,maximum:600},format:{enum:['landscape','portrait','square',null]}}),20)});
schemas['kit-design']=object({summary:text,engine:{enum:['hyperframes','remotion','manim','revideo']},components:list(object({name:{...text,maxLength:80},file:{...text,maxLength:200},description:{...text,maxLength:500},usage:{...text,maxLength:2000}}),30),verified:object({lint:{type:'boolean'},check:{type:'boolean'},snapshotsReviewed:{type:'boolean'}}),notes:list(text,20)});
schemas.librarian=object({summary:text,described:{type:'integer',minimum:0}});
schemas['assist-text']=object({suggestions:{...list({...text,maxLength:20000},3),minItems:1},note:{type:'string',maxLength:500}});
schemas['assist-rules']=object({suggestions:{...list(object({text:{...text,maxLength:500},locked:{type:'boolean'}}),10),minItems:1},note:{type:'string',maxLength:500}});
schemas['assist-palette']=object({suggestions:{...list(object({name:{...text,maxLength:60},background:hex,ink:hex,accent:hex,card:hex}),3),minItems:1},note:{type:'string',maxLength:500}});
const nullable=(schema)=>({...schema,type:[].concat(schema.type||[],'null')});
schemas['copilot-plan']=object({summary:text,changes:object({name:nullable({type:'string',maxLength:120}),objective:nullable({type:'string',maxLength:4000}),audience:nullable({type:'string',maxLength:1000}),styleGuide:nullable({type:'string',maxLength:20000}),captions:nullable({type:'boolean'}),captionStyle:nullable({type:'string',maxLength:1000}),font:{enum:['Inter','DM Sans','Arial',null]},voice:{enum:['kokoro','windows',null]},palette:{type:['object','null'],properties:{background:hex,ink:hex,accent:hex,card:hex},required:['background','ink','accent','card'],additionalProperties:false},visualIntensity:{enum:['standard','rich','cinematic',null]},transition:{enum:['cut','fade','dissolve','fadeblack','slideleft','wipeleft','circleopen','zoomin',null]},format:{enum:['landscape','portrait','square',null]},resolution:{enum:['720p','1080p',null]},fps:{enum:[24,30,60,null]},authoring:{enum:['code','json',null]},runtime:{enum:['claude','codex',null]},addRules:list(object({text:{...text,maxLength:500},locked:{type:'boolean'}}),10),removeRules:list(text,20)}),videos:list(object({title:{...text,maxLength:120},prompt:{...text,minLength:10,maxLength:8000},duration:{type:'integer',minimum:15,maximum:600},format:{enum:['landscape','portrait','square',null]}}),20),questions:list(text,5)});
const score={type:'integer',minimum:0,maximum:5};
schemas['scene-critique']=object({scores:object({hierarchy:score,readability:score,motionPurpose:score,rhythm:score,consistency:score,originality:score}),verdict:{enum:['accept','revise']},summary:text,issues:list(object({severity:{enum:['error','warning']},time:{type:['number','null']},message:{...text,maxLength:600}}),12),strengths:list(text,8),framesReviewed:{type:'integer',minimum:0}});
Object.assign(schemas['scene-critique'].properties,{seenCodes:list({type:'string',maxLength:12},60),wouldPost:{type:'boolean'},wouldPostReason:{type:'string',maxLength:400},poster:{type:['number','null']}});
schemas['scene-critique'].required.push('seenCodes','wouldPost','wouldPostReason','poster');
schemas['scene-pairwise']=object({preferred:{enum:['X','Y','tie']},reason:{...text,maxLength:600},wouldPost:object({X:{type:'boolean'},Y:{type:'boolean'}}),issues:list(object({video:{enum:['X','Y']},severity:{enum:['error','warning']},time:{type:['number','null']},message:{...text,maxLength:600}}),16),seenCodes:list({type:'string',maxLength:12},80)});
Object.assign(schemas['final-review'].properties,{seenCodes:list({type:'string',maxLength:12},80),wouldPost:{type:'boolean'},poster:{type:['number','null']}});
Object.assign(schemas.storyboard.properties,{contract:{type:['object','null'],properties:{audience:{type:'string',maxLength:300},claim:{type:'string',maxLength:400}},required:['audience','claim'],additionalProperties:false},concepts:{type:'array',maxItems:5,items:{type:'object',properties:{title:{type:'string',maxLength:120},idea:{type:'string',maxLength:500},sees:{type:'string',maxLength:500},hook:{type:'string',maxLength:300},unexpected:{type:'boolean'}},required:['title','idea','sees','hook','unexpected'],additionalProperties:false}},chosenConcept:{type:['integer','null'],minimum:0,maximum:4},rejectedTypical:{type:['string','null'],maxLength:400},distinctness:{type:'array',maxItems:12,items:{type:'object',properties:{question:{type:'string',maxLength:200},answer:{type:'boolean'}},required:['question','answer'],additionalProperties:false}}});
schemas['fact-check']=object({summary:text,claims:list(object({sceneId:{type:['string','null']},claim:{...text,maxLength:400},status:{enum:['verified','unverified','wrong']},evidence:{type:'string',maxLength:600},source:{type:['string','null'],maxLength:500},fix:{type:['string','null'],maxLength:400}}),60),licenses:list(object({name:{...text,maxLength:200},status:{enum:['ok','unknown','problem']},note:{type:'string',maxLength:400}}),40)});
schemas.publish=object({title:{...text,maxLength:100},description:{...text,maxLength:5000},chapters:list(object({time:{type:'number',minimum:0},title:{...text,maxLength:100}}),30),tags:list({type:'string',maxLength:40},20),posterTime:{type:['number','null'],minimum:0},shareText:{type:'string',maxLength:500}});
Object.assign(schemas['kit-design'].properties.components.items.properties,{origin:{type:['object','null'],properties:{kind:{enum:['own','catalog','recipe','exemplar']},ref:{type:['string','null']},license:{type:['string','null']},url:{type:['string','null']}},required:['kind','ref','license','url'],additionalProperties:false}});
schemas['assist-segments']=object({suggestions:{...list(object({name:{...text,maxLength:80},purpose:{...text,maxLength:300},placement:{enum:['opening','closing','any']}}),8),minItems:1},note:{type:'string',maxLength:500}});
schemas['library-research']=object({summary:text,added:list(object({id:text,name:text,kind:text,why:text}),60),notes:list(text,20)});
schemas['resource-review']=object({summary:text,resources:list(object({resourceId:text,inspected:{type:'boolean'},score:{type:['number','null'],minimum:0,maximum:100},recommendation:{enum:['use','reserve','reject']},relevance:text,quality:text,compositionFit:text,suggestedUse:{type:'string'},limitations:list(text,12)}),8)});
const ajv = new Ajv({allErrors:true,strict:false});
const validators=Object.fromEntries(Object.entries(schemas).map(([key,schema])=>[key,ajv.compile(schema)]));
export function validate(kind,value) {
  const validator=validators[kind];
  if(!validator)throw new Error(`Contrato desconocido: ${kind}`);
  if(!validator(value))throw new Error(`Respuesta ${kind} inválida: ${ajv.errorsText(validator.errors)}`);
  if(kind==='storyboard'||kind==='script') {
    const ids=value.scenes.map(s=>s.id);
    if(new Set(ids).size!==ids.length)throw new Error('Las escenas deben tener identificadores únicos.');
    if(kind==='storyboard')for(const scene of value.scenes)validateDesign(scene);
    if(kind==='storyboard'&&value.scenes.some(scene=>scene.type==='diagram'&&scene.points.length<2))throw new Error('Un diagrama requiere al menos dos nodos en points. Usa bullets para un solo concepto.');
  }
  if(kind==='storyboard'&&value.distinctness?.length&&value.distinctness.filter(item=>item.answer===false).length>=2)throw new Error('La comprobación de personalidad tiene dos o más «no»: revisa el plan antes de entregarlo ('+value.distinctness.filter(item=>item.answer===false).map(item=>item.question).join(' | ')+').');
  if(kind==='storyboard'&&value.concepts?.length&&!value.concepts.some(item=>item.unexpected))throw new Error('Entre los enfoques propuestos debe haber al menos uno inesperado.');
  if(kind==='storyboard')for(const scene of value.scenes)for(const shot of scene.shots||[])if(shot.start+shot.duration>scene.duration+0.25)throw new Error(`El plano «${shot.job}» de la escena ${scene.id} termina después de la escena.`);
  if(kind==='plan')validatePlan(value);
  if(['review','final-review'].includes(kind)&&value.approved&&value.issues.some(issue=>issue.severity==='error'))throw new Error('La revisión no puede aprobar errores materiales.');
  return value;
}
export function validatePlan(plan) {
  const ids=new Set(plan.tasks.map(t=>t.id));
  if(ids.size!==plan.tasks.length)throw new Error('Tareas duplicadas.');
  if(plan.tasks.some(task=>['director','production-director','render','technical-review','audio-review','final-review'].includes(task.id)||(task.id.startsWith('media-')||task.id.startsWith('code-')||task.id.startsWith('resource-review-'))))throw new Error('El plan utiliza identificadores reservados para producción.');
  if(plan.tasks.filter(t=>t.kind==='storyboard').length!==1)throw new Error('El plan debe producir exactamente un storyboard.');
  const visited=new Set(),visiting=new Set();
  const visit=id=>{
    if(visiting.has(id))throw new Error('El plan contiene dependencias cíclicas.');
    if(visited.has(id))return;
    visiting.add(id);
    const task=plan.tasks.find(t=>t.id===id);
    for(const dependency of task.dependencies) {
      if(!ids.has(dependency))throw new Error(`Dependencia inexistente: ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);visited.add(id);
  };
  for(const id of ids)visit(id);
  return plan;
}
export const createSchema=object({prompt:{...text,minLength:10,maxLength:8000},duration:{type:'integer',minimum:15,maximum:600},runtime:{enum:['codex','claude','demo']},architecture:{enum:['single','multi']},context:{enum:['minimal','full']},style:{enum:['editorial','technology','whiteboard']},concurrency:{type:'integer',minimum:1,maximum:4},desktop:{type:'boolean'},sources:list(object({name:text,content:{...text,maxLength:100000}}),10)});
createSchema.properties.architecture.enum.push('tools');
createSchema.properties.style.enum.push('documentary','short','presentation','infographic','news');
Object.assign(createSchema.properties,{
  renderer:{enum:['remotion','hyperframes']},
  output:{type:'object',properties:{format:{enum:['landscape','portrait','square']},resolution:{enum:['720p','1080p']},fps:{enum:[24,30,60]}},additionalProperties:false},
  options:{type:'object',properties:{persistent:{type:'boolean'},replan:{type:'boolean'},finalReview:{type:'boolean'},externalMedia:{type:'boolean'},approvalGates:{type:'boolean'},webResearch:{type:'boolean'},maxReplans:{type:'integer',minimum:0,maximum:3}},additionalProperties:false},
  profile:{type:'object',properties:{
    visualIntensity:{enum:['standard','rich','cinematic']},font:{enum:['Inter','DM Sans','Arial']},
    palette:{type:'object',properties:Object.fromEntries(['background','ink','accent','card'].map(key=>[key,{type:'string',pattern:'^#[0-9a-fA-F]{6}$'}])),additionalProperties:false},
    logoAssetId:{type:['string','null']},voice:{type:'string',maxLength:200},captions:{type:'boolean'},captionStyle:{type:'string',maxLength:1000},musicAssetId:{type:['string','null']},musicVolume:{type:'number',minimum:0,maximum:0.5},imageStyle:{type:'string',maxLength:500},transition:{enum:transitions},recordingVolume:{type:'number',minimum:0,maximum:1},loudness:{type:'number',minimum:-24,maximum:-9}
  },additionalProperties:false}
});
Object.assign(createSchema.properties.options.properties,{factCheck:{type:'boolean'},publish:{type:'boolean'},budgetTokens:{type:['integer','null'],minimum:0},budgetCost:{type:['number','null'],minimum:0},autonomousProduction:{type:'boolean'},storyboardApproval:{type:'boolean'},critic:{type:'boolean'},criticRounds:{type:'integer',minimum:0,maximum:3},audioReview:{type:'boolean'},deepReview:{type:'boolean'},sharedKnowledge:{type:'boolean'}});
// authoring=code: el storyboard asigna a cada escena un motor y un agente programa su composición.
createSchema.properties.authoring={enum:['code','json']};
// Modelo y esfuerzo por rol de agente, por runtime (lo hereda cada vídeo de su proyecto).
const roleSchema={type:'object',properties:{model:{type:'string',pattern:'^[a-z0-9.-]{2,60}$'},effort:{enum:['low','medium','high','xhigh','max']}},required:['model'],additionalProperties:false};
createSchema.properties.agents={type:'object',properties:{claude:{type:'object',additionalProperties:roleSchema},codex:{type:'object',additionalProperties:roleSchema}},additionalProperties:false};
const createValidator=ajv.compile(createSchema);
export function validateCreate(value) { if(!createValidator(value))throw new Error(ajv.errorsText(createValidator.errors));return value; }
