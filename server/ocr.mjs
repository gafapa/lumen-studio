import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createWorker} from 'tesseract.js';
import {createCanvas} from '@napi-rs/canvas';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function createOcr(){const cachePath=path.join(process.env.LUMEN_TOOLS_DIR||path.join(root,'.tools'),'ocr');await mkdir(cachePath,{recursive:true});const worker=await createWorker(['spa','eng'],1,{cachePath,logger:()=>{}});return {recognize:async input=>(await worker.recognize(input)).data.text,close:()=>worker.terminate()};}
export async function recognizePage(page,ocr){const initial=page.getViewport({scale:2}),scale=Math.min(2,Math.sqrt(6000000/(initial.width*initial.height))*2),viewport=page.getViewport({scale});const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvasContext:canvas.getContext('2d'),viewport,canvas}).promise;return ocr.recognize(canvas.toBuffer('image/png'));}
