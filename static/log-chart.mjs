import {chartFrame,clipPlot,drawSelection,emptyText,fullTime} from './visual-chart.mjs';
export const logColors={DEBUG:'#aab6ad',INFO:'#66a49d',WARN:'#d39125',ERROR:'#db575c',OTHER:'#8b82ab'};
export function displayLevels(counts={}) {
  const result={DEBUG:0,INFO:0,WARN:0,ERROR:0,OTHER:0};
  for(const [level,count] of Object.entries(counts))result[Object.hasOwn(result,level)?level:'OTHER']+=count;
  return result;
}
export function drawLogChart(canvas,{window,data,selection,hidden}) {
  const buckets=(data?.buckets||[]).filter(b=>b.end_ms>window.start_ms&&b.start_ms<window.end_ms);
  const count=b=>Object.entries(displayLevels(b.by_level)).reduce((sum,[level,n])=>sum+(hidden.has(level)?0:n),0);
  let max=1;for(const b of buckets)max=Math.max(max,count(b));
  const f=chartFrame(canvas,window,max*1.12,'条'),{ctx}=f;
  clipPlot(f,()=>{
    const coverage=data?.data_window;
    ctx.fillStyle='#eef0ed';
    if(!coverage)ctx.fillRect(64,18,f.width-84,f.height-54);
    else {
      ctx.fillRect(64,18,Math.max(0,f.x(coverage.start_ms)-64),f.height-54);
      const right=Math.max(64,f.x(coverage.end_ms));ctx.fillRect(right,18,Math.max(0,f.width-20-right),f.height-54);
    }
    for(const b of buckets){let sum=0;for(const [level,n] of Object.entries(displayLevels(b.by_level))){if(hidden.has(level))continue;
      ctx.fillStyle=logColors[level];ctx.fillRect(f.x(b.start_ms)+.5,f.y(sum+n),Math.max(1,f.x(b.end_ms)-f.x(b.start_ms)-1),f.y(sum)-f.y(sum+n));sum+=n;}}
  });
  if(!data?.initialized)emptyText(f,'等待日志聚合数据');
  else if(data.summary?.total===0)emptyText(f,'已查询窗口内没有日志；不代表服务正常');
  else if(Object.keys(logColors).every(level=>hidden.has(level)))emptyText(f,'所有级别已隐藏，可点击图例恢复');
  drawSelection(f,selection);
  return {...f,hit(x){const b=buckets.find(b=>x>=f.x(b.start_ms)&&x<f.x(b.end_ms));if(!b)return '此处尚无已查询的日志桶';
    const clipped=b.start_ms<window.start_ms||b.end_ms>window.end_ms;
    return `${fullTime(b.start_ms)} → ${fullTime(b.end_ms)}\n${Object.entries(b.by_level).map(([k,n])=>`${k}: ${n}`).join(' · ')}\n总计 ${b.total} 条${b.end_ms-b.start_ms<10000?' · 不足 10 秒的边界桶':''}${clipped?'\n图中仅显示部分宽度，计数属于上述完整桶范围':''}`;}};
}
