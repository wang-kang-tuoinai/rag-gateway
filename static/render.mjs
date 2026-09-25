import {safeURL} from './core.mjs';
export const statusLabels = {running: '生成中', completed: '已完成', cancelled: '已停止', failed: '执行失败', interrupted: '已中断', unknown: '待确认', success: '已完成', error: '失败', submitting: '正在提交'};
const toolLabels = {query_log_stats: '查询日志统计', query_log_templates: '查看日志模板', search_logs: '检索日志', query_logs: '检索日志', query_trace_stats: '查询链路统计', search_traces: '筛选请求链路', get_trace_detail: '查看链路详情', search_ops_knowledge: '检索运维知识'};
export function element(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className;
  if (text != null) el.textContent = text; return el;
}
export function markdown(el, text, refs = new Map()) {
  if (window.marked && window.DOMPurify) {
    el.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text), {
      USE_PROFILES: {html: true}, FORBID_TAGS: ['img', 'style', 'form', 'input', 'button', 'iframe'],
      FORBID_ATTR: ['style', 'id', 'name'],
    });
    el.querySelectorAll('a').forEach(a => {
      const url = safeURL(a.getAttribute('href'));
      if (!url) a.removeAttribute('href');
      else { a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });
  } else { el.textContent = text; el.style.whiteSpace = 'pre-wrap'; }
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest('pre,code,a,button')) continue;
    const pattern = /\[(K-[a-f0-9]+)\]/g;
    const matches = [...node.textContent.matchAll(pattern)].filter(m => refs.has(m[1]));
    if (!matches.length) continue;
    const fragment = document.createDocumentFragment(); let start = 0;
    for (const match of matches) {
      fragment.append(document.createTextNode(node.textContent.slice(start, match.index)));
      const button = element('button', 'citation', '↗ 来源');
      button.title = refs.get(match[1]).title; button.onclick = () => showReference(refs.get(match[1]));
      fragment.append(button); start = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(node.textContent.slice(start))); node.replaceWith(fragment);
  }
}
export function showReference(item) {
  document.getElementById('reference-title').textContent = item.title || '知识来源';
  document.getElementById('reference-meta').textContent = [item.doc_type, item.section || item.matched_sections?.join(' / '), item.source].filter(Boolean).join(' · ');
  const link = document.getElementById('reference-link'), url = safeURL(item.source_url);
  link.hidden = !url; if (url) link.href = url; else link.removeAttribute('href');
  markdown(document.getElementById('reference-content'), item.content || '没有可展示的正文');
  const dialog = document.getElementById('reference-dialog'); if (!dialog.open) dialog.showModal();
}
function pretty(value) { return typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2); }
export function renderRun(run) {
  if (!run.view) {
    const root = element('article', 'run'), user = element('div', 'user-message');
    const head = element('div', 'assistant-head'), status = element('span', 'run-status');
    head.append(element('span', 'assistant-mark', '⌁'), element('strong', '', 'Ops Agent'), status);
    const blocks = element('div', 'blocks'), error = element('div', 'run-error'), refs = element('div', 'references');
    error.setAttribute('role', 'status'); root.append(user, head, blocks, error, refs);
    run.view = {root, user, status, blocks, error, refs, nodes: new Map(), refCount: -1};
  }
  const v = run.view;
  v.root.dataset.runId = run.run_id || '';
  v.user.textContent = run.question;
  v.status.textContent = statusLabels[run.status] || run.status;
  v.status.dataset.status = run.status;
  v.error.hidden = !run.error; v.error.textContent = run.error;
  for (const block of run.blocks) {
    let node = v.nodes.get(block.key);
    if (!node) {
      if (block.type === 'content') node = {el: element('div', 'markdown')};
      else if (block.type === 'thinking') {
        const el = element('details', 'thinking'), body = element('pre');
        el.append(element('summary', '', '思考过程'), body); node = {el, body};
      } else {
        const el = element('details', 'tool'), summary = element('summary'), name = element('span', 'tool-name'), state = element('span', 'tool-state');
        summary.append(name, state);
        const body = element('div', 'tool-body'), args = element('pre'), result = element('pre');
        body.append(element('label', '', '调用参数'), args, element('label', '', '返回结果'), result);
        el.append(summary, body); node = {el, name, state, args, result};
      }
      v.nodes.set(block.key, node); v.blocks.append(node.el);
    }
    if (block.type === 'content') {
      if (node.text !== block.text || node.refCount !== run.refs.size) { markdown(node.el, block.text, run.refs); node.text = block.text; node.refCount = run.refs.size; }
    } else if (block.type === 'thinking') {
      if (node.text !== block.text) { node.body.textContent = block.text; node.text = block.text; }
    } else {
      node.name.textContent = toolLabels[block.name] || block.name || '工具调用';
      node.name.title = block.name || '';
      node.state.textContent = `${statusLabels[block.status] || block.status}${Number.isFinite(block.duration_ms) ? ` · ${Math.round(block.duration_ms)} ms` : ''}`;
      node.el.dataset.status = block.status;
      node.args.textContent = pretty(block.args);
      node.result.textContent = block.content != null ? pretty(block.content) : block.status === 'running' ? '等待工具返回…' : '没有完整结果';
    }
  }
  if (v.refCount !== run.refs.size) {
    v.refs.replaceChildren();
    for (const item of run.refs.values()) {
      const button = element('button', 'reference-chip', `↗ ${item.title}`);
      button.onclick = () => showReference(item); v.refs.append(button);
    }
    v.refCount = run.refs.size;
  }
  return v.root;
}
