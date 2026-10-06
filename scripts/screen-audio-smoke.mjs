import assert from 'node:assert/strict';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {Store} from '../server/store.mjs';
import {Harness} from '../server/harness.mjs';
import {Desktop} from '../server/desktop.mjs';
import {producePart} from '../server/media-parts.mjs';
import {execute} from '../server/process.mjs';
const store=new Store(path.resolve(`.data/verification/screen-audio-${Date.now()}`)),desktop=new Desktop(store),harness=new Harness(store,desktop);
const project=await harness.create({prompt:'Prueba de grabación de pantalla y sonido del sistema, sin clics ni escritura.',duration:15,runtime:'demo',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:true,sources:[]});
try{
  project.storyboard={scenes:[{id:'audio',narration:'El servidor configura automáticamente los equipos de la red. Cada equipo recibe una dirección.',duration:10}]};
  const voice=await producePart(project,'audio','voice',harness.folder(project.id),new AbortController().signal);
  await desktop.action(project.id,'human','start_recording',{seconds:5,systemAudio:true});
  const played=await execute('powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System; $player=New-Object System.Media.SoundPlayer; $player.SoundLocation=$env:LUMEN_TEST_AUDIO; $player.PlaySync();'],{env:{...process.env,LUMEN_TEST_AUDIO:path.join(harness.folder(project.id),voice.audioPath)},timeout:30000});assert.equal(played.code,0,played.stderr);
  await desktop.stop(project.id,'human');const clip=store.get(project.id).recordings.at(-1);assert.equal(clip.status,'completed');assert.equal(clip.systemAudio,true);
  const absolute=path.join(harness.folder(project.id),clip.path),probe=await execute(ffprobe.path,['-v','error','-show_streams','-of','json',absolute]);assert.equal(probe.code,0);const streams=JSON.parse(probe.stdout).streams;assert.ok(streams.some(stream=>stream.codec_type==='video'));assert.ok(streams.some(stream=>stream.codec_type==='audio'&&stream.codec_name==='aac'));
  const volume=await execute(ffmpeg,['-hide_banner','-i',absolute,'-vn','-af','volumedetect','-f','null','-']);const mean=Number(/mean_volume: (-?[\d.]+)/.exec(volume.stderr)?.[1]);assert.ok(Number.isFinite(mean)&&mean>-60);
  console.log('PASS · Pantalla y sonido real unidos en MP4 H.264/AAC.',{projectId:project.id,seconds:clip.durationSeconds,meanVolume:mean});
}finally{if(desktop.recording)await desktop.stop(project.id,'human').catch(()=>{});store.close();}
