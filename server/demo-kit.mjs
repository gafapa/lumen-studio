// Kit de demostración (modo demo, sin modelo): un rótulo inferior reutilizable y su vista previa.
import path from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {demoAuthor} from './scene-code.mjs';

const verified={lint:false,check:false,snapshotsReviewed:false};

export async function demoKit(dir,brief){
  await mkdir(path.join(dir,'components'),{recursive:true});
  if(brief.engine==='manim'){
    await writeFile(path.join(dir,'components','lower_third.py'),`from manim import *

def lower_third(text, accent="#65dacf", ink="#f5f8ff"):
    label = Text(text, font="Segoe UI", color=ink).scale(0.5)
    bar = Rectangle(width=label.width + 0.6, height=label.height + 0.4, fill_color="#1d2b45", fill_opacity=1, stroke_color=accent, stroke_width=3)
    group = VGroup(bar, label).to_corner(DL, buff=0.8)
    label.move_to(bar)
    return group
`);
    await writeFile(path.join(dir,'KIT.md'),'# Kit de demostración\n\n## lower_third(text, accent, ink)\nRótulo inferior. Uso: from kit.components.lower_third import lower_third; self.play(FadeIn(lower_third("Hola")))\n');
    await writeFile(path.join(dir,'scene.py'),`from manim import *
from components.lower_third import lower_third
from lumen.tokens import TOKENS

class LumenScene(Scene):
    def construct(self):
        self.camera.background_color = TOKENS["color"]["background"]
        self.play(FadeIn(lower_third("Rótulo inferior")), run_time=0.6)
        self.wait(${Math.max(0.1,brief.durationSeconds-0.6).toFixed(2)})
`);
    return {summary:'Kit de demostración con un rótulo inferior.',engine:'manim',components:[{name:'Rótulo inferior',file:'components/lower_third.py',description:'Rótulo inferior con borde de acento.',usage:'from kit.components.lower_third import lower_third'}],verified,notes:['Modo demo.']};
  }
  if(brief.engine==='revideo'){
    await writeFile(path.join(dir,'components','LowerThird.tsx'),`import {Rect, Txt} from '@revideo/2d';

export function LowerThird({text, accent = '#65dacf'}: {text: string; accent?: string}) {
  return <Rect fill={'#1d2b45'} stroke={accent} lineWidth={3} radius={14} padding={[14, 22]} x={-360} y={220} layout><Txt text={text} fill={'#f5f8ff'} fontFamily={'Segoe UI'} fontSize={32} /></Rect>;
}
`);
    await writeFile(path.join(dir,'KIT.md'),"# Kit de demostración\n\n## LowerThird\nRótulo inferior. Uso: import {LowerThird} from '../kit/components/LowerThird'; view.add(<LowerThird text={'Hola'} />)\n");
    await mkdir(path.join(dir,'src'),{recursive:true});
    await writeFile(path.join(dir,'src','scene.tsx'),`import {makeScene2D} from '@revideo/2d';
import {waitFor} from '@revideo/core';
import {LowerThird} from '../components/LowerThird';

export default makeScene2D('scene', function* (view) {
  view.add(<LowerThird text={'Rótulo inferior'} />);
  yield* waitFor(${brief.durationSeconds.toFixed(2)});
});
`);
    return {summary:'Kit de demostración con un rótulo inferior.',engine:'revideo',components:[{name:'Rótulo inferior',file:'components/LowerThird.tsx',description:'Rótulo inferior con borde de acento.',usage:"import {LowerThird} from '../kit/components/LowerThird'"}],verified,notes:['Modo demo.']};
  }
  if(brief.engine==='hyperframes'){
    await writeFile(path.join(dir,'components','kit.css'),`.kit-lower-third{position:absolute;left:6%;bottom:22%;padding:14px 22px;border-radius:14px;background:var(--card,#1d2b45);color:var(--ink,#f5f8ff);font-weight:700;font-size:32px;border-left:6px solid var(--accent,#65dacf)}
`);
    await writeFile(path.join(dir,'KIT.md'),`# Kit del proyecto

## Rótulo inferior
Incluye \`<link rel="stylesheet" href="kit/components/kit.css">\` y \`<div class="kit-lower-third" id="rotulo">Texto</div>\`; anímalo con GSAP (entrada desde la izquierda).
`);
    await demoAuthor(dir,brief);
    const html=(await readFile(path.join(dir,'index.html'),'utf8'))
      .replace('</head>','<link rel="stylesheet" href="components/kit.css">\n</head>')
      .replace('</h1>','</h1>\n  <div class="kit-lower-third" id="rotulo">Rótulo del proyecto</div>')
      .replace('window.__timelines',`tl.fromTo('#rotulo',{x:-40,opacity:0},{x:0,opacity:1,duration:0.6},1.5);\n  window.__timelines`);
    await writeFile(path.join(dir,'index.html'),html);
    return {summary:'Kit de demostración con un rótulo inferior.',engine:'hyperframes',components:[{name:'Rótulo inferior',file:'components/kit.css',description:'Rótulo con borde de acento.',usage:'<div class="kit-lower-third">Texto</div> con kit/components/kit.css'}],verified,notes:['Modo demo.']};
  }
  await writeFile(path.join(dir,'components','LowerThird.tsx'),`import React from 'react';
import {interpolate,useCurrentFrame} from 'remotion';

export function LowerThird({text,accent='#65dacf'}:{text:string;accent?:string}) {
  const frame=useCurrentFrame();
  const x=interpolate(frame,[0,15],[-40,0],{extrapolateRight:'clamp'});
  return <div style={{position:'absolute',left:'6%',bottom:'22%',padding:'14px 22px',borderRadius:14,background:'#1d2b45',color:'#f5f8ff',fontWeight:700,fontSize:32,borderLeft:\`6px solid \${accent}\`,transform:\`translateX(\${x}px)\`,fontFamily:'Inter'}}>{text}</div>;
}
`);
  await writeFile(path.join(dir,'KIT.md'),`# Kit del proyecto

## LowerThird
\`import {LowerThird} from './kit/components/LowerThird';\` y \`<LowerThird text="Texto"/>\` dentro de una \`<Sequence>\`.
`);
  await writeFile(path.join(dir,'Scene.tsx'),`import React from 'react';
import {AbsoluteFill,Sequence} from 'remotion';
import {LowerThird} from './components/LowerThird';

export default function Scene() {
  return <AbsoluteFill style={{background:'#111b31'}}><Sequence from={30}><LowerThird text="Rótulo del proyecto"/></Sequence></AbsoluteFill>;
}
`);
  return {summary:'Kit de demostración con un rótulo inferior.',engine:'remotion',components:[{name:'LowerThird',file:'components/LowerThird.tsx',description:'Rótulo inferior animado.',usage:"import {LowerThird} from './kit/components/LowerThird'"}],verified,notes:['Modo demo.']};
}
