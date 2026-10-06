import {randomUUID} from 'node:crypto';
export class Benchmarks {
  constructor(store,harness){this.store=store;this.harness=harness;this.active=new Map();for(const batch of this.list())if(batch.status==='running'){batch.status='paused';this.save(batch);}}
  list(){return this.store.setting('experiments',[]);}
  save(batch){const list=this.list(),index=list.findIndex(item=>item.id===batch.id);if(index<0)list.push(batch);else list[index]=batch;this.store.setSetting('experiments',list);return batch;}
  async create(input){
    if(typeof input.prompt!=='string'||input.prompt.length<10||!Array.isArray(input.cases)||!input.cases.length||input.cases.length>100)throw new Error('Define un encargo y de 1 a 100 casos.');
    const batch={id:randomUUID(),prompt:input.prompt,status:'draft',createdAt:new Date().toISOString(),cases:[]};
    for(const spec of input.cases){const project=await this.harness.create({prompt:input.prompt,duration:spec.duration||60,runtime:spec.runtime||'codex',architecture:spec.architecture||'single',context:spec.context||'minimal',style:'editorial',concurrency:spec.concurrency||2,desktop:false,sources:input.sources||[],renderer:spec.renderer||'remotion',options:{persistent:spec.persistent||false,finalReview:spec.runtime!=='demo',replan:true,maxReplans:1,externalMedia:false}});batch.cases.push({projectId:project.id,spec,status:'pending'});}
    return this.save(batch);
  }
  run(id){const batch=this.list().find(item=>item.id===id);if(!batch)throw new Error('Experimento inexistente.');if(this.active.has(id))return batch;batch.status='running';this.save(batch);const control={paused:false};this.active.set(id,control);
    control.operation=(async()=>{for(const item of batch.cases){if(control.paused)break;const project=this.store.get(item.projectId);if(['completed','approved'].includes(project.status)){item.status='completed';continue;}item.status='running';this.save(batch);control.projectId=item.projectId;await this.harness.run(item.projectId);await this.harness.active.get(item.projectId)?.operation;const result=this.store.get(item.projectId);item.status=result.status;item.metrics=result.metrics;item.wallTimeMs=result.wallTimeMs||null;item.review=result.finalReview||result.review||result.technicalReview;this.save(batch);if(result.status==='paused'){control.paused=true;break;}}batch.status=control.paused?'paused':batch.cases.some(item=>!['completed','approved'].includes(item.status))?'needs-review':'completed';this.save(batch);})().catch(error=>{batch.status='failed';batch.error=error.message;this.save(batch);}).finally(()=>this.active.delete(id));return batch;
  }
  async pause(id){const control=this.active.get(id);if(control){control.paused=true;if(control.projectId)await this.harness.pause(control.projectId);await control.operation;}const batch=this.list().find(item=>item.id===id);if(batch){batch.status='paused';this.save(batch);}return batch;}
}
