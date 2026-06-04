// Resolves configuration from env vars, with Bitwarden CLI fallback for secrets.
// `bw` must be authenticated (BW_SESSION set) for fallback to work.

import { execFileSync } from 'node:child_process';

// The bw CLI is a Node app that takes ~3s to start (and fail, when the vault
// is locked) — and resolveConfig() runs on every /api/usage request. Without
// caching that pushed the endpoint past the popup's 3s timeout, silently
// downgrading it to direct-fetch results (which lack server-side providers
// like agy). Cache per item; retry failures after a TTL instead of every hit.
const BW_RETRY_MS = 10 * 60 * 1000;
const bwCache = new Map(); // itemName -> { value, fetchedAt }

export function bwGetPassword(itemName) {
  const hit = bwCache.get(itemName);
  if (hit && (hit.value !== null || Date.now() - hit.fetchedAt < BW_RETRY_MS)) {
    return hit.value;
  }
  let value = null;
  try {
    const out = execFileSync('bw', ['get', 'password', itemName], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    value = out.trim() || null;
  } catch {
    value = null;
  }
  bwCache.set(itemName, { value, fetchedAt: Date.now() });
  return value;
}

export function resolveZaiApiKey() {
  return process.env.ZAI_API_KEY || bwGetPassword('zai-api-key');
}

export function resolveConfig() {
  return {
    zaiApiKey: resolveZaiApiKey(),
    claudeToken: process.env.CLAUDE_OAUTH_TOKEN || null,
    codexAuthPath: process.env.CODEX_AUTH_JSON || null,
    ollamaCookie: process.env.OLLAMA_SESSION_COOKIE || null,
  };
}
