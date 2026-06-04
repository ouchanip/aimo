// Antigravity CLI (agy) quota collector.
//
// The agy CLI embeds the same Codeium-style language server as the Antigravity
// IDE and listens on two random loopback ports while a session is running
// (one HTTPS with a self-signed cert, one plain HTTP). Unlike the IDE's
// standalone language_server process, the CLI's endpoint requires NO CSRF
// token — POST {} to GetUserStatus and the full Model Quota panel data
// (cascadeModelConfigData.clientModelConfigs[].quotaInfo) comes back.
//
// Port discovery: `ss -tlnpH` and grep for the "agy" process. If agy is not
// running there is no server, so we report that as a friendly error.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import http from 'node:http';
import https from 'node:https';

const execAsync = promisify(exec);

const RPC_PATH = '/exa.language_server_pb.LanguageServerService/GetUserStatus';

export async function collectAgy() {
  let ports;
  try {
    ports = await findAgyPorts();
  } catch (err) {
    return { provider: 'agy', ok: false, error: `port discovery failed: ${err.message}` };
  }
  if (ports.length === 0) {
    return { provider: 'agy', ok: false, error: 'agy not running — start an agy session to expose quota' };
  }

  let body = null;
  let lastErr = 'no response';
  for (const port of ports) {
    for (const proto of ['https', 'http']) {
      try {
        body = await rpcGetUserStatus(proto, port);
        if (body) break;
      } catch (err) {
        lastErr = err.message;
      }
    }
    if (body) break;
  }
  if (!body) {
    return { provider: 'agy', ok: false, error: `GetUserStatus failed: ${lastErr}` };
  }

  const us = body.userStatus || {};
  const configs = us.cascadeModelConfigData?.clientModelConfigs || [];
  const windows = [];
  for (const c of configs) {
    const q = c.quotaInfo;
    if (!c.label || !q || typeof q.remainingFraction !== 'number') continue;
    windows.push({
      label: c.label,
      used_pct: Math.round((1 - q.remainingFraction) * 1000) / 10,
      resets_at: q.resetTime || null,
    });
  }

  return {
    provider: 'agy',
    ok: true,
    plan: us.planStatus?.planInfo?.planName ?? null,
    windows,
    meta: {
      email: us.email ?? null,
      prompt_credits: us.planStatus?.availablePromptCredits ?? null,
      flow_credits: us.planStatus?.availableFlowCredits ?? null,
    },
  };
}

async function findAgyPorts() {
  const { stdout } = await execAsync('ss -tlnpH 2>/dev/null || true');
  const ports = new Set();
  for (const line of stdout.split('\n')) {
    if (!line.includes('"agy"')) continue;
    const m = line.match(/127\.0\.0\.1:(\d+)/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

// Node's global fetch rejects self-signed certs with no per-request override,
// so use the http/https modules directly. rejectUnauthorized:false is safe
// here: the target is the agy process's own ephemeral self-signed cert on
// 127.0.0.1 (traffic never leaves the host, so there is no MITM surface),
// and the cert is regenerated per session so pinning a CA is not possible.
function rpcGetUserStatus(proto, port) {
  const mod = proto === 'https' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      {
        hostname: '127.0.0.1',
        port,
        path: RPC_PATH,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1' },
        rejectUnauthorized: false,
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('non-JSON response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end(JSON.stringify({}));
  });
}
