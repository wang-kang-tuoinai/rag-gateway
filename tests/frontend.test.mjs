import test from 'node:test';
import assert from 'node:assert/strict';
import {readSSE, newRun, applyEvent, restoreRun, safeURL} from '../static/core.mjs';

function bytesStream(text, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({start(c) { for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size)); c.close(); }});
}
test('SSE supports split UTF-8, CRLF, comments, multiple events and multiline data', async () => {
  const events = [];
  await readSSE(bytesStream(': ping\r\n\r\nevent: thinking\r\ndata: {"data":\r\ndata: {"delta":"中文思考"}}\r\n\r\nevent: done\ndata: {"data":{"status":"completed"}}\n\n'), e => events.push(e));
  assert.equal(events[0].type, 'thinking'); assert.equal(events[0].data.delta, '中文思考');
  assert.equal(events[1].type, 'done');
});
test('SSE discards incomplete last frame, does not manufacture done', async () => {
  const events = [];
  await readSSE(bytesStream('data: {"type":"content","data":{"delta":"x"}}\n\ndata: {"type":"done"}'), e => events.push(e));
  assert.deepEqual(events.map(e => e.type), ['content']);
});
test('SSE exposes invalid JSON and transport errors', async () => {
  await assert.rejects(readSSE(bytesStream('data: broken\n\n'), () => {}), SyntaxError);
  await assert.rejects(readSSE(new ReadableStream({start(c) { c.error(new Error('disconnected')); }}), () => {}), /disconnected/);
});
const event = (type, data, seq) => ({type, data, seq, run_id: 'r'});
test('parallel repeated tools pair by call ID, not name or completion order', () => {
  const r = newRun('why', 'r');
  applyEvent(r, event('tool_start', {tool_call_id: 'a', name: 'search_traces'}, 1));
  applyEvent(r, event('tool_start', {tool_call_id: 'b', name: 'search_traces'}, 2));
  applyEvent(r, event('tool_end', {tool_call_id: 'b', status: 'success', content: 'B'}, 3));
  applyEvent(r, event('tool_end', {tool_call_id: 'a', status: 'error', content: 'A'}, 4));
  assert.equal(r.blocks[0].content, 'A'); assert.equal(r.blocks[1].content, 'B'); assert.equal(r.blocks.length, 2);
});
test('live deltas and merged history restore the same answer; snapshots replace rather than append', () => {
  const r = newRun('question', 'r');
  applyEvent(r, event('content', {message_id: 'm', delta: '你好'}, 1));
  applyEvent(r, event('content', {message_id: 'm', delta: '世界'}, 2));
  applyEvent(r, event('content', {message_id: 'm', delta: '世界'}, 2));
  applyEvent(r, {...event('content', {message_id: 'm', delta: 'other'}, 3), run_id: 'other'});
  const history = restoreRun({run_id: 'r', question: 'question', status: 'completed', events: [event('content', {message_id: 'm', delta: '你好世界'}, 1)]});
  assert.equal(r.blocks[0].text, history.blocks[0].text); assert.equal(history.done, true);
});
test('top-level interrupted status ends orphan tool cards and references are retained', () => {
  const item = {title: 'Redis', content: 'text'};
  const history = restoreRun({run_id: 'r', question: 'q', status: 'interrupted', error: '服务重启', events: [
    event('tool_end', {tool_call_id: 'a', artifact: {ref_to_item: {'K-abcdef': 0}, response: {items: [item]}}}, 1),
    event('tool_start', {tool_call_id: 'b'}, 2),
  ]});
  assert.equal(history.tools.get('b').status, 'interrupted'); assert.equal(history.refs.get('K-abcdef'), item);
  assert.equal(history.error, '服务重启');
});
test('source links only accept http and https', () => {
  assert.equal(safeURL('javascript:alert(1)'), null); assert.equal(safeURL('file:///etc/passwd'), null);
  assert.equal(safeURL('https://example.com/doc'), 'https://example.com/doc');
});
