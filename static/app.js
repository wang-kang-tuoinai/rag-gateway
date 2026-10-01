import {api} from './api.mjs';
import {readSSE, newRun, applyEvent, restoreRun} from './core.mjs';
import {element, renderRun} from './render.mjs';
import {initTracePanel} from './trace-panel.mjs';

const $ = id => document.getElementById(id);
const conversations = new Map();
let current = null, listing = [], nextOffset = null, listLoading = false, creating = false, frame = null;
const viewport = $('viewport');
const tracePanel = initTracePanel({writeDraft(update) {
  if (busy(current) || creating || current?.pending || current?.loading) return false;
  const next = update($('question').value);
  if (next.length > 10000) return false;
  $('question').value = next;
  if (current) current.draft = next;
  $('question').dispatchEvent(new Event('input'));
  $('question').focus();
  return true;
}});
function remember(id) { try { id ? localStorage.setItem('ops-diagnosis:active', id) : localStorage.removeItem('ops-diagnosis:active'); } catch {} }
function state(meta) {
  let c = conversations.get(meta.conversation_id);
  if (!c) {
    c = {id: meta.conversation_id, title: meta.title || '诊断会话', runs: [], loaded: false, loading: false, before: null, more: false, streaming: false, pending: null, notice: '', draft: '', follow: true};
    conversations.set(c.id, c);
  }
  c.title = meta.title || c.title; return c;
}
function requestID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function notice(c, text) { if (c) c.notice = text; if (current === c) schedule(); }
function busy(c) { return c?.streaming || c?.runs.some(r => r.status === 'running' || r.status === 'submitting'); }
function schedule() {
  if (frame != null) return;
  frame = requestAnimationFrame(() => { frame = null; render(); });
}
function controls() {
  const active = busy(current);
  $('send').hidden = !!active; $('stop').hidden = !active;
  $('stop').disabled = !!current?.stopping;
  $('stop').textContent = current?.stopping ? '正在停止…' : '■ 停止生成';
  $('question').disabled = !!active || creating;
  $('send').disabled = creating || !!current?.loading || !!current?.pending;
  $('new-chat').disabled = creating;
  $('composer-hint').textContent = active ? '正在诊断，可切换会话或停止生成' : 'Enter 发送 · Shift + Enter 换行';
}
function render() {
  $('conversation-title').textContent = current?.title || '新建诊断';
  $('welcome').hidden = !!current && (current.loading || current.runs.length > 0);
  const roots = current ? current.runs.map(renderRun) : [];
  // 复用节点，保留 details 展开状态，不按 token 重建整个消息列表。
  const container = $('runs');
  if (container.children.length !== roots.length || roots.some((r, i) => container.children[i] !== r)) container.replaceChildren(...roots);
  $('older').hidden = !current || (!current.more && !current.loading);
  $('older').disabled = !!current?.loading;
  $('older').textContent = current?.loading ? '加载中…' : '加载更早的对话';
  $('notice').hidden = !current?.notice;
  $('notice-text').textContent = current?.notice || '';
  $('retry').hidden = !current?.pending || !!current?.streaming;
  $('check-run').hidden = !current?.runs.some(r => r.run_id && !r.done) || !!current?.streaming;
  controls();
  if (current?.follow && !tracePanel.isOpen()) viewport.scrollTop = viewport.scrollHeight;
  $('latest').hidden = !current || viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 100;
}
function renderList() {
  $('conversation-list').replaceChildren();
  for (const meta of listing) {
    const c = state(meta), button = element('button', 'conversation');
    button.classList.toggle('active', current?.id === c.id);
    button.classList.toggle('live', !!busy(c));
    button.append(element('strong', '', c.title), element('small', '', new Date(meta.updated_at).toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})));
    button.onclick = () => select(c); $('conversation-list').append(button);
  }
  $('more-list').hidden = nextOffset == null;
}
async function loadList(more = false) {
  if (listLoading || (more && nextOffset == null)) return;
  listLoading = true; $('refresh-list').disabled = true; $('more-list').disabled = true;
  try {
    const data = await api.list(more ? nextOffset : 0);
    const merged = new Map((more ? listing : []).map(c => [c.conversation_id, c]));
    data.items.forEach(c => merged.set(c.conversation_id, c)); listing = [...merged.values()];
    nextOffset = data.has_more ? data.next_offset : null;
    $('list-notice').textContent = listing.length ? '' : '还没有诊断记录'; renderList();
  } catch (error) { $('list-notice').textContent = `会话列表加载失败：${error.message}。可点击刷新重试。`; }
  finally { listLoading = false; $('refresh-list').disabled = false; $('more-list').disabled = false; }
}
function select(c, preserveView = false) {
  if (creating) return;
  if (!preserveView) tracePanel.hide();
  if (current) { current.draft = $('question').value; current.scroll = viewport.scrollTop; }
  current = c; remember(c?.id); $('question').value = c?.draft || '';
  $('sidebar').classList.remove('visible'); $('menu').setAttribute('aria-expanded', 'false');
  render(); renderList();
  if (c && !c.loaded) loadHistory(c);
  else if (c && !c.follow) viewport.scrollTop = c.scroll || 0;
}
async function loadHistory(c, more = false) {
  if (c.loading || (more && !c.more)) return;
  c.loading = true; schedule();
  const oldHeight = viewport.scrollHeight, oldTop = viewport.scrollTop;
  try {
    const data = await api.history(c.id, more ? c.before : null);
    const existing = new Set(c.runs.map(r => r.run_id));
    const records = data.items.filter(r => !existing.has(r.run_id)).map(restoreRun);
    c.runs = [...records, ...c.runs]; c.before = data.next_cursor; c.more = data.has_more; c.loaded = true; c.notice = '';
    if (!more) c.follow = true;
    c.loading = false;
    if (current === c) {
      render();
      if (more) { c.follow = false; viewport.scrollTop = oldTop + viewport.scrollHeight - oldHeight; }
    }
    if (c.runs.some(r => !r.done) && !c.streaming) notice(c, '此会话有未结束的执行，可刷新状态或停止生成。');
  } catch (error) {
    notice(c, error.status === 404 ? '这个会话不存在，请新建诊断。' : `历史加载失败：${error.message}。重新选择此会话可重试。`);
  } finally { c.loading = false; schedule(); }
}
function replaceRun(c, old, record) {
  const restored = restoreRun(record), index = c.runs.indexOf(old);
  const duplicate = c.runs.find(r => r !== old && r.run_id === record.run_id);
  if (duplicate) c.runs.splice(c.runs.indexOf(duplicate), 1);
  const at = c.runs.indexOf(old);
  if (at >= 0) c.runs[at] = restored; else if (index < 0) c.runs.push(restored);
  return restored;
}
async function reconcile(c, run) {
  const record = await api.run(c.id, run.run_id);
  const restored = replaceRun(c, run, record);
  if (c.pending?.run === run) c.pending = null;
  if (record.status === 'running') notice(c, '执行仍在进行中，可稍后刷新状态或停止生成。');
  else notice(c, '');
  schedule(); return restored;
}
async function send(c, pending) {
  const run = pending.run; c.pending = pending; c.streaming = true; c.stopping = false; c.notice = ''; c.follow = true;
  run.status = 'submitting'; c.controller = new AbortController(); schedule(); renderList();
  try {
    const response = await api.ask(c.id, pending.question, pending.requestId, c.controller.signal);
    run.run_id = response.headers.get('X-Run-ID'); run.status = 'running';
    if (!response.headers.get('Content-Type')?.includes('text/event-stream')) throw new Error('返回格式不是事件流');
    if (c.stopping && run.run_id) void stop(c);
    await readSSE(response.body, event => {
      if (event.conversation_id && event.conversation_id !== c.id) throw new Error('事件会话不匹配');
      applyEvent(run, event); schedule();
    });
    if (!run.done) throw new Error('连接已结束，尚未收到完成状态');
    c.pending = null;
  } catch (error) {
    if (error.status === 409 && error.runId) {
      run.run_id = error.runId;
      try { await reconcile(c, run); c.pending = null; notice(c, '已读取服务器上的原执行记录，未重复生成。'); }
      catch (lookupError) { run.status = 'unknown'; notice(c, `提交状态待确认：${lookupError.message}`); }
    } else if (run.run_id) {
      try { await reconcile(c, run); c.pending = null; }
      catch (lookupError) { run.status = 'unknown'; notice(c, `连接中断，状态查询失败：${lookupError.message}。请刷新执行状态。`); c.pending = null; }
    } else if (error.status && error.status < 500) {
      run.status = 'failed'; run.done = true; run.error = error.message; c.pending = null;
    } else {
      run.status = 'unknown'; notice(c, `尚未确认是否提交成功：${error.message}。重试会复用本次提交标识。`);
    }
  } finally {
    c.streaming = false; c.stopping = false; c.controller = null;
    schedule(); renderList(); void loadList();
  }
}
async function stop(c) {
  const run = c.runs.findLast(r => !r.done && r.run_id);
  c.stopping = true; schedule();
  if (!run) return; // 响应头到达后 send 会继续提交停止请求。
  try {
    const record = await api.cancel(c.id, run.run_id);
    // 先保存服务端结果，再断开本地流；随后 reconcile 覆盖为最终快照。
    if (!c.streaming) replaceRun(c, run, record);
    c.controller?.abort(); c.pending = null; notice(c, '');
  } catch (error) { notice(c, `停止请求未确认：${error.message}。可重试停止或刷新状态。`); }
  finally { c.stopping = false; schedule(); }
}
$('chat-form').addEventListener('submit', async event => {
  event.preventDefault(); const question = $('question').value.trim();
  if (!question || busy(current) || creating || current?.loading || current?.pending) return;
  tracePanel.hide();
  let c = current;
  if (!c) {
    creating = true; controls();
    try {
      const meta = await api.create(question.slice(0, 60)); c = state(meta); c.loaded = true;
      listing.unshift(meta); current = c; remember(c.id); renderList();
    } catch (error) { $('list-notice').textContent = `新建会话失败：${error.message}，问题已保留。`; return; }
    finally { creating = false; controls(); }
  }
  const run = newRun(question); c.runs.push(run); c.draft = ''; $('question').value = ''; $('question').style.height = '';
  void send(c, {question, requestId: requestID(), run});
});
$('question').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); $('chat-form').requestSubmit(); }
});
$('question').addEventListener('input', () => { $('question').style.height = 'auto'; $('question').style.height = `${Math.min($('question').scrollHeight, 180)}px`; });
$('new-chat').onclick = () => select(null);
$('stop').onclick = () => current && stop(current);
$('retry').onclick = () => { if (current?.pending && !current.streaming) void send(current, current.pending); };
$('check-run').onclick = async () => {
  const c = current; $('check-run').disabled = true;
  try { for (const run of [...c.runs]) if (run.run_id && !run.done) await reconcile(c, run); }
  catch (error) { notice(c, `状态查询失败：${error.message}`); }
  finally { $('check-run').disabled = false; renderList(); }
};
$('refresh-list').onclick = () => loadList(); $('more-list').onclick = () => loadList(true);
$('older').onclick = () => current && loadHistory(current, true);
viewport.addEventListener('scroll', () => {
  if (!current || tracePanel.isOpen()) return;
  current.follow = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 100;
  $('latest').hidden = current.follow;
});
$('latest').onclick = () => { if (current) current.follow = true; viewport.scrollTop = viewport.scrollHeight; $('latest').hidden = true; };
$('menu').onclick = () => { const open = $('sidebar').classList.toggle('visible'); $('menu').setAttribute('aria-expanded', String(open)); };
$('close-reference').onclick = () => $('reference-dialog').close();
$('reference-dialog').onclick = event => { if (event.target === $('reference-dialog')) { const r = event.target.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) event.target.close(); } };
document.querySelectorAll('[data-prompt]').forEach(button => { button.onclick = () => { if (busy(current)) return; $('question').value = button.dataset.prompt; $('question').focus(); }; });
await loadList();
let saved; try { saved = localStorage.getItem('ops-diagnosis:active'); } catch {}
if (saved && /^[a-f0-9-]{36}$/i.test(saved)) select(state(listing.find(c => c.conversation_id === saved) || {conversation_id: saved}), true);
else render();
