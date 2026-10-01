import {selectionSeconds, updateTraceDraft, pointCoordinates, timeAtX, localInput, LatestRequest} from './trace-core.mjs';

const colors={ok:'#258c86',degraded:'#d39125',failed:'#db575c'};
const labels={ok:'OK · 未见有效错误',degraded:'Degraded · 后代错误',failed:'Failed · 入口失败'};
const fullTime=ms=>new Date(ms).toLocaleString('zh-CN',{hour12:false});
export function initTracePanel({writeDraft}) {
  const $=id=>document.getElementById(id), panel=$('trace-panel'), canvas=$('trace-canvas'), ctx=canvas.getContext('2d');
  let opened=false, data=null, timer=null, selected=null, drag=null, hover=null, dimensions={width:800,height:300}, directoryLoaded=false;
  const request=new LatestRequest();
  const message=text=>{$('trace-state').textContent=text;};
  const mode=()=>$('trace-mode').value;
  function plot() {
    if(!opened)return;
    const width=Math.max(280,canvas.getBoundingClientRect().width),height=300,dpr=window.devicePixelRatio||1;
    canvas.width=Math.round(width*dpr); canvas.height=height*dpr; dimensions={width,height}; ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,width,height);
    const win=data?.window; if(!win)return;
    const points=data.points||[],maxDuration=Math.max(1,...points.map(p=>p.duration_ms))*1.12;
    ctx.font='11px Segoe UI, Microsoft YaHei'; ctx.lineWidth=1;
    for(let i=0;i<=4;i++) {
      const y=height-36-(height-56)*i/4; ctx.strokeStyle='#e7ece8'; ctx.beginPath();ctx.moveTo(64,y);ctx.lineTo(width-20,y);ctx.stroke();ctx.fillStyle='#738078';ctx.textAlign='right';ctx.fillText(`${Math.round(maxDuration*i/4)} ms`,57,y+4);
      const x=64+(width-84)*i/4,ms=win.start_ms+(win.end_ms-win.start_ms)*i/4; ctx.textAlign=i===0?'left':i===4?'right':'center'; ctx.fillText(new Date(ms).toLocaleTimeString('zh-CN',{hour12:false}),x,height-12);
    }
    for(const p of points) { const pos=pointCoordinates(p,win,width,height,maxDuration);ctx.fillStyle=colors[p.status]||'#777';ctx.globalAlpha=.65;ctx.beginPath();ctx.arc(pos.x,pos.y,3.5,0,Math.PI*2);ctx.fill(); }
    ctx.globalAlpha=1;
    if(selected){const a=pointCoordinates({start_ms:selected.start*1000,duration_ms:0},win,width,height,maxDuration).x,b=pointCoordinates({start_ms:selected.end*1000,duration_ms:0},win,width,height,maxDuration).x;
      const left=Math.max(64,a),right=Math.min(width-20,b);if(right>left){ctx.fillStyle='#28644920';ctx.fillRect(left,18,right-left,height-54);ctx.strokeStyle='#286449';ctx.strokeRect(left,18,right-left,height-54);} }
    if(hover){const p=pointCoordinates(hover,win,width,height,maxDuration);ctx.strokeStyle='#21342f';ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.stroke();}
    if(!points.length){ctx.textAlign='center';ctx.fillStyle='#758079';ctx.fillText(data.initialized?'没有匹配的入口样本；不代表服务正常':'正在从 Jaeger 加载入口样本…',width/2,height/2);}
    canvas._maxDuration=maxDuration;
  }
  function render() {
    const loading=data.loading? ' · 后台查询中':'';
    message(`${data.initialized?'已缓存入口样本':'首次加载'}${loading}${data.stale?' · 数据待更新':''}${data.partial?' · 数据不完整':''}${data.error?' · '+data.error:''}`);
    $('trace-state').dataset.warning=String(!!(data.partial||data.error||data.stale));
    $('trace-count').textContent=`${data.points.length.toLocaleString()} 次入口调用`;
    $('trace-legend').replaceChildren(...Object.entries(labels).map(([status,label])=>{const item=document.createElement('span');item.textContent=`${label}  ${data.by_status[status]||0}`;item.style.setProperty('--status-color',colors[status]);return item;}));
    $('trace-updated').textContent=data.updated_at_ms?`更新于 ${fullTime(data.updated_at_ms)} · 本轮查询截止 ${fullTime(data.data_as_of_ms)}`:'等待首次查询完成';
    $('trace-notices').textContent=(data.notices||[]).join('\n'); $('trace-notices').hidden=!data.notices?.length;
    const current=$('trace-operation').value,ops=new Set(data.operations); if(current)ops.add(current);
    $('trace-operation').replaceChildren(new Option('全部接口',''),...[...ops].map(op=>new Option(op,op)));$('trace-operation').value=current;
    $('trace-query-details').textContent=JSON.stringify(data.operation_queries,null,2);
    plot();
  }
  async function load() {
    clearTimeout(timer); if(!opened||document.hidden)return;
    const params=new URLSearchParams({service:$('trace-service').value.trim(),operation:$('trace-operation').value});
    if(!params.get('service')){message('请填写或选择服务');return;}
    if(mode()==='history'){
      const start=new Date($('trace-start').value).getTime(),end=new Date($('trace-end').value).getTime();
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>900000){message('请选择不超过 15 分钟的有效历史范围');return;}
      params.set('start_ms',start);params.set('end_ms',end);
    }
    const generation=request.generation+1;
    try {
      const next=await request.run(`/api/v1/visual/traces?${params}`);
      if(!next||!opened)return; data=next; render();
    } catch(error){if(error.name!=='AbortError'&&generation===request.generation){message(`查询失败：${error.message}${data?'；图中保留上次样本':''}`);$('trace-state').dataset.warning='true';}}
    finally {if(opened&&generation===request.generation)timer=setTimeout(load,data?.loading?2000:15000);}
  }
  function clearData(){clearTimeout(timer);request.cancel();data=null;selected=null;hover=null;drag=null;$('trace-tooltip').hidden=true;$('trace-selection').textContent='拖动图表框选时间，或在下方输入范围。';$('trace-select-start').value='';$('trace-select-end').value='';$('trace-draft-notice').textContent='';$('trace-count').textContent='—';$('trace-legend').replaceChildren();$('trace-updated').textContent='';$('trace-notices').hidden=true;$('trace-query-details').textContent='';message('正在加载…');plot();}
  async function services(){
    if(directoryLoaded)return;directoryLoaded=true;
    try{const res=await fetch('/api/v1/visual/services',{signal:AbortSignal.timeout(10000)});const body=await res.json();if(!res.ok)throw new Error(body.error);$('trace-services').replaceChildren(...body.services.map(name=>new Option(name,name)));$('trace-directory-notice').textContent='';if(!$('trace-service').value)$('trace-service').value=body.default_service||body.services[0]||'ops-agent-backend';}
    catch(error){directoryLoaded=false;$('trace-directory-notice').textContent=`服务目录暂不可用，可手动输入服务名：${error.message}`;}
  }
  function setOpen(value){opened=value;panel.hidden=!value;$('chat-content').hidden=value;$('trace-toggle').textContent=value?'返回对话':'Trace 面板';$('trace-toggle').setAttribute('aria-expanded',String(value));
    if(value){if(!$('trace-service').value){message('正在读取服务目录…');void services().finally(()=>{if(!$('trace-service').value)$('trace-service').value='ops-agent-backend';if(opened)void load();});}else{void services();void load();}}else{clearTimeout(timer);request.cancel();}}
  $('trace-toggle').onclick=()=>setOpen(!opened);
  $('trace-filter').onsubmit=event=>{event.preventDefault();if(mode()==='history'||data?.service!==$('trace-service').value.trim()||data?.operation!==$('trace-operation').value)clearData();void load();};
  $('trace-operation').onchange=()=>{clearData();void load();};
  $('trace-mode').onchange=()=>{$('trace-history').hidden=mode()!=='history';clearData();void load();};
  $('trace-service').onchange=()=>{$('trace-operation').replaceChildren(new Option('全部接口',''));clearData();void load();};
  $('trace-service').oninput=()=>{$('trace-operation').replaceChildren(new Option('全部接口',''));clearData();message('服务已更改，请点击刷新加载。');};
  function applySelection(){
    if(!selected)return;
    const range={...selected,service:data?.service||$('trace-service').value.trim(),operation:data?.operation||''};
    $('trace-selection').textContent=`${fullTime(range.start*1000)} → ${fullTime(range.end*1000)}（${Intl.DateTimeFormat().resolvedOptions().timeZone}） · start=${range.start}, end=${range.end}`;
    $('trace-select-start').value=localInput(range.start*1000);$('trace-select-end').value=localInput(range.end*1000);
    const result=writeDraft(draft=>updateTraceDraft(draft,range));
    $('trace-draft-notice').textContent=result?'已更新下方诊断草稿，尚未发送。':'当前会话正在执行或待确认，范围已保留，稍后点击「填入诊断范围」。';plot();
  }
  const position=event=>{const rect=canvas.getBoundingClientRect();return{x:event.clientX-rect.left,y:event.clientY-rect.top};};
  canvas.onpointerdown=event=>{if(!data||event.button!==0)return;const pos=position(event);if(pos.x<64||pos.x>dimensions.width-20||pos.y<18||pos.y>dimensions.height-36)return;drag={x:pos.x,window:{...data.window},width:dimensions.width};canvas.setPointerCapture(event.pointerId);};
  canvas.onpointermove=event=>{
    if(!data)return;const pos=position(event);
    if(drag){selected=selectionSeconds(timeAtX(drag.x,drag.window,drag.width),timeAtX(pos.x,drag.window,drag.width));plot();return;}
    hover=null;let distance=64;
    for(const p of data.points){const at=pointCoordinates(p,data.window,dimensions.width,dimensions.height,canvas._maxDuration);const d=(at.x-pos.x)**2+(at.y-pos.y)**2;if(d<distance){hover=p;distance=d;}}
    const tip=$('trace-tooltip');tip.hidden=!hover;
    if(hover)tip.textContent=`${hover.service} · ${hover.operation}\n${fullTime(hover.start_ms)} · ${hover.duration_ms.toFixed(2)} ms · ${hover.status}${hover.incomplete?' · 链路不完整':''}\ntrace_id: ${hover.trace_id}\nentry_span_id: ${hover.entry_span_id}`;
    plot();
  };
  canvas.onpointerup=event=>{if(!drag)return;const moved=Math.abs(position(event).x-drag.x);drag=null;if(moved>=4)applySelection();};
  canvas.onpointercancel=()=>{drag=null;};canvas.onpointerleave=()=>{if(!drag){hover=null;$('trace-tooltip').hidden=true;plot();}};
  $('trace-apply-selection').onclick=()=>{const a=new Date($('trace-select-start').value).getTime(),b=new Date($('trace-select-end').value).getTime();if(!data||!Number.isFinite(a)||!Number.isFinite(b)||a>=b||a<Math.floor(data.window.start_ms/1000)*1000||b>Math.ceil(data.window.end_ms/1000)*1000){$('trace-draft-notice').textContent='选区必须位于当前图表窗口内，且开始早于结束。';return;}selected=selectionSeconds(a,b);applySelection();};
  $('trace-select-all').onclick=()=>{if(!data)return;selected=selectionSeconds(data.window.start_ms,data.window.end_ms);applySelection();};
  $('trace-clear-selection').onclick=()=>{if(!writeDraft(draft=>updateTraceDraft(draft,null))){$('trace-draft-notice').textContent='当前会话暂不能编辑草稿。';return;}selected=null;$('trace-selection').textContent='选区已清除';$('trace-draft-notice').textContent='';plot();};
  new ResizeObserver(plot).observe(canvas);
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearTimeout(timer);request.cancel();}else if(opened)void load();});
  const now=Date.now();$('trace-start').value=localInput(now-900000);$('trace-end').value=localInput(now);
  return {hide:()=>setOpen(false),isOpen:()=>opened};
}
