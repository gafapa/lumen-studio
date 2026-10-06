export function captionsFromWords(words,duration,narration){
  if(Array.isArray(words)&&words.length)return words.map((word,index)=>({text:Number.isInteger(word.position)?narration.slice(word.position,words[index+1]?.position??narration.length).trim():String(word.text),start:Math.max(0,Number(word.start)||0),end:Math.min(duration,Number(word.end)||Number(words[index+1]?.start)||duration)})).filter(word=>word.end>=word.start);
  const list=narration.trim().split(/\s+/);return list.map((text,index)=>({text,start:index*duration/list.length,end:(index+1)*duration/list.length}));
}
export function captionGroups(words,max=8){const groups=[];for(let index=0;index<words.length;index+=max){const group=words.slice(index,index+max);groups.push({text:group.map(word=>word.text).join(' '),start:group[0].start,end:group.at(-1).end});}return groups;}
export function srt(captions){const time=seconds=>{const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};return captions.map((caption,index)=>`${index+1}\n${time(caption.start)} --> ${time(caption.end)}\n${caption.text}\n`).join('\n');}
// Alinea el texto del guion con los tiempos de una transcripción (Levenshtein por palabras):
// conserva la ortografía del guion y toma los tiempos reconocidos; las palabras sin pareja se interpolan.
export function alignToScript(narration,words){
  const script=narration.trim().split(/\s+/).filter(Boolean);if(!script.length||!words?.length)return [];
  const norm=value=>String(value).toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^\p{L}\p{N}]/gu,'');
  const a=script.map(norm),b=words.map(word=>norm(word.text)),n=a.length,m=b.length;
  const cost=Array.from({length:n+1},(_,i)=>{const row=new Uint32Array(m+1);row[0]=i;return row;});for(let j=0;j<=m;j++)cost[0][j]=j;
  for(let i=1;i<=n;i++)for(let j=1;j<=m;j++)cost[i][j]=Math.min(cost[i-1][j]+1,cost[i][j-1]+1,cost[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  const timing=new Array(n).fill(null);let i=n,j=m;
  while(i>0&&j>0){if(cost[i][j]===cost[i-1][j-1]+(a[i-1]===b[j-1]?0:1)){timing[i-1]={start:words[j-1].start,end:words[j-1].end};i--;j--;}else if(cost[i][j]===cost[i-1][j]+1)i--;else j--;}
  for(let k=0;k<n;k++)if(!timing[k]){const previous=timing.slice(0,k).reverse().find(Boolean),next=timing.slice(k+1).find(Boolean);const start=previous?.end??0,end=next?.start??previous?.end??words.at(-1).end;let run=k;while(run<n&&!timing[run])run++;const span=(end-start)/(run-k);for(let x=k;x<run;x++)timing[x]={start:start+span*(x-k),end:start+span*(x-k+1)};}
  return script.map((text,index)=>({text,start:Math.round(timing[index].start*1000)/1000,end:Math.round(Math.max(timing[index].start,timing[index].end)*1000)/1000}));
}
