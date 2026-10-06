import {spawn} from 'node:child_process';
const processes = [spawn(process.execPath,['server/index.mjs'],{stdio:'inherit',windowsHide:true}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit',windowsHide:true})];
let stopping = false;
function stop(code=0) { if(stopping)return; stopping=true; for(const child of processes)child.kill(); setTimeout(()=>process.exit(code),300).unref(); }
for(const child of processes)child.on('exit',code=>stop(code||0));
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
