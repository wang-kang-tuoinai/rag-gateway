import {chartFrame,clipPlot,drawSelection,emptyText,fullTime} from './visual-chart.mjs';
export const traceColors={ok:'#258c86',degraded:'#d39125',failed:'#db575c'};
export const traceLabels={ok:'OK · 未见有效错误',degraded:'Degraded · 后代错误',failed:'Failed · 入口失败'};
export function drawTraceChart(canvas,{window,data,selection}) {
  const points=(data?.points||[]).filter(p=>p.start_ms>=window.start_ms&&p.start_ms<=window.end_ms);
  let max=1;for(const p of points)max=Math.max(max,p.duration_ms);
  const f=chartFrame(canvas,window,max*1.12,'ms'),{ctx}=f;
  clipPlot(f,()=>{for(const p of points){ctx.fillStyle=traceColors[p.status]||'#777';ctx.globalAlpha=.65;ctx.beginPath();ctx.arc(f.x(p.start_ms),f.y(p.duration_ms),3.5,0,Math.PI*2);ctx.fill();}});
  if(!points.length)emptyText(f,data?.initialized?'没有匹配的入口样本；不代表服务正常':'等待入口样本');
  drawSelection(f,selection);
  return {...f,hit(x,y){let found=null,distance=64;for(const p of points){const d=(f.x(p.start_ms)-x)**2+(f.y(p.duration_ms)-y)**2;if(d<distance){found=p;distance=d;}}
    return found?`${found.service} · ${found.operation}\n${fullTime(found.start_ms)} · ${found.duration_ms.toFixed(2)} ms · ${found.status}${found.incomplete?' · 链路不完整':''}\ntrace_id: ${found.trace_id}\nentry_span_id: ${found.entry_span_id}`:null;}};
}
