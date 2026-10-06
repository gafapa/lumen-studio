// Recibo de un vídeo (idea de Showtime, references/receipt.md): la petición literal, cuánto trabajo costó por rol
// (llamadas, tokens, tiempo), las rondas de crítica de cada escena y si los revisores demostraron mirar.
// Solo cuenta lo registrado; el coste en dinero solo aparece si el usuario configuró precios y es un mínimo.
import path from 'node:path';
import {writeFile} from 'node:fs/promises';

const ROLE_NAMES={plan:'Director',storyboard:'Storyboard','scene-code':'Programador de escenas','scene-critic':'Crítico',research:'Investigación',review:'Revisión','final-review':'Revisión final','resource-review':'Revisión de recursos','production-plan':'Plan de producción',script:'Guion',screencast:'Operador del PC','fact-check':'Verificador de hechos',publish:'Publicación'};
export function receipt(project,{prices={}}={}){
  const byRole=project.metrics?.byRole||{},roles=Object.entries(byRole).map(([kind,role])=>{const price=prices[role.model]||null,cost=price?((role.inputTokens-(role.cachedTokens||0))*(price.input||0)+(role.cachedTokens||0)*(price.cached??price.input??0)+role.outputTokens*(price.output||0))/1e6:null;return {kind,name:ROLE_NAMES[kind]||kind,calls:role.calls,inputTokens:role.inputTokens,cachedTokens:role.cachedTokens||0,outputTokens:role.outputTokens,durationMs:role.durationMs,model:role.model,effort:role.effort,cost};}).sort((a,b)=>(b.inputTokens+b.outputTokens)-(a.inputTokens+a.outputTokens));
  const scenes=(project.tasks||[]).filter(task=>task.kind==='scene-code'&&task.output).map(task=>({sceneId:task.sceneId,title:project.storyboard?.scenes.find(scene=>scene.id===task.sceneId)?.title||task.sceneId,rounds:task.output.rounds||1,score:task.output.critique?.score??null,wouldPost:task.output.critique?.wouldPost??null,verified:task.output.critique?.verified??null,history:task.output.critique?.history||[]}));
  const priced=roles.filter(role=>role.cost!=null),total=roles.reduce((sum,role)=>({calls:sum.calls+role.calls,inputTokens:sum.inputTokens+role.inputTokens,cachedTokens:sum.cachedTokens+role.cachedTokens,outputTokens:sum.outputTokens+role.outputTokens,durationMs:sum.durationMs+role.durationMs}),{calls:0,inputTokens:0,cachedTokens:0,outputTokens:0,durationMs:0});
  return {videoId:project.id,title:project.title,request:project.prompt,createdAt:project.createdAt,completedAt:project.status==='completed'?project.updatedAt:null,status:project.status,runtime:project.runtime,
    duration:project.render?.duration??null,scenes:project.storyboard?.scenes?.length||0,wallTimeMs:project.wallTimeMs||null,unknownUsageCalls:project.metrics?.unknownUsageCalls||0,
    roles,total,cost:priced.length?{amount:priced.reduce((sum,role)=>sum+role.cost,0),complete:priced.length===roles.length,note:'Mínimo estimado con los precios configurados; no es una factura.'}:null,
    critic:{scenes,rounds:scenes.reduce((sum,scene)=>sum+scene.rounds,0),unverified:scenes.filter(scene=>scene.verified===false).length},
    finalReview:project.finalReview?{approved:project.finalReview.approved,verified:project.finalReview.verified??null,wouldPost:project.finalReview.wouldPost??null}:null};
}
const tokens=value=>value>=1e6?(value/1e6).toFixed(2)+' M':value>=1e3?Math.round(value/1e3)+' k':String(value);
export function receiptMarkdown(data){
  return [`# Recibo · ${data.title}`,'',`Petición literal: «${data.request}»`,'',`- Estado: ${data.status} · ${data.scenes} escenas${data.duration?` · ${data.duration.toFixed(1)} s`:''} · motor de agentes: ${data.runtime}`,`- Llamadas: ${data.total.calls} · tokens de entrada: ${tokens(data.total.inputTokens)} (${tokens(data.total.cachedTokens)} en caché) · de salida: ${tokens(data.total.outputTokens)}${data.unknownUsageCalls?` · ${data.unknownUsageCalls} llamadas sin consumo informado`:''}`,data.cost?`- Coste mínimo estimado: ${data.cost.amount.toFixed(2)} $ ${data.cost.complete?'':'(faltan precios de algunos modelos)'}`:'- Coste: sin precios configurados.','',
    '| Rol | Modelo | Llamadas | Entrada | Salida |','|---|---|---|---|---|',...data.roles.map(role=>`| ${role.name} | ${role.model||'—'}${role.effort?' · '+role.effort:''} | ${role.calls} | ${tokens(role.inputTokens)} | ${tokens(role.outputTokens)} |`),'',
    `Rondas de crítica: ${data.critic.rounds}${data.critic.unverified?` · ${data.critic.unverified} escenas con crítico sin prueba de mirada`:''}`].join('\n');
}
export async function writeReceipt(folder,project,options){const data=receipt(project,options);await writeFile(path.join(folder,'receipt.json'),JSON.stringify(data,null,2));await writeFile(path.join(folder,'receipt.md'),receiptMarkdown(data));return data;}

// Límite de gasto por vídeo: tokens (entrada + salida) y coste con los precios configurados. budgetExtra amplía el límite.
export function budgetState(project,prices={}){
  const limitTokens=project.options?.budgetTokens||null,limitCost=project.options?.budgetCost||null,factor=1+(project.budgetExtra||0);if(!limitTokens&&!limitCost)return {exceeded:false,limited:false};
  const data=receipt(project,{prices}),tokens=data.total.inputTokens+data.total.outputTokens,cost=data.cost?.amount??null;
  const overTokens=limitTokens?tokens>=limitTokens*factor:false,overCost=limitCost&&cost!=null?cost>=limitCost*factor:false;
  return {limited:true,exceeded:overTokens||overCost,tokens,cost,limitTokens:limitTokens?Math.round(limitTokens*factor):null,limitCost:limitCost?Math.round(limitCost*factor*100)/100:null,share:Math.max(limitTokens?tokens/(limitTokens*factor):0,limitCost&&cost!=null?cost/(limitCost*factor):0)};
}
