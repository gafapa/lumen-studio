import {createHash} from 'node:crypto';
const active=new Map();
export async function persistentProvider(provider,request,signal,context,invoke){
  const {store,projectId,revision=0,scope='asset'}=context||{};
  if(!store)return invoke(null,()=>{});
  const id=createHash('sha256').update(JSON.stringify({projectId,scope,revision,providerId:provider.id,request})).digest('hex');
  if(active.has(id))return active.get(id);
  const operation=(async()=>{
    let job=store.job(id);
    if(job?.status==='completed')return job.result;
    if(job?.status==='failed')throw new Error(job.error);
    if(job&&['submitting','uncertain'].includes(job.status)&&!provider.idempotent)throw new Error('Esta solicitud pudo enviarse antes del cierre. Reconcíliala en Solicitudes externas antes de repetirla.');
    job=job||{id,projectId,scope,revision,providerId:provider.id,request,status:'submitting',createdAt:new Date().toISOString()};store.saveJob(job);
    const checkpoint=remote=>{job.remote=remote;job.status='queued';store.saveJob(job);store.event(projectId,'provider.queued',{jobId:id,providerId:provider.id,requestId:remote.request_id});};
    try{const result=await invoke(job,checkpoint);job.status='completed';job.result=result;delete job.error;store.saveJob(job);return result;}
    catch(error){if(job.status!=='queued'||error.definitive){job.status=error.definitive?'failed':'uncertain';job.error=error.message;store.saveJob(job);}throw error;}
  })().finally(()=>active.delete(id));active.set(id,operation);return operation;
}
export function reconcileProviderJob(store,id,{url,cancelled=false}){
  const job=store.job(id);if(!job)throw new Error('Solicitud inexistente.');
  if(cancelled){job.status='failed';job.error='Solicitud descartada por el usuario.';}
  else {const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new Error('URL de resultado inválida.');job.status='completed';job.result={url,credit:null};}
  store.saveJob(job);store.event(job.projectId,'provider.reconciled',{jobId:id,status:job.status});return job;
}
