import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionSeconds,updateTraceDraft,timeAtX,pointCoordinates,LatestRequest,operationToLogFilter} from '../static/trace-core.mjs';
import {displayLevels} from '../static/log-chart.mjs';

test('selection rounds outward and supports reverse drag',()=>{
  assert.deepEqual(selectionSeconds(12999,10101),{start:10,end:13});
  assert.deepEqual(selectionSeconds(10000,10000),{start:10,end:11});
});
test('new selection replaces managed range and preserves user prose',()=>{
  const s={service:'user',operation:'GET /a',start:10,end:20};
  let draft=updateTraceDraft('请重点分析 Redis。',s);draft+='\n这是补充的问题。';
  draft=updateTraceDraft(draft,{...s,service:'profile',operation:'',start:30,end:40});
  assert.equal((draft.match(/\[观测 诊断范围\]/g)||[]).length,1);
  assert.ok(draft.startsWith('请重点分析 Redis。'));assert.ok(draft.endsWith('这是补充的问题。'));
  assert.ok(draft.includes('服务：profile'));assert.ok(!draft.includes('GET /a'));
  assert.equal(updateTraceDraft(draft,null),'请重点分析 Redis。\n\n\n这是补充的问题。');
});
test('HTTP operation maps to method and template, not actual path or arbitrary operation',()=>{
  assert.deepEqual(operationToLogFilter('GET /api/v1/users/:id'),{method:'GET',route:'/api/v1/users/:id'});
  assert.deepEqual(operationToLogFilter(''),{method:'',route:''});
  assert.equal(operationToLogFilter('mysql.GetById'),null);
  const draft=updateTraceDraft('问题\n[Trace 诊断范围]\n旧范围\n[/Trace 诊断范围]\n[观测 诊断范围]\n重复范围\n[/观测 诊断范围]',{service:'user',operation:'GET /api/v1/users/:id',start:10,end:20});
  assert.equal((draft.match(/\[观测 诊断范围\]/g)||[]).length,1);
  assert.ok(draft.includes('method=GET，route=/api/v1/users/:id'));
  assert.ok(!draft.includes('旧范围'));
});
test('unknown log levels remain represented in totals',()=>{
  assert.deepEqual(displayLevels({INFO:5,WARN:2,ERROR:1,FATAL:3,TRACE:4}),{DEBUG:0,INFO:5,WARN:2,ERROR:1,OTHER:7});
});
test('plot coordinates and selection clamp use milliseconds',()=>{
  const window={start_ms:100000,end_ms:200000};
  assert.equal(timeAtX(-100,window,800),100000);assert.equal(timeAtX(900,window,800),200000);
  const point={start_ms:150000,duration_ms:50};const p=pointCoordinates(point,window,800,300,100);
  assert.equal(timeAtX(p.x,window,800),150000);assert.ok(p.y>20&&p.y<264);
});
test('late response from an old service cannot replace the current view',async()=>{
  const latest=new LatestRequest();let release;
  const old=latest.run('/old',()=>new Promise(resolve=>{release=resolve;}));
  const current=await latest.run('/new',async()=>({ok:true,json:async()=>({service:'new'})}));
  release({ok:true,json:async()=>({service:'old'})});
  assert.equal(current.service,'new');assert.equal(await old,null);
});
test('HTTP errors are errors, not empty successful charts',async()=>{
  await assert.rejects(new LatestRequest().run('/bad',async()=>({ok:false,status:502,json:async()=>({error:'offline'})})),/offline/);
});
