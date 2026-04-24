// Claude (Anthropic) usage collector — push-only from the browser extension.
//
// Claude usage lives at https://claude.ai/api/organizations/{org_id}/usage
// and requires the claude.ai session cookie (HttpOnly, SameSite=Lax). There is
// no clean server-side path without replicating the cookie, so server-side
// collection is intentionally a no-op. The Chrome extension fetches from
// claude.ai using its existing login cookie and POSTs results to /ingest/claude.

export async function collectClaude({ token } = {}) {
  if (token) {
    // If a token is supplied, user may be trying the api.anthropic.com OAuth
    // usage endpoint. That path is unverified here; surface a hint instead of
    // guessing shapes.
    return {
      provider: 'claude',
      ok: false,
      error: 'server-side token path unverified — prefer the Chrome extension (fetches via claude.ai session cookie)',
    };
  }
  return {
    provider: 'claude',
    ok: false,
    error: 'awaiting push from Chrome extension',
  };
}
