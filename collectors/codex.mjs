// Codex (ChatGPT plan) usage collector.
// Unofficial endpoint: https://chatgpt.com/backend-api/wham/usage
// Auth: Bearer access_token from ~/.codex/auth.json (written by the codex CLI).
//
// Response shape (observed, plan_type=prolite):
//   {
//     plan_type,
//     rate_limit: { primary_window: {used_percent, limit_window_seconds, reset_at}, secondary_window: {...} },
//     additional_rate_limits: [{ limit_name, rate_limit: {...} }],
//     credits: { balance, has_credits, ... },
//     ...
//   }
// reset_at is unix seconds. limit_window_seconds: 18000=5h, 604800=7d.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export async function collectCodex({ authJsonPath } = {}) {
  const path = authJsonPath || join(homedir(), '.codex', 'auth.json');

  let token;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    token = parsed?.tokens?.access_token || parsed?.access_token;
  } catch (err) {
    return { provider: 'codex', ok: false, error: `could not read ${path}: ${err.message}` };
  }
  if (!token) {
    return { provider: 'codex', ok: false, error: `no access_token in ${path}` };
  }

  let res;
  try {
    res = await fetch(USAGE_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });
  } catch (err) {
    return { provider: 'codex', ok: false, error: `fetch failed: ${err.message}` };
  }

  if (!res.ok) {
    return { provider: 'codex', ok: false, error: `HTTP ${res.status}` };
  }

  const body = await res.json().catch(() => null);
  if (!body) {
    return { provider: 'codex', ok: false, error: 'non-JSON response' };
  }

  const windows = [];
  const primary = body?.rate_limit?.primary_window;
  const secondary = body?.rate_limit?.secondary_window;
  if (primary) windows.push(toWindow('session (5h)', primary));
  if (secondary) windows.push(toWindow('weekly (7d)', secondary));

  for (const extra of body?.additional_rate_limits || []) {
    const p = extra?.rate_limit?.primary_window;
    const s = extra?.rate_limit?.secondary_window;
    const name = extra?.limit_name || 'extra';
    if (p) windows.push(toWindow(`${name} 5h`, p));
    if (s) windows.push(toWindow(`${name} 7d`, s));
  }

  return {
    provider: 'codex',
    ok: true,
    plan: body.plan_type ?? null,
    windows,
    meta: {
      credits_balance: body?.credits?.balance ?? null,
      limit_reached: body?.rate_limit?.limit_reached ?? false,
    },
  };
}

function toWindow(label, w) {
  return {
    label,
    used_pct: w.used_percent ?? null,
    resets_at: w.reset_at ? new Date(w.reset_at * 1000).toISOString() : null,
    window_seconds: w.limit_window_seconds ?? null,
  };
}
