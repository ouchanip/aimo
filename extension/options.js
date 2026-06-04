const zaiKeyInput = document.getElementById('zaikey');
const saveKeyBtn = document.getElementById('save-key');
const opencodeWsInput = document.getElementById('opencode-ws');
const saveOpencodeWsBtn = document.getElementById('save-opencode-ws');
const opencodeLink = document.getElementById('opencode-link');
const opencodeLinkWhat = document.getElementById('opencode-link-what');
const serverDot = document.getElementById('server-dot');
const serverText = document.getElementById('server-text');
const serverRecheckBtn = document.getElementById('server-recheck');
const zaiDot = document.getElementById('zai-dot');
const zaiText = document.getElementById('zai-text');
const zaiCaptureBtn = document.getElementById('zai-capture');
const toast = document.getElementById('toast');

const LOCAL_SERVER = 'http://localhost:3030';

init();

async function init() {
  await Promise.all([
    loadApiKey(),
    loadOpencodeWorkspace(),
    loadEnabled(),
    checkServer(),
    checkZaiJwt(),
  ]);

  saveKeyBtn.addEventListener('click', saveApiKey);
  saveOpencodeWsBtn.addEventListener('click', saveOpencodeWorkspace);
  serverRecheckBtn.addEventListener('click', checkServer);
  zaiCaptureBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://z.ai/' });
  });

  document.querySelectorAll('input[data-prov]').forEach((cb) => {
    cb.addEventListener('change', saveEnabled);
  });

  document.querySelectorAll('button[data-copy]').forEach((b) => {
    b.addEventListener('click', async () => {
      await navigator.clipboard.writeText(b.dataset.copy);
      showToast('Copied');
    });
  });

  // Refresh statuses when storage updates (e.g. z.ai tab captures JWT).
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.zaiJwt) checkZaiJwt();
    if (changes.zaiApiKey) loadApiKey();
  });
}

async function loadEnabled() {
  const { enabled } = await chrome.storage.local.get('enabled');
  const map = enabled || {};
  document.querySelectorAll('input[data-prov]').forEach((cb) => {
    cb.checked = map[cb.dataset.prov] !== false;
  });
}

async function saveEnabled() {
  const map = {};
  document.querySelectorAll('input[data-prov]').forEach((cb) => {
    map[cb.dataset.prov] = cb.checked;
  });
  await chrome.storage.local.set({ enabled: map });
  showToast('Saved');
}

async function loadApiKey() {
  const { zaiApiKey } = await chrome.storage.local.get('zaiApiKey');
  if (zaiApiKey) zaiKeyInput.value = zaiApiKey;
}

async function saveApiKey() {
  const value = zaiKeyInput.value.trim();
  await chrome.storage.local.set({ zaiApiKey: value });
  showToast(value ? 'Saved' : 'Cleared');
}

async function loadOpencodeWorkspace() {
  const { opencodeWorkspace } = await chrome.storage.local.get('opencodeWorkspace');
  if (opencodeWorkspace) opencodeWsInput.value = opencodeWorkspace;
  updateOpencodeLink(opencodeWorkspace);
}

async function saveOpencodeWorkspace() {
  const value = opencodeWsInput.value.trim();
  await chrome.storage.local.set({ opencodeWorkspace: value });
  updateOpencodeLink(value);
  showToast(value ? 'Saved' : 'Cleared');
}

// Build the OpenCode quick link from the saved workspace id. The id is never
// hardcoded; without it we send the user to /auth, which redirects to their
// workspace so they can copy the id from the URL.
function updateOpencodeLink(workspace) {
  if (workspace) {
    opencodeLink.href = `https://opencode.ai/workspace/${workspace}/go`;
    // Mask the per-user workspace id in the visible label (screenshots of the
    // options page shouldn't leak it); the href still carries the full URL.
    opencodeLinkWhat.textContent = `opencode.ai/workspace/${workspace.slice(0, 4)}…/go`;
  } else {
    opencodeLink.href = 'https://opencode.ai/auth';
    opencodeLinkWhat.textContent = 'opencode.ai/auth (set workspace ID above)';
  }
}

async function checkServer() {
  setDot(serverDot, 'unknown');
  serverText.textContent = 'checking…';
  try {
    const res = await fetch(`${LOCAL_SERVER}/api/ping`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      setDot(serverDot, 'on');
      serverText.textContent = 'online at localhost:3030';
    } else {
      setDot(serverDot, 'off');
      serverText.textContent = `HTTP ${res.status}`;
    }
  } catch {
    setDot(serverDot, 'off');
    serverText.textContent = 'offline — start the server below';
  }
}

async function checkZaiJwt() {
  const { zaiJwt, zaiJwtCapturedAt } = await chrome.storage.local.get(['zaiJwt', 'zaiJwtCapturedAt']);
  if (zaiJwt && zaiJwt.length > 20) {
    setDot(zaiDot, 'on');
    const when = zaiJwtCapturedAt ? new Date(zaiJwtCapturedAt).toLocaleString() : 'unknown';
    zaiText.textContent = `JWT captured (${when})`;
  } else {
    setDot(zaiDot, 'off');
    zaiText.textContent = 'not captured — visit z.ai once while logged in';
  }
}

function setDot(el, state) {
  el.classList.remove('status-on', 'status-off', 'status-unknown');
  el.classList.add(`status-${state}`);
}

function showToast(text) {
  toast.textContent = text;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 1200);
}
