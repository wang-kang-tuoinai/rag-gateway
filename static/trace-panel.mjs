import {selectionSeconds,updateTraceDraft,timeAtX,localInput,LatestRequest,operationToLogFilter} from './trace-core.mjs';
import {drawTraceChart,traceColors,traceLabels} from './trace-chart.mjs';
import {drawLogChart,logColors,displayLevels} from './log-chart.mjs';
import {fullTime} from './visual-chart.mjs';

export function initTracePanel({writeDraft}) {
  const $=id=>document.getElementById(id),panel=$('trace-panel');
  const canvases={trace:$('trace-canvas'),log:$('log-canvas')};
  const requests={trace:new LatestRequest(),log:new LatestRequest()};
  let opened=false,timer=null,epoch=0,selected=null,drag=null,displayWindow=null,pendingWindow=null;
  let data={trace:null,log:null},frames={},errors={trace:'',log:''},lastKey='',directoryLoaded=false;
  const hiddenLevels=new Set();
  const serviceValue=()=>$('trace-service').value==='__manual__'?$('trace-service-manual').value.trim():$('trace-service').value;
  const mode=()=>$('trace-mode').value;
  const showManualService=()=>{$('trace-service-manual-wrap').hidden=$('trace-service').value!=='__manual__';};
  function plot(){
    if(!opened)return;
    if(!displayWindow){for(const canvas of Object.values(canvases))canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);frames={};return;}
    frames.trace=drawTraceChart(canvases.trace,{window:displayWindow,data:data.trace,selection:selected});
    frames.log=drawLogChart(canvases.log,{window:displayWindow,data:data.log,selection:selected,hidden:hiddenLevels});
  }
  function status(kind){
    const d=data[kind],message=errors[kind]||(d?.error||'');
    const text=message?`${message}${d?.initialized?'；保留上次成功数据':''}`:!d?'等待查询':!d.initialized?'首次加载中…':`${kind==='trace'?'已缓存入口样本':'已缓存日志聚合'}${d.loading?' · 后台查询中':''}${d.stale?' · 数据待更新':''}${d.partial?' · 数据不完整':''}`;
    $(`${kind}-state`).textContent=text;$(`${kind}-state`).dataset.warning=String(!!(message||d?.stale||d?.partial));
  }
  function render(){
    status('trace');status('log');
    const t=data.trace,l=data.log;
    $('trace-count').textContent=t?`${t.points.length.toLocaleString()} 次入口调用`:'—';
    $('trace-legend').replaceChildren(...Object.entries(traceLabels).map(([state,label])=>{const item=document.createElement('span');item.textContent=`${label}  ${t?.initialized?(t.by_status[state]||0):'—'}`;item.style.setProperty('--status-color',traceColors[state]);return item;}));
    $('trace-updated').textContent=t?.updated_at_ms?`更新于 ${fullTime(t.updated_at_ms)} · 查询截止 ${fullTime(t.data_as_of_ms)}`:'';
    $('trace-notices').textContent=(t?.notices||[]).join('\n');$('trace-notices').hidden=!t?.notices?.length;
    $('trace-query-details').textContent=t?JSON.stringify(t.operation_queries,null,2):'';
    const levels=displayLevels(l?.summary?.by_level);
    $('log-count').textContent=l?.summary?`已查询窗口共 ${l.summary.total.toLocaleString()} 条日志`:'—';
    $('log-legend').replaceChildren(...Object.entries(logColors).map(([level,color])=>{const button=document.createElement('button');button.type='button';button.textContent=`${level==='OTHER'?'其他':level}  ${l?.initialized?levels[level]:'—'}`;button.style.setProperty('--status-color',color);button.setAttribute('aria-pressed',String(!hiddenLevels.has(level)));button.onclick=()=>{hiddenLevels.has(level)?hiddenLevels.delete(level):hiddenLevels.add(level);render();};return button;}));
    $('log-updated').textContent=l?.data_window?`已查询 ${fullTime(l.data_window.start_ms)} → ${fullTime(l.data_window.end_ms)} · 更新于 ${fullTime(l.updated_at_ms)}`:'';
    $('log-notices').textContent=(l?.notices||[]).join('\n');$('log-notices').hidden=!l?.notices?.length;
    plot();
  }
  function cancel(){epoch++;clearTimeout(timer);for(const r of Object.values(requests))r.cancel();}
  function clearData(){
    cancel();data={trace:null,log:null};errors={trace:'',log:''};selected=null;drag=null;pendingWindow=null;displayWindow=null;lastKey='';
    for(const kind of ['trace','log'])$(`${kind}-tooltip`).hidden=true;
    $('trace-selection').textContent='在任意图表拖动框选时间，或在下方输入范围。';$('trace-select-start').value='';$('trace-select-end').value='';$('trace-draft-notice').textContent='';render();
  }
  function filters(){
    const service=serviceValue(),operation=$('trace-operation').value;
    if(!service)throw new Error('请填写或选择服务');
    const now=Date.now();let window={start_ms:now-900000,end_ms:now};
    if(mode()==='history'){
      const start=new Date($('trace-start').value).getTime(),end=new Date($('trace-end').value).getTime();
      if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end||end-start>900000||end>now+5000)throw new Error('请选择不超过 15 分钟、且不在未来的有效历史范围');
      window={start_ms:start,end_ms:end};
    }
    return {service,operation,window,key:JSON.stringify([service,operation,mode(),mode()==='history'?window:null])};
  }
  async function load(){
    clearTimeout(timer);if(!opened||document.hidden)return;
    let f;try{f=filters();}catch(e){errors={trace:e.message,log:e.message};render();return;}
    if(lastKey&&lastKey!==f.key)clearData();lastKey=f.key;
    if(drag)pendingWindow=f.window;else displayWindow=f.window;
    const generation=++epoch,logFilter=operationToLogFilter(f.operation);
    const common={service:f.service};if(mode()==='history')Object.assign(common,f.window);
    if(!logFilter){requests.log.cancel();data.log=null;errors.log='该非 HTTP operation 暂不支持日志联动';}
    plot();
    const fetchChart=async(kind,params)=>{
      try{
        const next=await requests[kind].run(`/api/v1/visual/${kind==='trace'?'traces':'logs'}?${new URLSearchParams(params)}`);
        if(!next||generation!==epoch||!opened)return;
        data[kind]=next;errors[kind]='';
        if(kind==='trace'){
          const current=$('trace-operation').value,ops=new Set(next.operations||[]);if(current)ops.add(current);
          $('trace-operation').replaceChildren(new Option('全部接口',''),...[...ops].map(op=>new Option(op,op)));$('trace-operation').value=current;
        }
        render();
      }catch(e){if(generation===epoch&&opened&&e.name!=='AbortError'){errors[kind]=`查询失败：${e.message}`;render();}}
    };
    await Promise.allSettled([fetchChart('trace',{...common,operation:f.operation}),...(logFilter?[fetchChart('log',{...common,...(logFilter.method?logFilter:{})})]:[])]);
    if(opened&&generation===epoch&&!document.hidden){const waiting=['trace',...(logFilter?['log']:[])].some(k=>data[k]&&!data[k].initialized&&data[k].loading&&!data[k].error);timer=setTimeout(load,waiting?2000:15000);}
  }
  async function services(){
    if(directoryLoaded)return;directoryLoaded=true;
    try{
      const res=await fetch('/api/v1/visual/services',{signal:AbortSignal.timeout(10000)}),body=await res.json();if(!res.ok)throw new Error(body.error||`HTTP ${res.status}`);
      const names=Array.isArray(body.services)?body.services:[],select=$('trace-service'),current=select.value;
      select.replaceChildren(...names.map(name=>new Option(name,name)),new Option('手动输入服务名…','__manual__'));
      select.value=current==='__manual__'||!names.length?'__manual__':names.includes(current)?current:names.includes(body.default_service)?body.default_service:names[0];
      if(!names.length&&!$('trace-service-manual').value)$('trace-service-manual').value=body.default_service||'ops-agent-backend';
      $('trace-directory-notice').textContent=names.length?'':'服务目录为空，可手动输入服务名。';
    }catch(e){directoryLoaded=false;$('trace-service').replaceChildren(new Option('手动输入服务名…','__manual__'));if(!$('trace-service-manual').value)$('trace-service-manual').value='ops-agent-backend';$('trace-directory-notice').textContent=`服务目录不可用，可手动输入：${e.message}`;}
    showManualService();
  }
  function setOpen(value){
    opened=value;panel.hidden=!value;$('chat-content').hidden=value;$('trace-toggle').textContent=value?'返回对话':'观测面板';$('trace-toggle').setAttribute('aria-expanded',String(value));
    if(value){if(!directoryLoaded){void services().finally(()=>{if(opened)void load();});}else void load();}else{cancel();drag=null;pendingWindow=null;}
  }
  function applySelection(){
    if(!selected)return;
    const range={...selected,service:serviceValue(),operation:$('trace-operation').value};
    $('trace-selection').textContent=`${fullTime(range.start*1000)} → ${fullTime(range.end*1000)}（${Intl.DateTimeFormat().resolvedOptions().timeZone}） · start=${range.start}, end=${range.end}`;
    $('trace-select-start').value=localInput(range.start*1000);$('trace-select-end').value=localInput(range.end*1000);
    const ok=writeDraft(draft=>updateTraceDraft(draft,range));$('trace-draft-notice').textContent=ok?'已更新下方诊断草稿，尚未发送。':'当前会话暂不能编辑草稿，选区已保留，稍后点击「填入诊断范围」。';plot();
  }
  for(const [kind,canvas] of Object.entries(canvases)){
    const position=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
    const finish=()=>{drag=null;if(pendingWindow){displayWindow=pendingWindow;pendingWindow=null;}plot();};
    canvas.onpointerdown=e=>{const frame=frames[kind];if(!displayWindow||!frame||e.button!==0)return;const p=position(e);if(p.x<64||p.x>frame.width-20||p.y<18||p.y>frame.height-36)return;drag={kind,x:p.x,window:{...displayWindow},width:frame.width,previous:selected};canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{const frame=frames[kind];if(!frame)return;const p=position(e);if(drag?.kind===kind){selected=selectionSeconds(timeAtX(drag.x,drag.window,drag.width),timeAtX(p.x,drag.window,drag.width));plot();return;}
      const text=p.x>=64&&p.x<=frame.width-20&&p.y>=18&&p.y<=frame.height-36?frame.hit(p.x,p.y):null;const tip=$(`${kind}-tooltip`);tip.hidden=!text;if(text)tip.textContent=text;};
    canvas.onpointerup=e=>{if(drag?.kind!==kind)return;const moved=Math.abs(position(e).x-drag.x);if(moved<4)selected=drag.previous;else selected=selectionSeconds(timeAtX(drag.x,drag.window,drag.width),timeAtX(position(e).x,drag.window,drag.width));finish();if(moved>=4)applySelection();};
    canvas.onpointercancel=()=>{if(drag?.kind===kind){selected=drag.previous;finish();}};
    canvas.onpointerleave=()=>{$(`${kind}-tooltip`).hidden=true;};new ResizeObserver(plot).observe(canvas);
  }
  $('trace-toggle').onclick=()=>setOpen(!opened);
  $('trace-filter').onsubmit=e=>{e.preventDefault();void load();};
  $('trace-operation').onchange=()=>{clearData();void load();};
  $('trace-mode').onchange=()=>{$('trace-history').hidden=mode()!=='history';clearData();void load();};
  $('trace-service').onchange=()=>{showManualService();$('trace-operation').replaceChildren(new Option('全部接口',''));clearData();if(serviceValue())void load();else $('trace-service-manual').focus();};
  $('trace-service-manual').oninput=()=>{$('trace-operation').replaceChildren(new Option('全部接口',''));clearData();};
  for(const id of ['trace-start','trace-end'])$(id).oninput=()=>clearData();
  $('trace-apply-selection').onclick=()=>{const a=new Date($('trace-select-start').value).getTime(),b=new Date($('trace-select-end').value).getTime();if(!displayWindow||!Number.isFinite(a)||!Number.isFinite(b)||a>=b||a<Math.floor(displayWindow.start_ms/1000)*1000||b>Math.ceil(displayWindow.end_ms/1000)*1000){$('trace-draft-notice').textContent='选区必须位于当前图表窗口内，且开始早于结束。';return;}selected=selectionSeconds(a,b);applySelection();};
  $('trace-select-all').onclick=()=>{if(displayWindow){selected=selectionSeconds(displayWindow.start_ms,displayWindow.end_ms);applySelection();}};
  $('trace-clear-selection').onclick=()=>{if(!writeDraft(draft=>updateTraceDraft(draft,null))){$('trace-draft-notice').textContent='当前会话暂不能编辑草稿。';return;}selected=null;$('trace-selection').textContent='选区已清除';$('trace-select-start').value='';$('trace-select-end').value='';$('trace-draft-notice').textContent='';plot();};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();if(drag)selected=drag.previous;drag=null;pendingWindow=null;}else if(opened)void load();});
  const now=Date.now();$('trace-start').value=localInput(now-900000);$('trace-end').value=localInput(now);
  return {hide:()=>setOpen(false),isOpen:()=>opened};
}
