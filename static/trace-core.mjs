export function selectionSeconds(a, b) {
  const start = Math.floor(Math.min(a,b)/1000), end = Math.ceil(Math.max(a,b)/1000);
  return {start, end: Math.max(start+1,end)};
}
const blockPattern = /\[Trace 诊断范围\][\s\S]*?\[\/Trace 诊断范围\]/g;
export function updateTraceDraft(draft, selection) {
  const text = selection ? `[Trace 诊断范围]\n服务：${selection.service}\n${selection.operation ? `Trace 接口：${selection.operation}\n` : ''}start=${selection.start}，end=${selection.end}（Unix 秒）\n请结合日志与链路分析该范围的异常表现、影响及可能原因。\n[/Trace 诊断范围]` : '';
  if (blockPattern.test(draft)) { blockPattern.lastIndex=0; let replaced=false; return draft.replace(blockPattern,()=>{ if(replaced)return ''; replaced=true; return text; }); }
  blockPattern.lastIndex=0;
  return text ? `${draft}${draft ? '\n\n' : ''}${text}` : draft;
}
export function pointCoordinates(point, window, width, height, maxDuration) {
  return {x:64+(point.start_ms-window.start_ms)/(window.end_ms-window.start_ms)*(width-84),
    y:height-36-point.duration_ms/maxDuration*(height-56)};
}
export function timeAtX(x, window, width) {
  return window.start_ms+Math.max(0,Math.min(1,(x-64)/(width-84)))*(window.end_ms-window.start_ms);
}
export function localInput(ms) {
  const date=new Date(ms); return new Date(ms-date.getTimezoneOffset()*60000).toISOString().slice(0,19);
}

// Abort is advisory: generation guards also discard late responses after filters change.
export class LatestRequest {
  generation=0; controller=null;
  cancel(){ this.generation++; this.controller?.abort(); }
  async run(url,fetcher=fetch){
    this.cancel(); const generation=this.generation, controller=new AbortController(); this.controller=controller;
    const response=await fetcher(url,{signal:controller.signal}); const data=await response.json();
    if(generation!==this.generation)return null;
    if(!response.ok)throw new Error(data.error||`HTTP ${response.status}`);
    return data;
  }
}
