import { collectZai } from './zai.mjs';
import { collectClaude } from './claude.mjs';
import { collectCodex } from './codex.mjs';
import { collectOllama } from './ollama.mjs';

export async function collectAll(cfg = {}) {
  const jobs = [
    collectZai({ apiKey: cfg.zaiApiKey }),
    collectClaude({ token: cfg.claudeToken }),
    collectCodex({ authJsonPath: cfg.codexAuthPath }),
    collectOllama({ cookie: cfg.ollamaCookie }),
  ];
  return Promise.all(jobs);
}

export { collectZai, collectClaude, collectCodex, collectOllama };
