#!/usr/bin/env node
// Aggregation CLI — prints usage/limits for ZAI / Claude / Codex / Ollama.
// Usage:
//   node cli.mjs           # pretty table
//   node cli.mjs --json    # raw JSON

import 'dotenv/config';
import { collectAll } from './collectors/index.mjs';
import { resolveConfig } from './lib/env-resolver.mjs';

const asJson = process.argv.includes('--json');

const results = await collectAll(resolveConfig());

if (asJson) {
  process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  process.exit(0);
}

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

for (const r of results) {
  const header = `${CYAN}${r.provider.toUpperCase()}${RESET}`;
  if (!r.ok) {
    console.log(`${header}  ${RED}ERROR${RESET}  ${r.error}`);
    console.log();
    continue;
  }

  const planTag = r.plan ? `${DIM}(${r.plan})${RESET}` : '';
  console.log(`${header}  ${GREEN}ok${RESET}  ${planTag}`);

  if (!r.windows || r.windows.length === 0) {
    console.log(`  ${DIM}no window data${RESET}`);
    if (r.raw) console.log(`  raw: ${JSON.stringify(r.raw).slice(0, 200)}`);
  } else {
    for (const w of r.windows) {
      const pct = w.used_pct == null ? '?' : `${Number(w.used_pct).toFixed(1)}%`;
      const color = w.used_pct == null ? DIM : w.used_pct >= 80 ? RED : w.used_pct >= 50 ? YELLOW : GREEN;
      const bar = makeBar(w.used_pct);
      const reset = w.resets_in ? `resets in ${w.resets_in}` : w.resets_at ? `resets ${fmtResetAt(w.resets_at)}` : '';
      console.log(`  ${w.label.padEnd(22)} ${color}${pct.padStart(6)}${RESET}  ${bar}  ${DIM}${reset}${RESET}`);
    }
  }
  console.log();
}

function makeBar(pct, width = 20) {
  if (pct == null) return DIM + '·'.repeat(width) + RESET;
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width);
  return '█'.repeat(filled) + DIM + '·'.repeat(width - filled) + RESET;
}

function fmtResetAt(iso) {
  try {
    const d = new Date(iso);
    const ms = d - Date.now();
    if (ms < 0) return 'soon';
    const h = Math.round(ms / 3_600_000);
    if (h < 48) return `in ${h}h`;
    return `in ${Math.round(h / 24)}d`;
  } catch {
    return iso;
  }
}
