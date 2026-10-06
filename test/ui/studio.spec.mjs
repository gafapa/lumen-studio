import {test,expect} from '@playwright/test';
// Abre un vídeo desde la portada, entrando antes en su proyecto si pertenece a uno.
async function openVideo(page,video){await page.goto('/');if(video.collectionId)await page.locator(`[data-collection-id="${video.collectionId}"]`).click();await page.locator(`[data-project-id="${video.id}"]`).click();}
test('interfaz, creación, vídeo real y edición parcial',async({page,request})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Proyectos de vídeo'})).toBeVisible();
  await page.screenshot({path:'.data/verification/dashboard.png',fullPage:true});
  await page.getByRole('button',{name:'Agentes',exact:true}).click();await expect(page.getByRole('heading',{name:'Tu equipo de agentes'})).toBeVisible();
  await page.getByRole('button',{name:'Biblioteca',exact:true}).click();await expect(page.getByRole('heading',{name:'Tu biblioteca visual'})).toBeVisible();
  await page.getByRole('button',{name:/Proyectos/}).first().click();
  await page.getByRole('button',{name:'Nuevo proyecto',exact:true}).first().click();await page.getByRole('button',{name:'o crear un proyecto vacío'}).click();
  await page.getByLabel('Nombre del proyecto',{exact:true}).fill('Pruebas de interfaz');await page.getByLabel('Motor de agentes').selectOption('demo');
  await page.getByRole('button',{name:'Crear proyecto',exact:true}).click();await expect(page.getByRole('heading',{name:'Pruebas de interfaz'})).toBeVisible();
  await page.getByRole('button',{name:'Nuevo vídeo',exact:true}).first().click();await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByLabel('Encargo del vídeo',{exact:true}).fill('Crea un vídeo de prueba sobre DHCP para principiantes.');
  await page.getByRole('dialog').locator('select').first().selectOption('15');
  await page.getByRole('button',{name:'Crear y producir'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  const projects=await (await request.get('/api/projects')).json();const id=projects.find(item=>item.prompt.includes('vídeo de prueba')).id;
  await expect.poll(async()=>{const project=await (await request.get(`/api/projects/${id}`,{maxRetries:2,timeout:120000})).json();if(project.status==='failed')throw new Error(project.error);return project.status;},{timeout:600000,intervals:[1000,3000,5000]}).toBe('completed');
  await expect(page.getByText('Vídeo renderizado',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Aprobar',exact:true})).toBeVisible();
  const before=await (await request.get(`/api/projects/${id}`)).json();expect(before.render.size).toBeGreaterThan(10000);expect(before.technicalReview.approved).toBe(true);
  const video=await request.get(`/api/projects/${id}/files/${before.render.path}`,{headers:{Range:'bytes=0-1023'}});expect(video.status()).toBe(206);expect(video.headers()['content-type']).toContain('video/mp4');
  await page.screenshot({path:'.data/verification/project.png',fullPage:true});
  await page.getByRole('textbox',{name:'Narración',exact:true}).fill('Esta es una narración editada para comprobar la regeneración de una escena.');
  await expect(page.getByText('Vídeo renderizado',{exact:true})).toHaveCount(0,{timeout:15000});
  await page.getByRole('button',{name:'Continuar producción'}).click();
  await expect.poll(async()=>{const project=await (await request.get(`/api/projects/${id}`,{maxRetries:2,timeout:120000})).json();if(project.status==='failed')throw new Error(project.error);return project.status;},{timeout:600000,intervals:[2000,5000]}).toBe('completed');
  const after=await (await request.get(`/api/projects/${id}`)).json();expect(after.tasks.find(item=>item.id==='media-scene-02').output.audioPath).toBe(before.tasks.find(item=>item.id==='media-scene-02').output.audioPath);expect(after.tasks.find(item=>item.id==='media-scene-01').output.audioPath).not.toBe(before.tasks.find(item=>item.id==='media-scene-01').output.audioPath);
  expect(after.render.reusedSegments).toBe(1);expect(['speech-events','transcribed']).toContain(after.render.captionMode);
  await page.getByRole('button',{name:'Aprobar',exact:true}).click();await expect(page.getByText('Vídeo aprobado',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('button',{name:'PC y grabaciones',exact:true}).click();await expect(page.getByRole('button',{name:'Capturar pantalla'})).toBeDisabled();
  const disabled=await request.post(`/api/projects/${id}/desktop/screenshot`,{data:{}});expect(disabled.status()).toBe(400);
  const hostile=await request.post(`/api/projects/${id}/run`,{headers:{Origin:'https://example.com'}});expect(hostile.status()).toBe(403);
  const unauthorized=await request.post('/api/internal/desktop',{data:{projectId:id,action:'screenshot',params:{}}});expect(unauthorized.status()).toBe(403);
  await page.locator('.desktop-panel .desktop-toggle').click();await expect(page.locator('.desktop-panel .desktop-toggle input[type=checkbox]')).toBeChecked();await expect(page.getByRole('button',{name:'Parada de emergencia'})).toBeVisible();
  await page.getByRole('button',{name:'Parada de emergencia'}).click();await expect(page.getByRole('button',{name:'Capturar pantalla'})).toBeDisabled();
  expect((await (await request.get(`/api/projects/${id}`)).json()).desktop).toBe(false);
  expect(errors).toEqual([]);
});
test('diseño móvil sin desbordamiento y modal accesible',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.getByRole('heading',{name:'Proyectos de vídeo'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'.data/verification/mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Nuevo proyecto',exact:true}).first().click();await expect(page.getByLabel('Idea del proyecto',{exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.getByRole('button',{name:'Cancelar',exact:true}).click();await expect(page.getByLabel('Idea del proyecto',{exact:true})).toHaveCount(0);
});

test('versiones y conocimiento desde la interfaz',async({page,request})=>{
  const projects=await (await request.get('/api/projects')).json();const project=projects.find(item=>item.render&&!item.example);expect(project).toBeTruthy();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await openVideo(page,project);await page.getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('button',{name:'Producción avanzada',exact:true}).click();
  await page.getByRole('button',{name:'Versiones',exact:true}).click();await page.getByLabel('Nombre de la versión').fill('Versión revisable');await page.getByRole('button',{name:'Guardar versión',exact:true}).click();await expect(page.getByText('Versión revisable',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Conocimiento',exact:true}).click();await page.getByLabel('Buscar conocimiento').fill('DHCP');await page.getByRole('button',{name:'Buscar fragmentos'}).click();
  await page.getByRole('button',{name:'Perfil visual',exact:true}).click();await page.getByLabel('Tipografía').selectOption('DM Sans');await expect.poll(async()=>(await (await request.get(`/api/projects/${project.id}`)).json()).profile.font).toBe('DM Sans');
  await page.screenshot({path:'.data/verification/studio-advanced.png',fullPage:true});expect(errors).toEqual([]);
});

test('conexiones opcionales y laboratorio preparan casos sin gastar cuota',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'Conexiones',exact:true}).click();await expect(page.getByRole('heading',{name:'Proveedores y herramientas'})).toBeVisible();await page.getByRole('button',{name:'Guardar conexiones'}).click();await expect(page.getByText('Conexiones guardadas.')).toBeVisible();
  await page.getByRole('button',{name:'Laboratorio',exact:true}).click();await page.getByLabel('Motores del experimento',{exact:true}).selectOption('demo');await page.getByLabel('Duración del experimento',{exact:true}).selectOption('15');await page.getByLabel('Arquitecturas del experimento',{exact:true}).selectOption('single');await page.getByRole('button',{name:'Preparar comparación'}).click();
  await expect.poll(async()=>(await (await request.get('/api/experiments')).json()).length).toBe(1);const batch=(await (await request.get('/api/experiments')).json())[0];expect(batch.status).toBe('draft');expect(batch.cases).toHaveLength(1);expect((await (await request.get(`/api/projects/${batch.cases[0].projectId}`)).json()).metrics.calls).toBe(0);
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('timeline y aprobación por componentes conservan las ediciones parciales',async({page,request})=>{
  const projects=await (await request.get('/api/projects')).json(),project=projects.find(item=>!item.example&&item.storyboard&&item.tasks.some(task=>task.kind==='scene'&&task.output));expect(project).toBeTruthy();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await openVideo(page,project);await page.getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('button',{name:'Producción avanzada',exact:true}).click();await page.getByRole('button',{name:'Voz y subtítulos',exact:true}).click();
  await page.locator('.component-card').first().getByRole('button',{name:'Aprobar',exact:true}).click();await expect(page.locator('.component-card').first().getByRole('button',{name:'Aprobado',exact:true})).toBeDisabled();
  await page.getByLabel('Palabra 1',{exact:true}).fill('Texto');await expect.poll(async()=>(await (await request.get(`/api/projects/${project.id}`)).json()).captionOverrides?.[project.storyboard.scenes[0].id]?.[0]?.text).toBe('Texto');
  await page.getByRole('button',{name:'Timeline',exact:true}).click();const second=project.storyboard.scenes[1];await page.getByRole('button',{name:`Subir ${second.title}`,exact:true}).click();await page.getByLabel(`Duración de ${second.title}`,{exact:true}).fill('9');
  await expect.poll(async()=>(await (await request.get(`/api/projects/${project.id}`)).json()).storyboard.scenes[0].id).toBe(second.id);const saved=await (await request.get(`/api/projects/${project.id}`)).json();expect(saved.storyboard.scenes[0].duration).toBe(9);expect(saved.render).toBeNull();
  await page.screenshot({path:'.data/verification/timeline.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);expect(errors).toEqual([]);
});

test('la biblioteca compartida reutiliza fuentes entre proyectos',async({page,request,context})=>{
  await page.goto('/');await page.getByRole('button',{name:'Biblioteca',exact:true}).click();await expect(page.getByRole('heading',{name:'Conocimiento que conecta tus proyectos'})).toBeVisible();
  const sourceProject=await (await request.post('/api/projects',{data:{prompt:'Reutiliza una fuente de DHCP en distintos proyectos.',duration:15,runtime:'demo',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:false,sources:[{name:'Apuntes compartidos',content:'DHCP asigna automáticamente una dirección IP.'}]}})).json();await page.getByRole('button',{name:/Proyectos/}).first().click();await page.locator(`[data-project-id="${sourceProject.id}"]`).click();await page.getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('button',{name:'Producción avanzada',exact:true}).click();await page.getByRole('button',{name:'Biblioteca compartida',exact:true}).click();await page.getByRole('button',{name:'Apuntes compartidos',exact:true}).click();await expect(page.getByText('Guardado en la biblioteca compartida.')).toBeVisible();
  const target=await (await request.post('/api/projects',{data:{prompt:'Importar conocimientos desde la biblioteca compartida.',duration:15,runtime:'demo',architecture:'single',context:'minimal',style:'editorial',concurrency:1,desktop:false,sources:[]}})).json();await page.getByRole('button',{name:/Proyectos/}).first().click();await page.locator(`[data-project-id="${target.id}"]`).click();await page.getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('button',{name:'Producción avanzada',exact:true}).click();await page.getByRole('button',{name:'Biblioteca compartida',exact:true}).click();await page.getByRole('button',{name:'Usar en este proyecto',exact:true}).click();await expect.poll(async()=>(await (await request.get(`/api/projects/${target.id}`)).json()).sources.length).toBe(1);
});

test('el laboratorio prepara la matriz de duraciones y sesiones y exporta sin ejecutar',async({page,request})=>{
  await page.goto('/');await page.getByRole('button',{name:'Laboratorio',exact:true}).click();await page.getByLabel('Motores del experimento',{exact:true}).selectOption('demo');await page.getByLabel('Arquitecturas del experimento',{exact:true}).selectOption('single');await page.getByLabel('Comparar 1, 3, 5 y 10 minutos con sesiones nuevas y persistentes',{exact:true}).check();await page.getByRole('button',{name:'Preparar comparación'}).click();
  await expect.poll(async()=>(await (await request.get('/api/experiments')).json()).length).toBe(2);const batch=(await (await request.get('/api/experiments')).json()).find(item=>item.cases.length===8);expect(batch).toBeTruthy();expect(new Set(batch.cases.map(item=>item.spec.duration))).toEqual(new Set([60,180,300,600]));expect(batch.cases.every(item=>item.status==='pending')).toBe(true);await expect(page.getByRole('link',{name:'Exportar resultados'})).toHaveCount(2);
});
