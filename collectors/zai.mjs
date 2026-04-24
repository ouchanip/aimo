// ZAI (Z.ai) usage collector.
// Verified endpoint: returns TIME_LIMIT (5h) and TOKENS_LIMIT (weekly) windows.
// unit values (observed): 3 = days, 5 = hours — mapping confirmed from nextResetTime.

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
      label: lim.type === 'TIME_LIMIT' ? 'session (5h)' : lim.type === 'TOKENS_LIMIT' ? 'weekly (tokens)' : lim.type,
      used_pct: typeof lim.percentage === 'number' ? lim.percentage : null,
      usage: lim.usage ?? null,
      remaining: lim.remaining ?? null,
      resets_at: lim.nextResetTime ? new Date(lim.nextResetTime).toISOString() : null,
    })),
  };
}
