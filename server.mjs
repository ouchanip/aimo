#!/usr/bin/env node
// HTTP server for the usage dashboard.
//
// Routes:
//   GET  /                     -> HTML dashboard
//   GET  /api/ping             -> liveness probe
//   GET  /api/usage            -> JSON: server-side fresh + push cache merged
//   POST /api/refresh[?wait=N] -> same payload; sets a "please push" flag so
//                                 the extension fetches claude/ollama on its
//                                 next alarm. Optional `wait=N` (seconds, max
//                                 15) long-polls until the extension pushes.
//   GET  /api/pending-refresh  -> polled by the extension's background alarm
//   POST /ingest/:provider     -> extension uploads fresh data (CORS)
//
// Merge policy:
//   - 'zai' and 'codex' are fetched server-side on every call.
//   - 'ollama' and 'claude' come from the push cache — the extension is the
//     only path to their cookies.
//   - If server-side returns error AND push cache has data, prefer cache.

import 'dotenv/config';
import { createServer } from 'node:http';
import { collectAll } from './collectors/index.mjs';
import { resolveConfig } from './lib/env-resolver.mjs';

const PORT = Number(process.env.USAGE_MONITOR_PORT || 3030);
const PUSH_ONLY = new Set(['ollama', 'claude']);

// In-memory cache for pushed data. Keyed by provider.
// cache[provider] = { data, received_at }
const cache = Object.create(null);

// Agent-triggered refresh signalling. Set by POST /api/refresh; cleared when
// the extension pushes fresh data for either push-only provider.
// `pendingRefresh.requested_at` is epoch ms.
let pendingRefresh = null;
// long-poll resolvers waiting for the next push that arrives after `sinceMs`.
const pushWaiters = [];
const MAX_WAIT_SECONDS = 15;

const server = createServer(async (req, res) => {
  try {
    // CORS for POST /ingest
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': req.headers.origin || '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'POST' && url.pathname.startsWith('/ingest/')) {
      await handleIngest(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/ping') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors(req) });
      res.end('{"ok":true}');
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/pending-refresh') {
      res.writeHead(200, { 'Content-Type': 'application/json', ...cors(req) });
      res.end(JSON.stringify({
        pending: !!pendingRefresh,
        requested_at: pendingRefresh?.requested_at || null,
      }));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/usage') {
      const merged = await buildMergedResults();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) });
      res.end(JSON.stringify(merged, null, 2));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/refresh') {
      await handleRefreshPost(req, res, url);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      const merged = await buildMergedResults();
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderHtml(merged));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`error: ${err.message}`);
  }
});

async function handleIngest(req, res, url) {
  const provider = url.pathname.replace('/ingest/', '').split('/')[0];
  if (!provider) {
    res.writeHead(400);
    res.end('missing provider');
    return;
  }

  const body = await readBody(req);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, cors(req));
    res.end('invalid json');
    return;
  }

  // Normalize: accept either a full result object or a raw payload.
  const data = parsed.provider ? parsed : { provider, ...parsed };
  const receivedAtIso = new Date().toISOString();
  const receivedAtMs = Date.parse(receivedAtIso);
  cache[provider] = { data, received_at: receivedAtIso };

  // Clear the pending flag and wake long-pollers once a push-only provider
  // has landed fresh data after the agent's refresh request.
  if (PUSH_ONLY.has(provider) && pendingRefresh && receivedAtMs >= pendingRefresh.requested_at) {
    pendingRefresh = null;
  }
  resolveWaiters(receivedAtMs);

  res.writeHead(200, { ...cors(req), 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, provider, received_at: receivedAtIso }));
}

async function handleRefreshPost(req, res, url) {
  const waitRaw = Number(url.searchParams.get('wait') || 0);
  const waitSec = Math.min(Math.max(isFinite(waitRaw) ? waitRaw : 0, 0), MAX_WAIT_SECONDS);
  const requestedAt = Date.now();
  pendingRefresh = { requested_at: requestedAt };

  if (waitSec > 0) {
    await waitForPushAfter(requestedAt, waitSec * 1000);
  }

  const merged = await buildMergedResults();
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...cors(req) });
  res.end(JSON.stringify(merged, null, 2));
}

function waitForPushAfter(sinceMs, timeoutMs) {
  return new Promise((resolve) => {
    const waiter = { sinceMs, resolve };
    pushWaiters.push(waiter);
    waiter.timer = setTimeout(() => {
      const idx = pushWaiters.indexOf(waiter);
      if (idx >= 0) pushWaiters.splice(idx, 1);
      resolve();
    }, timeoutMs);
  });
}

