const body = document.getElementById('body');
const refreshBtn = document.getElementById('refresh');
const LOCAL_SERVER = 'http://localhost:3030';

document.getElementById('open-options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
document.getElementById('open-dashboard').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: LOCAL_SERVER });
});

refreshBtn.addEventListener('click', refresh);
refresh();

async function refresh() {
  refreshBtn.disabled = true;
  body.innerHTML = '<div style="color:#666;font-size:11px;padding:6px 4px">Fetching…</div>';
  try {
    const results = await getResults();
    render(results || []);
  } catch (e) {
    body.innerHTML = `<div class="err">${esc(e.message || 'error')}</div>`;
  }
  refreshBtn.disabled = false;
}

// Strategy: ask the background to fetch browser-side sources and push to the
// local server. Then read the merged view from the server (authoritative for
// ZAI/Codex via bw + auth.json, cached pushes for Ollama/Claude).
// If the local server isn't reachable, fall back to the direct fetch results.
async function getResults() {
  const directPromise = chrome.runtime.sendMessage({ type: 'fetchAll', pushToLocal: true });
  const serverUp = await pingServer();

  if (!serverUp) {
    return await directPromise;
  }

  // Wait for the push to complete so the server's cache has fresh ollama/claude.
  await directPromise.catch(() => {});

  try {
    const res = await fetch(`${LOCAL_SERVER}/api/usage`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`server HTTP ${res.status}`);
    return await res.json();
  } catch {
    return await directPromise;
  }
}

async function pingServer() {
  try {
    const res = await fetch(`${LOCAL_SERVER}/api/ping`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(800),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function render(results) {
  body.innerHTML = results.map(renderCard).join('') || '<div class="err">no results</div>';
}

function renderCard(r) {
  if (!r.ok) {
    return `<div class="card"><h2>${esc(r.provider)}</h2><div class="err">${esc(r.error || 'error')}</div></div>`;
  }
  const plan = r.plan ? `<div class="plan">${esc(r.plan)}</div>` : '';
  const windows = (r.windows || []).map(renderWindow).join('') || '<div class="err">no window data</div>';
  return `<div class="card"><h2>${esc(r.provider)}</h2>${plan}${windows}</div>`;
}

function renderWindow(w) {
  const pct = w.used_pct == null ? null : Number(w.used_pct);
  const pctText = pct == null ? '—' : `${pct.toFixed(1)}%`;
  const width = pct == null ? 0 : Math.min(100, Math.max(0, pct));
  const reset = w.resets_in
    ? `resets in ${esc(w.resets_in)}`
    : w.resets_at
      ? `resets ${esc(fmtResetAt(w.resets_at))}`
      : '';
  return `<div class="window">
    <div class="whead"><span class="wlabel">${esc(w.label)}</span><span class="pct">${pctText}</span></div>
    <div class="bar"><div class="bar-fill" style="width:${width}%"></div></div>
    <div class="reset">${reset}</div>
  </div>`;
}

function fmtResetAt(iso) {
  try {
    const d = new Date(iso);
    const ms = d - Date.now();
    if (ms < 0) return 'soon';
    const h = Math.round(ms / 3600000);
    if (h < 48) return `in ${h}h`;
    return `in ${Math.round(h / 24)}d`;
  } catch {
    return iso;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
