// Cross-origin fetchers. Run only inside the background service worker or
// the extension popup — host_permissions bypass CORS there.

export async function fetchAll({ zaiApiKey, zaiJwt, opencodeWorkspace, enabled = {} } = {}) {
  const jobs = [];
  if (enabled.zai !== false) jobs.push(fetchZai({ apiKey: zaiApiKey, jwt: zaiJwt }));
  if (enabled.claude !== false) jobs.push(fetchClaude());
  if (enabled.codex !== false) jobs.push(fetchCodex());
  if (enabled.ollama !== false) jobs.push(fetchOllama());
  if (enabled.opencode !== false) jobs.push(fetchOpencode({ workspace: opencodeWorkspace }));
  if (enabled.minimax !== false) jobs.push(fetchMinimax());
  return Promise.all(jobs);
}

export async function fetchZai({ apiKey, jwt } = {}) {
  // Prefer the JWT captured from a z.ai tab (zero-config). Fall back to the
  // API key from the options page. If neither is present, tell the user how
  // to set it up.
  const token = jwt || apiKey;
  if (!token) {
    return {
      provider: 'zai',
      ok: false,
      error: 'no credentials — visit z.ai while logged in (JWT captured automatically) or paste API key in extension options',
    };
  }
  try {
    const res = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
      headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
    });
    if (!res.ok) return { provider: 'zai', ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    if (body.code !== 200 || !body.data) {
      // If JWT failed and we have an API key, retry with the API key.
      if (jwt && apiKey && jwt !== apiKey) {
        const retry = await fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        });
        if (retry.ok) {
          const b2 = await retry.json();
          if (b2.code === 200 && b2.data) return formatZai(b2, 'api-key');
        }
      }
      return { provider: 'zai', ok: false, error: body.msg || 'unexpected response' };
    }
    return formatZai(body, jwt ? 'jwt' : 'api-key');
  } catch (e) {
    return { provider: 'zai', ok: false, error: e.message };
  }
}

function formatZai(body, authSource) {
  const limits = body.data.limits || [];
  const rows = limits.map((l) => {
    const win = zaiWindow(l);
    return {
      type: l.type,
      win,
      label: zaiLabel(l, win),
      used_pct: typeof l.percentage === 'number' ? l.percentage : null,
      usage: l.usage ?? null,
      remaining: l.remaining ?? null,
      resets_at: l.nextResetTime ? new Date(l.nextResetTime).toISOString() : null,
    };
  });
  // Sort by next reset ascending so short, actionable windows (5h) appear
  // before monthly/long-running ones — more intuitive at a glance.
  rows.sort(byResetsAt);
  return {
    provider: 'zai',
    ok: true,
    plan: body.data.level || null,
    auth_source: authSource,
    windows: rows.map(({ type, win, ...rest }) => rest),
  };
}

// ZAI's API names don't map to the UI terminology:
//   TOKENS_LIMIT → the "Hours Quota" (main LLM quota, 5h on legacy plans)
//   TIME_LIMIT   → "Tool usage" (Web Search / Reader / Zread call counter)
// We surface that mapping in labels so the dashboard matches ZAI's page.
function zaiLabel(l, win) {
  if (l.type === 'TIME_LIMIT') return win ? `tool usage (${win})` : 'tool usage';
  if (l.type === 'TOKENS_LIMIT') return win || 'tokens';
  return String(l.type || 'limit').toLowerCase().replace('_limit', '');
}

function zaiWindow(l) {
  const hrs = l.nextResetTime ? (l.nextResetTime - Date.now()) / 3_600_000 : null;
  if (hrs === null || hrs <= 0) return null;
  if (hrs < 6) return '5h';
  if (hrs < 48) return 'daily';
  if (hrs < 10 * 24) return 'weekly';
  if (hrs < 45 * 24) return 'monthly';
  return 'long';
}

function byResetsAt(a, b) {
  if (!a.resets_at && !b.resets_at) return 0;
  if (!a.resets_at) return 1;
  if (!b.resets_at) return -1;
  return new Date(a.resets_at) - new Date(b.resets_at);
}