function resolveWaiters(pushReceivedMs) {
  for (let i = pushWaiters.length - 1; i >= 0; i--) {
    const w = pushWaiters[i];
    if (pushReceivedMs >= w.sinceMs) {
      clearTimeout(w.timer);
      w.resolve();
      pushWaiters.splice(i, 1);
    }
  }
}

function cors(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function buildMergedResults() {
  const serverSide = await collectAll(resolveConfig());
  return serverSide.map((r) => {
    const cached = cache[r.provider];
    const useCache = PUSH_ONLY.has(r.provider) || (!r.ok && cached);
    if (useCache && cached) {
      return { ...cached.data, _source: 'push', _received_at: cached.received_at };
    }
    return { ...r, _source: 'server' };
  });
}


server.listen(PORT, () => {
  console.log(`usage-monitor listening on http://localhost:${PORT}`);
});

// -----------------------------------------------------------
// HTML rendering
// -----------------------------------------------------------

function renderHtml(results) {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const cardsHtml = results.map(renderCard).join('\n');
  const initialJson = JSON.stringify(results).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>aimo — AI Usage Monitor</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #0f1115; color: #e6e6e6; margin: 0; padding: 24px; }
  header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 20px; gap: 16px; flex-wrap: wrap; }
  .brand-wrap { display: flex; flex-direction: column; line-height: 1; }
  .brand { font-family: -apple-system, Segoe UI, system-ui, sans-serif; font-weight: 800; font-size: 40px; letter-spacing: -1.5px; margin: 0; line-height: 1; background: linear-gradient(135deg, #7dd3fc 0%, #22d3ee 50%, #06b6d4 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .brand-sub { font-size: 11px; letter-spacing: 1.5px; text-transform: uppercase; color: #6b7280; margin-top: 6px; }
  .subtitle { color: #888; font-size: 12px; margin-top: 2px; }
  button { background: #2a2f3a; color: #e6e6e6; border: 1px solid #3a4050; padding: 6px 14px; border-radius: 6px; cursor: pointer; font: inherit; }
  button:hover { background: #343a47; }
  button:active { background: #242935; }
  button.loading { opacity: 0.6; cursor: wait; }
  .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  .card { background: #181b22; border: 1px solid #2a2f3a; border-radius: 10px; padding: 16px; position: relative; }
  .card h2 { margin: 0 0 2px; font-size: 14px; letter-spacing: 0.5px; text-transform: uppercase; }
  .plan { color: #888; font-size: 12px; margin-bottom: 12px; }
  .err { color: #ff6b6b; font-size: 13px; }
  .source { position: absolute; top: 12px; right: 14px; font-size: 10px; color: #555; text-transform: uppercase; letter-spacing: 0.5px; }
  .source.push { color: #7dd3fc; }
  .window { margin: 10px 0; }
  .window-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px; }
  .window-label { color: #bbb; }
  .pct { font-variant-numeric: tabular-nums; }
  .bar { height: 8px; background: #242935; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; background: linear-gradient(90deg, #4ade80, #facc15 60%, #ef4444); transition: width 0.3s; }
  .reset { font-size: 11px; color: #777; margin-top: 2px; }
  a { color: #7dd3fc; }
</style>
</head>
<body>
<header>
  <div>
    <div class="brand-wrap">
      <span class="brand">aimo</span>
      <span class="brand-sub">AI Usage Monitor</span>
    </div>
    <div class="subtitle" id="updated">rendered ${now} UTC · <a href="/api/usage">json</a></div>
  </div>
  <div>
    <button id="refresh">Refresh</button>
  </div>
</header>
<div class="grid" id="grid">
${cardsHtml}
</div>
<script>
  window.__INITIAL__ = ${initialJson};
  ${CLIENT_SCRIPT}
</script>
</body>
</html>`;
}

function renderCard(r) {
  const head = `<h2>${escapeHtml(r.provider)}</h2>`;
  const source = r._source === 'push'
    ? `<div class="source push" title="pushed at ${escapeHtml(r._received_at || '')}">push</div>`
    : `<div class="source">server</div>`;
  if (!r.ok) {
    return `<div class="card" data-provider="${escapeHtml(r.provider)}">${source}${head}<div class="err">${escapeHtml(r.error || 'error')}</div></div>`;
  }
  const plan = r.plan ? `<div class="plan">${escapeHtml(r.plan)}</div>` : '<div class="plan">&nbsp;</div>';
  const windows = (r.windows || []).map(renderWindow).join('') ||
    `<div class="err">no window data${r.raw ? ': ' + escapeHtml(JSON.stringify(r.raw).slice(0, 120)) : ''}</div>`;
  return `<div class="card" data-provider="${escapeHtml(r.provider)}">${source}${head}${plan}${windows}</div>`;
}

function renderWindow(w) {
  const pct = w.used_pct == null ? null : Number(w.used_pct);
  const pctText = pct == null ? '—' : `${pct.toFixed(1)}%`;
  const width = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const reset = w.resets_in
    ? `resets in ${escapeHtml(w.resets_in)}`
    : w.resets_at
      ? `resets ${escapeHtml(fmtResetAt(w.resets_at))}`
      : '';
  return `<div class="window">
    <div class="window-head"><span class="window-label">${escapeHtml(w.label)}</span><span class="pct">${pctText}</span></div>
    <div class="bar"><div class="bar-fill" style="width:${width}%"></div></div>
    <div class="reset">${reset}</div>
  </div>`;
}

function fmtResetAt(iso) {
  try {
    const d = new Date(iso);
    const ms = d - Date.now();
    if (ms < 0) return 'soon';
    const h = Math.round(ms / 3_600_000);
    if (h < 48) return `in ${h}h`;
    return `in ${Math.round(h / 24)}d`;
  } catch {
    return iso;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Inline client script. Handles:
//   - manual refresh button
//   - dispatching window.postMessage for the Chrome extension content bridge
//   - polling /api/usage briefly after refresh so pushed data is picked up
const CLIENT_SCRIPT = `
(function () {
  const grid = document.getElementById('grid');
  const refreshBtn = document.getElementById('refresh');
  const updatedEl = document.getElementById('updated');

  function triggerExtensionRefresh() {
    window.postMessage({ type: 'usage-monitor:refresh', providers: ['ollama', 'claude', 'codex', 'zai'] }, window.location.origin);
  }

  async function fetchAndRender() {
    const res = await fetch('/api/usage', { cache: 'no-store' });
    const data = await res.json();
    renderCards(data);
    updatedEl.textContent = 'updated ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC · ' + '<a>'.replace('<a>', '');
    updatedEl.innerHTML = 'updated ' + new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC · <a href="/api/usage">json</a>';
  }

  function renderCards(results) {
    grid.innerHTML = results.map(renderCard).join('\\n');
  }

  function renderCard(r) {
    const source = r._source === 'push'
      ? '<div class="source push" title="pushed at ' + esc(r._received_at || '') + '">push</div>'
      : '<div class="source">server</div>';
    const head = '<h2>' + esc(r.provider) + '</h2>';
    if (!r.ok) {
      return '<div class="card" data-provider="' + esc(r.provider) + '">' + source + head + '<div class="err">' + esc(r.error || 'error') + '</div></div>';
    }
    const plan = r.plan ? '<div class="plan">' + esc(r.plan) + '</div>' : '<div class="plan">&nbsp;</div>';
    const windows = (r.windows || []).map(renderWindow).join('') ||
      ('<div class="err">no window data' + (r.raw ? ': ' + esc(JSON.stringify(r.raw).slice(0, 120)) : '') + '</div>');
    return '<div class="card" data-provider="' + esc(r.provider) + '">' + source + head + plan + windows + '</div>';
  }

  function renderWindow(w) {
    const pct = w.used_pct == null ? null : Number(w.used_pct);
    const pctText = pct == null ? '—' : pct.toFixed(1) + '%';
    const width = pct == null ? 0 : Math.min(100, Math.max(0, pct));
    const reset = w.resets_in
      ? 'resets in ' + esc(w.resets_in)
      : w.resets_at
        ? 'resets ' + esc(fmtResetAt(w.resets_at))
        : '';
    return '<div class="window">' +
      '<div class="window-head"><span class="window-label">' + esc(w.label) + '</span><span class="pct">' + pctText + '</span></div>' +
      '<div class="bar"><div class="bar-fill" style="width:' + width + '%"></div></div>' +
      '<div class="reset">' + reset + '</div>' +
      '</div>';
  }

  function fmtResetAt(iso) {
    try {
      const d = new Date(iso);
      const ms = d - Date.now();
      if (ms < 0) return 'soon';
      const h = Math.round(ms / 3600000);
      if (h < 48) return 'in ' + h + 'h';
      return 'in ' + Math.round(h / 24) + 'd';
    } catch {
      return iso;
    }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function refreshCycle() {
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
    triggerExtensionRefresh();
    // Poll for pushed updates over ~10s.
    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, i === 0 ? 500 : 2000));
      try { await fetchAndRender(); } catch (e) { console.warn(e); }
    }
    refreshBtn.classList.remove('loading');
    refreshBtn.disabled = false;
  }

  refreshBtn.addEventListener('click', refreshCycle);
  // Kick off on page open: ask the extension for fresh data.
  refreshCycle();
})();
`;
