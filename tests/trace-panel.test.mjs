import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionSeconds,updateTraceDraft,timeAtX,pointCoordinates,LatestRequest} from '../static/trace-core.mjs';

test('selection rounds outward and supports reverse drag',()=>{
  assert.deepEqual(selectionSeconds(12999,10101),{start:10,end:13});
  assert.deepEqual(selectionSeconds(10000,10000),{start:10,end:11});
});
test('new selection replaces managed range and preserves user prose',()=>{
  const s={service:'user',operation:'GET /a',start:10,end:20};
  let draft=updateTraceDraft('请重点分析 Redis。',s);draft+='\n这是补充的问题。';
  draft=updateTraceDraft(draft,{...s,service:'profile',operation:'',start:30,end:40});
  assert.equal((draft.match(/\[Trace 诊断范围\]/g)||[]).length,1);
  assert.ok(draft.startsWith('请重点分析 Redis。'));assert.ok(draft.endsWith('这是补充的问题。'));
  assert.ok(draft.includes('服务：profile'));assert.ok(!draft.includes('GET /a'));
  assert.equal(updateTraceDraft(draft,null),'请重点分析 Redis。\n\n\n这是补充的问题。');
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
