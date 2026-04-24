import { fetchAll } from './fetchers.js';

const LOCAL_BASE = 'http://localhost:3030';
const INGEST_BASE = `${LOCAL_BASE}/ingest`;
const PENDING_URL = `${LOCAL_BASE}/api/pending-refresh`;
const POLL_ALARM = 'aimo:poll-pending';

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg?.type === 'fetchAll') {
    handleFetchAll({ pushToLocal: msg.pushToLocal !== false }).then(respond);
    return true;
  }
  if (msg?.type === 'zai:capture-jwt' && typeof msg.jwt === 'string' && msg.jwt.length > 20) {
    chrome.storage.local.set({ zaiJwt: msg.jwt, zaiJwtCapturedAt: Date.now() });
    return false;
  }
});

// Periodic alarm: if the local server has an agent-requested refresh pending,
// do a full fetch and push. MV3 enforces a 1-minute minimum period, so agents
// should treat POST /api/refresh as "fresh within ~1 minute" — or pass
// `?wait=N` for long-poll semantics.
chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== POLL_ALARM) return;
  try {
    const res = await fetch(PENDING_URL, { cache: 'no-store' });
    if (!res.ok) return;
    const { pending } = await res.json();
    if (pending) await handleFetchAll({ pushToLocal: true });
  } catch {
    // Local server not running — nothing to do.
  }
});

async function handleFetchAll({ pushToLocal }) {
  const { zaiApiKey, zaiJwt, enabled } = await chrome.storage.local.get(['zaiApiKey', 'zaiJwt', 'enabled']);
  const results = await fetchAll({ zaiApiKey, zaiJwt, enabled: enabled || {} });
  if (pushToLocal) {
    await Promise.allSettled(results.map(pushToIngest));
  }
  return results;
}

async function pushToIngest(result) {
  try {
    await fetch(`${INGEST_BASE}/${encodeURIComponent(result.provider)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    });
  } catch {}
}
