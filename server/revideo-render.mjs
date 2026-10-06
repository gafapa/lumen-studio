// Render de una escena Revideo en un proceso aparte, con el directorio de la escena como directorio de trabajo
// (Revideo inserta la ruta del proyecto sin escapar las barras de Windows, así que necesita una ruta relativa).
// Uso: node revideo-render.mjs <json con {outFile,outDir,executablePath}>. Sin telemetría.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.env.DISABLE_TELEMETRY='true';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),modules=path.join(root,'node_modules').split(path.sep).join('/');
const options=JSON.parse(process.argv[2]||'{}');
const {renderVideo}=await import('@revideo/renderer');
try{
  const file=await renderVideo({projectFile:options.projectFile||'./src/project.ts',settings:{outFile:options.outFile||'scene.mp4',outDir:options.outDir||'./.lumen/render',logProgress:false,workers:1,puppeteer:{executablePath:options.executablePath,args:['--no-sandbox']},
    viteConfig:{logLevel:'error',cacheDir:'./.lumen/vite',resolve:{alias:[{find:/^@revideo\/([^/]+)(\/.*)?$/,replacement:modules+'/@revideo/$1$2'}]},server:{fs:{strict:false}}}}});
  process.stdout.write(JSON.stringify({ok:true,file})+'\n');process.exit(0);
}catch(error){process.stdout.write(JSON.stringify({ok:false,error:String(error?.message||error).slice(0,2000)})+'\n');process.exit(1);}
