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
  return {
    provider: 'zai',
    ok: true,
    plan: body.data.level || null,
    windows: limits.map((lim) => ({
      label: zaiLabel(lim),
      used_pct: typeof lim.percentage === 'number' ? lim.percentage : null,
      usage: lim.usage ?? null,
      remaining: lim.remaining ?? null,
      resets_at: lim.nextResetTime ? new Date(lim.nextResetTime).toISOString() : null,
    })),
  };
}

function zaiLabel(l) {
  const base = l.type === 'TIME_LIMIT' ? 'time'
    : l.type === 'TOKENS_LIMIT' ? 'tokens'
    : String(l.type || 'limit').toLowerCase().replace('_limit', '');
  const hrs = l.nextResetTime ? (l.nextResetTime - Date.now()) / 3_600_000 : null;
  let win = null;
  if (hrs !== null && hrs > 0) {
    if (hrs < 6) win = '5h';
    else if (hrs < 48) win = 'daily';
    else if (hrs < 10 * 24) win = 'weekly';
    else if (hrs < 45 * 24) win = 'monthly';
    else win = 'long';
  }
  return win ? `${base} (${win})` : base;
}
