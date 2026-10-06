export const defaultSettings={providers:[],allowedDomains:[],mcpServers:[],quotaObservations:[],prices:{}};
export function settings(store){return {...defaultSettings,...store.setting('studio',{})};}
export function updateSettings(store,input){
  const previous=settings(store);const next={...previous,...input};
  delete next.lms;
  if(!Array.isArray(next.providers)||next.providers.length>20)throw new Error('Máximo 20 proveedores.');
  const ids=new Set();for(const item of next.providers){
    if(!/^[a-z0-9-]{1,64}$/.test(item.id)||ids.has(item.id))throw new Error('Identificador de proveedor inválido o duplicado.');ids.add(item.id);
    if(!['fal','pexels','http'].includes(item.adapter)||!['image','video','stock','music','voice'].includes(item.kind))throw new Error('Adaptador o tipo inválido.');
    if(item.keyEnv&&!/^[A-Z][A-Z0-9_]{0,99}$/.test(item.keyEnv))throw new Error('Nombre de variable de credencial inválido.');
    if(item.adapter==='http'&&!/^https?:\/\//.test(item.url||''))throw new Error('El adaptador HTTP necesita una URL.');
    if(item.adapter==='fal'&&!/^[a-zA-Z0-9_/-]+$/.test(item.model||''))throw new Error('Modelo fal inválido.');
    if(JSON.stringify(item).length>12000)throw new Error('Configuración de proveedor demasiado grande.');
    delete item.apiKey;delete item.secret;delete item.token;
  }
  if(!Array.isArray(next.allowedDomains)||next.allowedDomains.some(domain=>typeof domain!=='string'||!/^[a-zA-Z0-9.-]+$/.test(domain)))throw new Error('Dominios inválidos.');
  if(!Array.isArray(next.mcpServers)||next.mcpServers.length>10)throw new Error('Configuración MCP inválida.');
  for(const server of next.mcpServers){if(!/^[a-z0-9-]+$/.test(server.id)||typeof server.command!=='string'||!Array.isArray(server.args)||server.args.some(arg=>typeof arg!=='string'))throw new Error('Servidor MCP inválido.');}
  if(typeof next.prices!=='object'||next.prices===null||Array.isArray(next.prices)||Object.keys(next.prices).length>40||Object.values(next.prices).some(price=>typeof price!=='object'||['input','output','cached'].some(key=>price[key]!=null&&!(Number(price[key])>=0))))throw new Error('Precios inválidos: usa {"modelo":{"input":3,"output":15,"cached":0.3}} en dólares por millón de tokens.');
  if(!Array.isArray(next.quotaObservations)||next.quotaObservations.length>1000)throw new Error('Observaciones de cuota inválidas.');
  return store.setSetting('studio',next);
}
export function providerAvailability(store){return settings(store).providers.map(provider=>({...provider,ready:provider.enabled===true&&(!provider.keyEnv||Boolean(process.env[provider.keyEnv]))}));}
