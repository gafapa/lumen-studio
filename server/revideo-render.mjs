// Render de una escena Revideo en un proceso aparte, con el directorio de la escena como directorio de trabajo
// (Revideo inserta la ruta del proyecto sin escapar las barras de Windows, así que necesita una ruta relativa).
// Uso: node revideo-render.mjs <json con {outFile,outDir,executablePath}>. Sin telemetría.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.env.DISABLE_TELEMETRY='true';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),modules=path.join(root,'node_modules').split(path.sep).join('/');
const options=JSON.parse(process.argv[2]||'{}');
const {renderVideo}=await import('@revideo/renderer');
// La primera vez que se abre una escena, Vite empaqueta las dependencias y recarga la página a mitad del render
// ("Navigating frame was detached"): se repite una vez, ya con la caché creada.
const reloaded=error=>/frame was detached|Execution context was destroyed|Target closed/i.test(String(error?.message||error));
const render=()=>renderVideo({projectFile:options.projectFile||'./src/project.ts',settings:{outFile:options.outFile||'scene.mp4',outDir:options.outDir||'./.lumen/render',logProgress:false,workers:1,puppeteer:{executablePath:options.executablePath,dumpio:Boolean(process.env.CI),args:['--no-sandbox','--disable-gpu','--disable-dev-shm-usage']},
    viteConfig:{logLevel:'error',cacheDir:'./.lumen/vite',resolve:{alias:[{find:/^@revideo\/([^/]+)(\/.*)?$/,replacement:modules+'/@revideo/$1$2'}]},server:{fs:{strict:false}}}}});
try{
  let file;try{file=await render();}catch(error){if(!reloaded(error))throw error;file=await render();}
  process.stdout.write(JSON.stringify({ok:true,file})+'\n');process.exit(0);
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:String(error?.message||error).slice(0,2000)})+'\n');process.exit(1);}
