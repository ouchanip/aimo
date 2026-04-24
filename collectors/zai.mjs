// ZAI (Z.ai) usage collector.
//
// Returns whatever windows the plan exposes (TIME_LIMIT / TOKENS_LIMIT / …).
// Labels are plan-agnostic: we infer the window span from nextResetTime so
// a plan that returns both a 5h and a weekly TIME_LIMIT still differentiates.

const QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';

export async function collectZai({ apiKey } = {}) {
  if (!apiKey) {
    return { provider: 'zai', ok: false, error: 'ZAI_API_KEY not set' };
  }

  let res;
  try {
    res = await fetch(QUOTA_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json',
      },
    });
  } catch (err) {
    return { provider: 'zai', ok: false, error: `fetch failed: ${err.message}` };
  }

  if (!res.ok) {
    return { provider: 'zai', ok: false, error: `HTTP ${res.status}` };
  }

  const body = await res.json();
  if (body.code !== 200 || !body.data) {
    return { provider: 'zai', ok: false, error: body.msg || 'unexpected response shape' };
  }

  const limits = body.data.limits || [];
  const rows = limits.map((lim) => {
    const win = zaiWindow(lim);
    return {
      label: zaiLabel(lim, win),
      used_pct: typeof lim.percentage === 'number' ? lim.percentage : null,
      usage: lim.usage ?? null,
      remaining: lim.remaining ?? null,
      resets_at: lim.nextResetTime ? new Date(lim.nextResetTime).toISOString() : null,
    };
  });
  rows.sort(byResetsAt);
  return {
    provider: 'zai',
    ok: true,
    plan: body.data.level || null,
    windows: rows,
  };
}

// ZAI API type → UI terminology:
//   TOKENS_LIMIT → "Hours Quota" (main LLM quota; window varies by plan)
//   TIME_LIMIT   → "Tool usage" (Web Search / Reader / Zread)
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
