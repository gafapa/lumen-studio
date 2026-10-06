import {spawn} from 'node:child_process';
export function execute(file,args,{cwd,input='',signal,timeout=600000,onLine=()=>{},env=process.env}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',buffer='',settled=false;
    const stop=()=>{
      if(process.platform==='win32'&&child.pid)spawn('taskkill',['/pid',String(child.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});
      else child.kill('SIGTERM');
    };
    const timer=setTimeout(()=>{stop();finish(new Error('Se ha agotado el tiempo de ejecución.'));},timeout);
    const abort=()=>{stop();finish(new Error('Ejecución detenida.'));};
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{stdout+=chunk;buffer+=chunk;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);onLine(line);}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-200000);});
    child.on('error',error=>finish(error));
    child.on('close',code=>{if(buffer)onLine(buffer);finish(null,{code,stdout,stderr});});
    child.stdin.on('error',()=>{});child.stdin.end(input,'utf8');
    if(signal?.aborted)abort();
  });
}
