// SSE 解析与展示状态不依赖 DOM，实时事件和历史记录共用。
export async function readSSE(body, onEvent) {
  if (!body) throw new Error('服务器没有返回可读取的事件流');
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '', name = 'message', lines = [];
  const line = value => {
    if (value === '') {
      if (lines.length) {
        const event = JSON.parse(lines.join('\n'));
        if (!event.type && name !== 'message') event.type = name;
        onEvent(event);
      }
      lines = []; name = 'message'; return;
    }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let content = colon < 0 ? '' : value.slice(colon + 1);
    if (content.startsWith(' ')) content = content.slice(1);
    if (field === 'event') name = content;
    if (field === 'data') lines.push(content);
  };
  const consume = final => {
    while (true) {
      const at = buffer.search(/[\r\n]/);
      if (at < 0 || (!final && buffer[at] === '\r' && at === buffer.length - 1)) break;
      const length = buffer[at] === '\r' && buffer[at + 1] === '\n' ? 2 : 1;
      line(buffer.slice(0, at)); buffer = buffer.slice(at + length);
    }
  };
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, {stream: true});
      consume(done);
      if (done) break;
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function newRun(question, id = null) {
  return {run_id: id, question, status: 'running', blocks: [], texts: new Map(), tools: new Map(), refs: new Map(), seen: new Set(), error: '', done: false};
}
export function applyEvent(run, event) {
  if (run.run_id && event.run_id && run.run_id !== event.run_id) return;
  if (event.seq != null && run.seen.has(event.seq)) return;
  if (event.seq != null) run.seen.add(event.seq);
  run.run_id ||= event.run_id;
  const d = event.data || {};
  if (event.type === 'thinking' || event.type === 'content') {
    const key = `${event.type}:${d.message_id || 'default'}`;
    let block = run.texts.get(key);
    if (!block) { block = {type: event.type, key, text: ''}; run.texts.set(key, block); run.blocks.push(block); }
    block.text += typeof d.delta === 'string' ? d.delta : '';
  } else if (event.type === 'tool_start' || event.type === 'tool_end') {
    let block = run.tools.get(d.tool_call_id);
    if (!block) { block = {type: 'tool', key: `tool:${d.tool_call_id}`}; run.tools.set(d.tool_call_id, block); run.blocks.push(block); }
    Object.assign(block, d, {status: event.type === 'tool_start' ? 'running' : d.status || 'success'});
    for (const [ref, index] of Object.entries(d.artifact?.ref_to_item || {})) {
      const item = d.artifact?.response?.items?.[index];
      if (item && /^K-[a-f0-9]+$/.test(ref)) run.refs.set(ref, item);
    }
  } else if (event.type === 'error') run.error = d.message || '本轮执行发生错误';
  else if (event.type === 'done') { run.status = d.status; run.done = true; settleTools(run); }
}
function settleTools(run) {
  if (run.status !== 'running') for (const tool of run.tools.values()) {
    if (tool.status === 'running') tool.status = run.status === 'completed' ? 'unknown' : run.status;
  }
}
export function restoreRun(record) {
  const run = newRun(record.question, record.run_id);
  for (const event of record.events || []) applyEvent(run, event);
  run.status = record.status; run.error = record.error || run.error;
  run.seq = record.seq; run.done = record.status !== 'running';
  settleTools(run); return run;
}
export function safeURL(value) {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; }
}
