// OpenCode Go is push-only: the Chrome extension fetches the workspace console
// with the browser's own opencode.ai session and POSTs to /ingest/opencode.
// (No public usage API; the session cookie must stay in the browser.)
//
// This server-side stub exists only so 'opencode' appears in the merged result
// set — buildMergedResults() maps over collectAll() output and then substitutes
// the pushed cache for PUSH_ONLY providers. See extension/fetchers.js for the
// real fetch + parse.

export async function collectOpencode() {
  return { provider: 'opencode', ok: false, error: 'push-only (provided by extension)' };
}
