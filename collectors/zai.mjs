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
  const rows = limits.map((lim) => ({
    base: zaiBase(lim),
    win: zaiWindow(lim),
    used_pct: typeof lim.percentage === 'number' ? lim.percentage : null,
    usage: lim.usage ?? null,
    remaining: lim.remaining ?? null,
    resets_at: lim.nextResetTime ? new Date(lim.nextResetTime).toISOString() : null,
  }));
  const winCounts = {};
  for (const r of rows) if (r.win) winCounts[r.win] = (winCounts[r.win] || 0) + 1;
  return {
    provider: 'zai',
    ok: true,
    plan: body.data.level || null,
    windows: rows.map((r) => ({
      label: r.win
        ? (winCounts[r.win] > 1 ? `${r.win} (${r.base})` : r.win)
        : r.base,
      used_pct: r.used_pct,
      usage: r.usage,
      remaining: r.remaining,
      resets_at: r.resets_at,
    })),
  };
}

function zaiBase(l) {
  return l.type === 'TIME_LIMIT' ? 'time'
    : l.type === 'TOKENS_LIMIT' ? 'tokens'
    : String(l.type || 'limit').toLowerCase().replace('_limit', '');
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
