// Actualiza las skills oficiales de HyperFrames y Remotion que leen los agentes programadores de escenas.
// Uso: node scripts/update-vendor-skills.mjs   (requiere git y conexión)
import {mkdtemp,rm,cp,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'..');
const target=path.join(root,'skills','vendor');
const sources={
  hyperframes:{repo:'https://github.com/heygen-com/hyperframes',folder:'skills',skills:['hyperframes-core','hyperframes-animation','hyperframes-keyframes','hyperframes-creative','hyperframes-audio','hyperframes-registry','embedded-captions','talking-head-recut','general-video','motion-graphics','music-to-video'],license:'LICENSE'},
  remotion:{repo:'https://github.com/remotion-dev/remotion',folder:'packages/skills/skills',skills:['remotion-best-practices','remotion-markup','remotion-captions','remotion-multimedia'],license:null},
};
const work=await mkdtemp(path.join(os.tmpdir(),'lumen-skills-'));const commits={};
try{
  for(const [name,source] of Object.entries(sources)){
    const clone=path.join(work,name);
    execFileSync('git',['clone','-q','--depth','1','--filter=blob:none','--sparse',source.repo,clone],{stdio:'inherit'});
    execFileSync('git',['-C',clone,'sparse-checkout','set',source.folder],{stdio:'inherit'});
    commits[name]=execFileSync('git',['-C',clone,'rev-parse','--short','HEAD']).toString().trim();
    await rm(path.join(target,name),{recursive:true,force:true});
    for(const skill of source.skills)await cp(path.join(clone,source.folder,skill),path.join(target,name,skill),{recursive:true,verbatimSymlinks:true,filter:file=>!file.includes(`${path.sep}.git`)});
    if(source.license)await cp(path.join(clone,source.license),path.join(target,name,'LICENSE'));
  }
  await writeFile(path.join(target,'README.md'),`Skills de terceros incluidas sin modificar.\n\n- hyperframes/: ${sources.hyperframes.repo} (carpeta skills, commit ${commits.hyperframes}), licencia Apache 2.0 (ver hyperframes/LICENSE).\n- remotion/: ${sources.remotion.repo} (packages/skills, commit ${commits.remotion}), sujeta a la licencia de Remotion: https://www.remotion.dev/docs/license\n\nActualízalas con scripts/update-vendor-skills.mjs.\n`);
  console.log('Skills actualizadas:',commits);
}finally{await rm(work,{recursive:true,force:true});}
