import {writeFile,mkdir} from 'node:fs/promises';
const base='http://127.0.0.1:4310';
const request=async(url,body)=>{for(let attempt=0;attempt<3;attempt++){try{const response=await fetch(`${base}/api${url}`,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const data=await response.json();if(!response.ok)throw new Error(data.error);return data;}catch(error){if(body||attempt===2||!['ECONNRESET','UND_ERR_SOCKET'].includes(error.cause?.code))throw error;}}};
await mkdir('.data/verification',{recursive:true});
for(const runtime of ['codex','claude']){
  const input={prompt:'Crea un vídeo de 15 segundos titulado «DHCP en 15 segundos». Explica solo los apuntes aportados, con dos escenas y como máximo 30 palabras de narración total. No necesitas investigar en la web.',duration:15,runtime,architecture:'single',context:'minimal',style:'editorial',concurrency:2,desktop:false,sources:[{name:'Apuntes sobre DHCP',content:'Identificador: apuntes. DHCP permite asignar automáticamente una dirección IP y parámetros de configuración de red a un dispositivo cliente. El servidor administra las direcciones disponibles.'}]};
  const previous=(await request('/projects')).find(item=>item.runtime===runtime&&item.prompt===input.prompt);
  const project=previous||await request('/projects',input);if(!['completed','needs-review','approved','planning','running'].includes(project.status))await request(`/projects/${project.id}/run`,{});console.log('Proyecto',runtime,project.id);
  let last=null;const deadline=Date.now()+900000;
  while(Date.now()<deadline){
    const current=await request(`/projects/${project.id}`);if(last!==current.status){last=current.status;console.log(runtime,current.status);}
    if(['completed','needs-review','approved','failed'].includes(current.status)){await writeFile(`.data/verification/${runtime}-pipeline.json`,JSON.stringify(current,null,2));console.log('Resultado',runtime,{status:current.status,error:current.error,metrics:current.metrics,render:current.render?.path});if(current.status==='failed')process.exitCode=1;break;}
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
}
