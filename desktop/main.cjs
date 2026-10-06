const {app,BrowserWindow,Menu,shell}=require('electron');
const {spawn}=require('node:child_process');
const {existsSync,readFileSync,mkdirSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const net=require('node:net');
const root=path.resolve(__dirname,'..'),smoke=process.argv.includes('--smoke');
let backend,base,window,quitting=false;
async function verifyProduction(destination){
  const request=async(url,body)=>{for(let attempt=0;;attempt++){try{const response=await fetch(base+'/api'+url,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});const value=await response.json();if(!response.ok)throw new Error(value.error);return value;}catch(error){if(body||attempt>=4)throw new Error(url+': '+error.message+' '+(error.cause?.message||''));await new Promise(resolve=>setTimeout(resolve,500*(attempt+1)));}}};
  const tools=await request('/tools');if(!tools.whisper.ready||!tools.audio.ready)throw new Error('Las herramientas locales no están disponibles en el paquete.');
  const project=await request('/projects',{prompt:'Comprobar el render del paquete portátil con el director de producción y revisión del audio.',runtime:'demo',duration:15,architecture:'tools',context:'minimal',style:'editorial',concurrency:2,desktop:false,sources:[],output:{format:'square',resolution:'1080p',fps:60},options:{autonomousProduction:true,audioReview:true}});
  await request('/projects/'+project.id+'/run',{});const deadline=Date.now()+900000;let result;
  while(Date.now()<deadline){result=await request('/projects/'+project.id);if(['completed','needs-review','failed'].includes(result.status))break;await new Promise(resolve=>setTimeout(resolve,1000));}
  if(!['completed','needs-review'].includes(result.status)||!result.productionPlan||!result.audioReview||result.render?.width!==1080||result.render?.fps!==60)throw new Error(result.error||'La producción del paquete no terminó correctamente.');
  writeFileSync(destination+'.json',JSON.stringify({projectId:project.id,status:result.status,render:result.render,audioReview:result.audioReview,tools:{whisper:tools.whisper.ready,audio:tools.audio.ready}},null,2));
  console.log('PASS · Producción nativa del paquete: 1080×1080, 60 fps, DAG y revisión del audio.');
}
const shutdownToken=crypto.randomBytes(32).toString('hex');
if(!app.requestSingleInstanceLock())app.quit();
app.on('second-instance',()=>{if(window){window.show();window.focus();}});
async function freePort(){const server=net.createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
app.whenReady().then(async()=>{
  const port=await freePort();base=`http://127.0.0.1:${port}`;
  const tools=app.isPackaged?path.join(root,'vendor/tools'):path.join(root,'.tools');
  const node=app.isPackaged?path.join(root,'vendor/node.exe'):path.join(readFileSync(path.join(tools,'node-path.txt'),'utf8').trim(),'node.exe');
  if(!existsSync(node))throw new Error('Falta el runtime Node portátil. Ejecuta iniciar.ps1 antes.');
  const data=process.env.LUMEN_DATA_DIR||(app.isPackaged?path.join(app.getPath('userData'),'data'):path.join(root,'.data'));
  mkdirSync(data,{recursive:true});
  backend=spawn(node,[path.join(root,'server/index.mjs'),'--production'],{cwd:root,windowsHide:true,env:{...process.env,PORT:String(port),LUMEN_DATA_DIR:data,LUMEN_TOOLS_DIR:tools,LUMEN_ENV_FILE:app.isPackaged?path.join(app.getPath('userData'),'.env'):path.join(root,'.env'),LUMEN_SHUTDOWN_TOKEN:shutdownToken},stdio:['ignore','pipe','pipe']});
  let error='';backend.stderr.on('data',value=>{error=(error+value).slice(-4000);});backend.on('error',err=>{error=err.message;});
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/projects');if(r.ok){ready=true;break;}}catch{}if(backend.exitCode!==null)throw new Error(error||'El servidor terminó.');await new Promise(resolve=>setTimeout(resolve,200));}if(!ready)throw new Error(error||'El servidor no respondió.');
  window=new BrowserWindow({width:1440,height:980,minWidth:850,minHeight:650,show:!smoke,title:'Lumen Video Studio',backgroundColor:'#f7f8fc',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  window.webContents.session.setPermissionRequestHandler((webContents,permission,callback)=>callback(false));
  window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==base)event.preventDefault();});
  window.webContents.setWindowOpenHandler(({url})=>{if(['http:','https:'].includes(new URL(url).protocol))shell.openExternal(url);return {action:'deny'};});
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'Archivo',submenu:[{role:'quit',label:'Salir'}]},{label:'Ver',submenu:[{role:'reload',label:'Recargar'},{role:'togglefullscreen',label:'Pantalla completa'}]}]));
  await window.loadURL(base);
  if(smoke){const destination=process.env.LUMEN_DESKTOP_SMOKE||path.join(root,'.data/verification/desktop.png');mkdirSync(path.dirname(destination),{recursive:true});if(process.env.LUMEN_DESKTOP_VERIFY==='1')await verifyProduction(destination);await new Promise(resolve=>setTimeout(resolve,1200));const screenshot=await window.webContents.capturePage();writeFileSync(destination,screenshot.toPNG());console.log('PASS · Aplicación Electron con backend aislado y ventana renderizada.');app.quit();}
}).catch(error=>{console.error(error.message);if(backend)backend.kill();app.exit(1);});
app.on('window-all-closed',()=>{if(!quitting)app.quit();});
app.on('before-quit',event=>{if(quitting||!backend)return;event.preventDefault();quitting=true;if(window&&!window.isDestroyed())window.destroy();(async()=>{try{await fetch(base+'/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+shutdownToken},signal:AbortSignal.timeout(15000)});}catch{}const timer=setTimeout(()=>backend.kill(),10000);backend.once('close',()=>clearTimeout(timer));if(backend.exitCode===null)await new Promise(resolve=>{backend.once('close',resolve);setTimeout(resolve,11000);});app.quit();})();});
