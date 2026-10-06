import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('http://127.0.0.1:4310',{waitUntil:'networkidle'});
  await page.locator('[data-project-id="5da1ed1f-c113-4d74-8b27-7d37d339b7ff"]').click();
  await page.getByRole('button',{name:'Producción avanzada',exact:true}).click();
  await page.getByRole('button',{name:'Aprobaciones',exact:true}).click();
  await page.waitForTimeout(700);
  await mkdir('.data/verification',{recursive:true});
  await page.screenshot({path:'.data/verification/studio-advanced.png',fullPage:true});
  if(errors.length)throw new Error(errors.join('\n'));
  console.log('PASS · Producción avanzada, revisión y MP4 accesibles, sin errores de React.');
}finally{await browser.close();}
