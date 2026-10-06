import {cp,stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.'),target=path.resolve(root,'releases/Lumen Studio-win32-x64/resources/app');
if(!target.startsWith(root+path.sep)||!target.endsWith(path.join('resources','app')))throw new Error('Destino de actualización inválido.');
await stat(path.join(target,'vendor/node.exe'));
for(const name of ['server','src','dist','scripts','skills','assets','desktop','README.md','package.json','.env.example'])await cp(path.join(root,name),path.join(target,name),{recursive:true});
console.log('Paquete portátil actualizado con la implementación verificada.');
