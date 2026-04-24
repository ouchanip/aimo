// Resolves configuration from env vars, with Bitwarden CLI fallback for secrets.
// `bw` must be authenticated (BW_SESSION set) for fallback to work.

import { execSync } from 'node:child_process';

export function bwGetPassword(itemName) {
  try {
    const out = execSync(`bw get password ${itemName}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    });
    const trimmed = out.trim();
    return trimmed || null;
  } catch {
    return null;
  }
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
