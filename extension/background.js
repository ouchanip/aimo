import { fetchAll } from './fetchers.js';

const INGEST_BASE = 'http://localhost:3030/ingest';

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
