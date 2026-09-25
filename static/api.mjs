const base = '/api/v1/conversations';
export const pathFor = id => `${base}/${encodeURIComponent(id)}`;
export class APIError extends Error {
  constructor(status, payload) {
    const detail = payload?.detail || payload?.error;
    super(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map(x => x.msg).join('；') : `请求失败（${status}）`);
    this.status = status; this.runId = payload?.run_id;
  }
}
export async function checkResponse(response) {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new APIError(response.status, payload);
  }
  return response;
}
async function json(path, options = {}) {
  const response = await fetch(path, {signal: AbortSignal.timeout(15000), ...options,
    headers: {'Content-Type': 'application/json', ...options.headers}});
  return (await checkResponse(response)).json();
}
export const api = {
  list: offset => json(`${base}?limit=20&offset=${offset}`),
  create: title => json(base, {method: 'POST', body: JSON.stringify({title})}),
  history: (id, before) => json(`${pathFor(id)}/messages?limit=20${before == null ? '' : `&before=${before}`}`),
  run: (id, run) => json(`${pathFor(id)}/runs/${encodeURIComponent(run)}`),
  cancel: (id, run) => json(`${pathFor(id)}/runs/${encodeURIComponent(run)}/cancel`, {method: 'POST'}),
  ask: (id, question, requestId, signal) => fetch(`${pathFor(id)}/messages`, {
    method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'text/event-stream'},
    body: JSON.stringify({question, request_id: requestId}), signal,
  }).then(checkResponse),
};
