// 手动前端验收用的内存后端；不调用真实 Agent，不写入数据库。
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const root = fileURLToPath(new URL('../static/', import.meta.url));
const conversations = new Map(), requests = new Map(); let seq = 0;
const fixture = {conversation_id: '11111111-1111-4111-8111-111111111111', title: 'Redis 超时窗口排查', created_at: Date.now(), updated_at: Date.now(), runs: []}; conversations.set(fixture.conversation_id, fixture);
function json(res, status, body) { res.writeHead(status, {'Content-Type': 'application/json'}); res.end(JSON.stringify(body)); }
function makeRun(c, question) { const r = {seq: ++seq, run_id: randomUUID(), conversation_id: c.conversation_id, question, status: 'running', events: [], error: null, created_at: Date.now(), updated_at: Date.now(), finished_at: null}; c.runs.push(r); return r; }
for (let i = 1; i <= 23; i++) {
  const r = makeRun(fixture, `历史诊断 ${i}：检查 Redis 依赖状态`); r.status = 'completed'; r.finished_at = Date.now();
  r.events = [{type: 'content', run_id: r.run_id, conversation_id: fixture.conversation_id, seq: 1, data: {message_id: 'm', delta: `第 ${i} 轮：这是用于验证历史分页的记录。`}}];
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!url.pathname.startsWith('/api/')) {
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/static\//, '');
      const full = path.resolve(root, relative);
      if (!full.startsWith(root)) return json(res, 404, {});
      const content = await readFile(full);
      res.writeHead(200, {'Content-Type': ({'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript'})[path.extname(full)] || 'text/plain'}); res.end(content); return;
    }
    if(url.pathname==='/api/v1/visual/services')return json(res,200,{services:['ops-agent-backend','gateway','offline'],default_service:'ops-agent-backend'});
    if(url.pathname==='/api/v1/visual/logs'){
      const service=url.searchParams.get('service'),method=url.searchParams.get('method')||'',route=url.searchParams.get('route')||'';
      if(service==='logs-offline')return json(res,502,{error:'模拟日志聚合失败'});
      if(service==='loading')return json(res,200,{service,method,route,window:{start_ms:Date.now()-900000,end_ms:Date.now()},data_window:null,buckets:[],summary:null,loading:true,initialized:false,notices:[]});
      const end=+(url.searchParams.get('end_ms')||Date.now()-5000),start=+(url.searchParams.get('start_ms')||(end-900000));
      const buckets=[],summary={total:0,by_level:{DEBUG:0,INFO:0,WARN:0,ERROR:0}};
      for(let ms=Math.floor(start/10000)*10000;ms<end;ms+=10000){const index=buckets.length,troubled=index>30&&index<60,empty=service==='empty';
        const by_level={DEBUG:0,INFO:empty?0:method?6:24,WARN:empty?0:troubled?8:0,ERROR:empty?0:troubled?3:0};
        const total=Object.values(by_level).reduce((a,b)=>a+b,0);buckets.push({start_ms:Math.max(ms,start),end_ms:Math.min(ms+10000,end),total,by_level});summary.total+=total;for(const [k,n]of Object.entries(by_level))summary.by_level[k]+=n;
      }
      return json(res,200,{service,method,route,window:{start_ms:start,end_ms:end},data_window:{start_ms:start,end_ms:end},bucket_ms:10000,buckets,summary,loading:false,initialized:true,stale:false,updated_at_ms:Date.now(),data_as_of_ms:end,refresh_seconds:15,notices:['预览合成日志，未连接数据库。']});
    }
    if(url.pathname==='/api/v1/visual/traces'){
      const service=url.searchParams.get('service'),operation=url.searchParams.get('operation')||'';
      if(service==='offline')return json(res,502,{error:'模拟 Jaeger 查询失败'});
      const end=+(url.searchParams.get('end_ms')||Date.now()),start=+(url.searchParams.get('start_ms')||(end-900000));
      const operations=['GET /api/v1/users','GET /api/v1/users/:id','POST /api/v1/users','PUT /api/v1/users/:id'];
      const points=[];const by_status={ok:0,degraded:0,failed:0};
      for(let i=0;i<4500;i++){
        const op=operations[i%4];if(operation&&operation!==op)continue;
        const troubled=i>1700&&i<2900&&i%4!==0;
        const status=troubled?(i%4===3?'failed':'degraded'):'ok';
        points.push({trace_id:`fixture-${i}`,entry_span_id:`entry-${i}`,service,operation:op,start_ms:start+(end-start)*i/4500,duration_ms:troubled?280+(i%71)*3:3+(i%37),status,incomplete:false});by_status[status]++;
      }
      return json(res,200,{service,operation,window:{start_ms:start,end_ms:end},points,operations,by_status,loading:false,initialized:true,stale:false,partial:false,updated_at_ms:Date.now(),data_as_of_ms:end,notices:['预览数据：4500 个合成入口样本，未连接真实 Jaeger。'],operation_queries:operations.map(op=>({operation:op,status:'success',raw_trace_count:1125,limit_reached:false})),refresh_seconds:15,point_limit:20000});
    }
    let body = ''; for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    const parts = url.pathname.split('/').filter(Boolean), cid = parts[3], runID = parts[5];
    if (!cid) {
      if (req.method === 'POST') { const c = {conversation_id: randomUUID(), title: data.title, created_at: Date.now(), updated_at: Date.now(), runs: []}; conversations.set(c.conversation_id, c); return json(res, 201, c); }
      return json(res, 200, {items: [...conversations.values()].sort((a,b) => b.updated_at-a.updated_at), has_more: false, next_offset: null});
    }
    const c = conversations.get(cid); if (!c) return json(res, 404, {detail: '不存在'});
    if (parts[4] === 'runs') {
      const r = c.runs.find(x => x.run_id === runID); if (!r) return json(res, 404, {});
      if (parts[6] === 'cancel') { r.stop?.(); }
      return json(res, 200, r);
    }
    if (req.method === 'GET') {
      const limit = +(url.searchParams.get('limit') || 20), before = +(url.searchParams.get('before') || Infinity);
      const rows = c.runs.filter(r => r.seq < before).sort((a,b) => b.seq-a.seq), chosen = rows.slice(0, limit);
      return json(res, 200, {conversation_id: cid, items: chosen.reverse(), has_more: rows.length > limit, next_cursor: rows.length > limit ? chosen[0].seq : null});
    }
    const key = `${cid}:${data.request_id}`;
    if (requests.has(key)) return json(res, 409, {detail: '重复提交', run_id: requests.get(key)});
    const r = makeRun(c, data.question); requests.set(key, r.run_id); c.updated_at = Date.now();
    if (data.question.includes('[响应丢失]')) {
      r.status = 'completed'; r.finished_at = Date.now();
      r.events = [{type: 'content', run_id: r.run_id, seq: 1, data: {message_id: 'm', delta: '服务器已完成；重试找回了原执行，没有重复生成。'}}];
      res.destroy(); return;
    }
    res.writeHead(200, {'Content-Type': 'text/event-stream', 'X-Run-ID': r.run_id}); res.flushHeaders();
    const emit = (type, data) => { const e = {type, data, run_id: r.run_id, conversation_id: cid, seq: r.events.length+1, timestamp: Date.now()}; r.events.push(e); res.write(`event: ${type}\ndata: ${JSON.stringify(e)}\n\n`); };
    const finish = status => { if (r.status !== 'running') return; r.status = status; r.finished_at = Date.now(); if (status === 'cancelled') emit('error', {message: '用户停止了本轮诊断'}); emit('done', {status}); res.end(); };
    r.stop = () => finish('cancelled'); res.on('close', () => { if (r.status === 'running') { r.status = 'cancelled'; r.error = '连接断开'; } });
    emit('meta', {status: 'running'});
    const delay = () => new Promise(resolve => setTimeout(resolve, 300));
    const steps = [
      ['thinking', {message_id: 'm1', delta: '先并行检查日志与链路统计，再根据异常请求下钻。'}],
      ['tool_start', {tool_call_id: 't1', name: 'query_log_stats', args: {start: 1789479485, end: 1789479545}}],
      ['tool_start', {tool_call_id: 't2', name: 'query_trace_stats', args: {service: 'ops-agent-backend'}}],
      ['tool_end', {tool_call_id: 't2', name: 'query_trace_stats', status: 'success', duration_ms: 160, content: {failed: 15, degraded: 60}}],
      ['tool_end', {tool_call_id: 't1', name: 'query_log_stats', status: 'success', duration_ms: 220, content: {total: 250, error: 30, component: 'redis'}}],
      ['tool_start', {tool_call_id: 't3', name: 'search_ops_knowledge', args: {query: 'Redis 超时回源'}}],
      ['tool_end', {tool_call_id: 't3', name: 'search_ops_knowledge', status: 'success', duration_ms: 350, content: 'GET 缓存读取超时后回源 MySQL。', artifact: {ref_to_item: {'K-abcdef123456': 0}, response: {items: [{title: 'Redis 超时与回源排查', doc_type: 'runbook', source: 'runbooks/redis-timeout.md', content: '## 排查步骤\n\n先确认 Redis 连通性，再核对超时预算。\n\n不要随意删除锁。'}]}}}],
    ];
    for (const [type, payload] of steps) { await delay(); if (r.status !== 'running') return; emit(type, payload); }
    if (data.question.includes('[断流]')) { r.error = '模拟断流，已保留工具记录'; r.status = 'cancelled'; res.destroy(); return; }
    const answer = data.question.includes('[XSS]') ? '<img src=x onerror="alert(1)"><script>alert(1)</script>[恶意链接](javascript:alert(1))\n\n**净化后的正文**' : '## 发现 Redis 依赖异常\n\n这个窗口存在 **读超时和请求降级**，需要进一步核对 Redis 与网络状态。\n\n| 入口 | 状态 | 影响 |\n| --- | --- | --- |\n| GET 详情 | 降级 | 回源成功，延迟升高 |\n| PUT 更新 | 失败 | 加锁超时，返回 500 |\n\n缓存读取失败后的回源符合项目约定。[K-abcdef123456]\n\n建议先检查连通性与超时配置，再确认是否恢复。';
    for (let i = 0; i < answer.length; i += 12) { await delay(); if (r.status !== 'running') return; emit('content', {message_id: 'm2', delta: answer.slice(i, i+12)}); }
    finish('completed');
  } catch (error) { if (!res.headersSent) json(res, 500, {detail: error.message}); else res.destroy(); }
});
const port = +(process.env.PREVIEW_PORT || 8765);
server.listen(port, '127.0.0.1', () => console.log(`UI preview: http://127.0.0.1:${port} (in-memory fixtures)`));
process.stdin.on('data', data => { if (data.toString().trim() === 'quit') server.close(() => process.exit()); });