export async function fetchCodex() {
  try {
    // 1) Get an access_token from NextAuth session (requires chatgpt.com web login).
    const sessRes = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include' });
    if (!sessRes.ok) {
      return { provider: 'codex', ok: false, error: `session HTTP ${sessRes.status} — login to chatgpt.com?` };
    }
    const sess = await sessRes.json();
    const token = sess?.accessToken;
    if (!token) {
      return { provider: 'codex', ok: false, error: 'no accessToken in session — login to chatgpt.com?' };
    }

    // 2) Call wham/usage with the Bearer token + cookies.
    const res = await fetch('https://chatgpt.com/backend-api/wham/usage', {
      headers: { 'Accept': 'application/json', 'Authorization': `Bearer ${token}` },
      credentials: 'include',
    });
    if (!res.ok) {
      return { provider: 'codex', ok: false, error: `HTTP ${res.status}` };
    }
    const body = await res.json();
    const windows = [];
    const primary = body?.rate_limit?.primary_window;
    const secondary = body?.rate_limit?.secondary_window;
    if (primary) windows.push(codexWindow('session (5h)', primary));
    if (secondary) windows.push(codexWindow('weekly (7d)', secondary));
    for (const extra of body?.additional_rate_limits || []) {
      const p = extra?.rate_limit?.primary_window;
      const s = extra?.rate_limit?.secondary_window;
      const name = extra?.limit_name || 'extra';
      if (p) windows.push(codexWindow(`${name} 5h`, p));
      if (s) windows.push(codexWindow(`${name} 7d`, s));
    }
    return { provider: 'codex', ok: true, plan: body.plan_type ?? null, windows };
  } catch (e) {
    return { provider: 'codex', ok: false, error: e.message };
  }
}

function codexWindow(label, w) {
  return {
    label,
    used_pct: w.used_percent ?? null,
    resets_at: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : null,
    window_seconds: w.limit_window_seconds ?? null,
  };
}

export async function fetchOllama() {
  try {
    const res = await fetch('https://ollama.com/settings', { credentials: 'include' });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 302 ? ' — login to ollama.com?' : '';
      return { provider: 'ollama', ok: false, error: `HTTP ${res.status}${hint}` };
    }
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    const plan = (text.match(/Cloud Usage\s*\n\s*(\w+)/i) || [])[1] || null;
    const s = text.match(/Session usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i);
    const w = text.match(/Weekly usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i);
    const windows = [
      s && { label: 'session', used_pct: parseFloat(s[1]), resets_in: s[2].trim() },
      w && { label: 'weekly', used_pct: parseFloat(w[1]), resets_in: w[2].trim() },
    ].filter(Boolean);
    if (windows.length === 0) {
      return { provider: 'ollama', ok: false, error: 'could not parse usage — page layout changed?' };
    }
    return { provider: 'ollama', ok: true, plan, windows };
  } catch (e) {
    return { provider: 'ollama', ok: false, error: e.message };
  }
}

export async function fetchClaude() {
  try {
    const bootRes = await fetch('https://claude.ai/api/bootstrap', { credentials: 'include' });
    if (!bootRes.ok) {
      const hint = bootRes.status === 401 ? ' — login to claude.ai?' : '';
      return { provider: 'claude', ok: false, error: `bootstrap HTTP ${bootRes.status}${hint}` };
    }
    const boot = await bootRes.json();
    const memberships = boot?.account?.memberships || [];
    if (memberships.length === 0) {
      return { provider: 'claude', ok: false, error: 'no organizations on account' };
    }
    // Prefer the active (non-api-disabled, stripe-billed) org.
    const active = memberships.find((m) => !m.organization?.api_disabled_reason && m.organization?.billing_type === 'stripe_subscription')
      || memberships.find((m) => !m.organization?.api_disabled_reason)
      || memberships[0];
    const orgId = active.organization?.uuid;
    if (!orgId) return { provider: 'claude', ok: false, error: 'no org uuid' };

    const usageRes = await fetch(`https://claude.ai/api/organizations/${orgId}/usage`, { credentials: 'include' });
    if (!usageRes.ok) return { provider: 'claude', ok: false, error: `usage HTTP ${usageRes.status}` };
    const u = await usageRes.json();

    const windows = [];
    pushClaudeWindow(windows, 'session (5h)', u.five_hour);
    pushClaudeWindow(windows, 'weekly (all)', u.seven_day);
    pushClaudeWindow(windows, 'weekly Sonnet', u.seven_day_sonnet);
    pushClaudeWindow(windows, 'weekly Opus', u.seven_day_opus);

    const extra = u.extra_usage;
    if (extra && extra.is_enabled && typeof extra.used_credits === 'number' && typeof extra.monthly_limit === 'number' && extra.monthly_limit > 0) {
      windows.push({
        label: `extra ($${(extra.used_credits / 100).toFixed(2)}/$${(extra.monthly_limit / 100).toFixed(0)})`,
        used_pct: Math.round((extra.used_credits / extra.monthly_limit) * 1000) / 10,
        resets_at: extra.resets_at || null,
      });
    }

    return {
      provider: 'claude',
      ok: true,
      plan: active.organization?.rate_limit_tier || null,
      windows,
      org_name: active.organization?.name || null,
    };
  } catch (e) {
    return { provider: 'claude', ok: false, error: e.message };
  }
}

function pushClaudeWindow(arr, label, w) {
  if (!w || typeof w.utilization !== 'number') return;
  arr.push({ label, used_pct: w.utilization, resets_at: w.resets_at || null });
}

