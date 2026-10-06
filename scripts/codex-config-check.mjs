import path from 'node:path';
import {execute} from '../server/process.mjs';
const command=process.env.CODEX_BIN||'codex';
const help=await execute(command,['exec','--help'],{timeout:30000});console.log(help.stdout.split('\n').filter((line,index,lines)=>/ignore-user-config|config|mcp|sandbox/.test(line)||/ignore-user-config/.test(lines[index-1]||'')).join('\n'));
const args=['mcp','list','--json','-c',`mcp_servers.lumen_test.command=${JSON.stringify(process.execPath)}`,'-c',`mcp_servers.lumen_test.args=[${JSON.stringify(path.resolve('server/mcp.mjs'))}]`];
for(const ignore of [true,false]){
 const response=await execute(command,ignore?[...args,'--ignore-user-config']:args,{timeout:30000});
 try{const parsed=JSON.parse(response.stdout);console.log('MCP registrado',ignore,parsed.filter(item=>item.name==='lumen_test').map(item=>({name:item.name,enabled:item.enabled,transportType:item.transport?.type})));}catch{console.log('Comprobación',ignore,response.code,response.stderr.slice(-500));}
}