// OpenCode Go subscription usage.
//
// No public usage API (docs only cover the inference gateway). The workspace
// console is a SolidStart app that streams the numbers into the SSR HTML, e.g.
//   rollingUsage = { status:"ok", resetInSec:18000,   usagePercent:0 }
//   weeklyUsage  = { status:"ok", resetInSec:125659,  usagePercent:0 }
//   monthlyUsage = { status:"ok", resetInSec:2671357, usagePercent:0 }
// We fetch the /workspace/<id>/go page with the browser's own opencode.ai
// session (credentials:'include') and parse those three windows. The cookie
// never leaves the browser. The workspace id is per-user, so it's supplied
// from chrome.storage.local (set in the options page) rather than hardcoded.
const OPENCODE_WINDOWS = [
  { key: 'rollingUsage', label: 'rolling (5h)' },
  { key: 'weeklyUsage', label: 'weekly (7d)' },
  { key: 'monthlyUsage', label: 'monthly (30d)' },
];

export async function fetchOpencode({ workspace } = {}) {
  if (!workspace) {
    return { provider: 'opencode', ok: false, error: 'set your OpenCode workspace ID in the options page' };
  }
  try {
    const url = `https://opencode.ai/workspace/${workspace}/go`;
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 302 ? ' — login to opencode.ai?' : '';
      return { provider: 'opencode', ok: false, error: `HTTP ${res.status}${hint}` };
    }
    const html = await res.text();
    const now = Date.now();
    const windows = [];
    for (const { key, label } of OPENCODE_WINDOWS) {
      const pct = html.match(new RegExp(`${key}[^]{0,90}?usagePercent:([\\d.]+)`));
      if (!pct) continue;
      const reset = html.match(new RegExp(`${key}[^]{0,90}?resetInSec:(\\d+)`));
      const resetSec = reset ? Number(reset[1]) : null;
      windows.push({
        label,
        used_pct: Number(pct[1]),
        resets_at: resetSec != null ? new Date(now + resetSec * 1000).toISOString() : null,
        window_seconds: resetSec,
      });
    }
    if (windows.length === 0) {
      return { provider: 'opencode', ok: false, error: 'could not parse usage — login to opencode.ai or layout changed?' };
    }
    return { provider: 'opencode', ok: true, plan: 'OpenCode Go', windows };
  } catch (e) {
    return { provider: 'opencode', ok: false, error: e.message };
  }
}

// MiniMax Token/Coding Plan usage.
//
// platform.minimax.io authenticates console API calls with HttpOnly cookies —
// adding an Authorization header actually makes it fail with "cookie is
// missing", so this must run in the browser (credentials:'include').
// The required ?GroupId= is mirrored in the non-HttpOnly minimax_group_id_v2
// cookie, so we read it via chrome.cookies — zero configuration.
//
// coding_plan/remains → model_remains[]: one row per model family
// ("general", "video", ...) with interval (e.g. 5h) + weekly percentages.
export async function fetchMinimax() {
  let gid = null;
  try {
    const c = await chrome.cookies.get({ url: 'https://platform.minimax.io/', name: 'minimax_group_id_v2' });
    gid = c?.value || null;
  } catch (e) {
    return { provider: 'minimax', ok: false, error: `cookie read failed: ${e.message}` };
  }
  if (!gid) {
    return { provider: 'minimax', ok: false, error: 'no GroupId cookie — visit platform.minimax.io while logged in' };
  }
  try {
    const res = await fetch(`https://platform.minimax.io/v1/api/openplatform/coding_plan/remains?GroupId=${gid}`, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (!res.ok) return { provider: 'minimax', ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    if (body?.base_resp?.status_code !== 0) {
      return { provider: 'minimax', ok: false, error: body?.base_resp?.status_msg || 'unexpected response' };
    }
    const windows = [];
    for (const m of body.model_remains || []) {
      const name = m.model_name || 'model';
      const intervalLabel = `${name} (${minimaxWindow(m.start_time, m.end_time)})`;
      if (typeof m.current_interval_remaining_percent === 'number') {
        windows.push({
          label: intervalLabel,
          used_pct: 100 - m.current_interval_remaining_percent,
          resets_at: m.end_time ? new Date(m.end_time).toISOString() : null,
        });
      }
      if (typeof m.current_weekly_remaining_percent === 'number') {
        windows.push({
          label: `${name} weekly`,
          used_pct: 100 - m.current_weekly_remaining_percent,
          resets_at: m.weekly_end_time ? new Date(m.weekly_end_time).toISOString() : null,
        });
      }
    }
    if (windows.length === 0) {
      return { provider: 'minimax', ok: false, error: 'no model_remains — no active token plan?' };
    }
    return { provider: 'minimax', ok: true, plan: 'Token Plan', windows };
  } catch (e) {
    return { provider: 'minimax', ok: false, error: e.message };
  }
}

function minimaxWindow(startMs, endMs) {
  if (!startMs || !endMs) return 'interval';
  const hrs = Math.round((endMs - startMs) / 3_600_000);
  return hrs >= 24 ? `${Math.round(hrs / 24)}d` : `${hrs}h`;
}
