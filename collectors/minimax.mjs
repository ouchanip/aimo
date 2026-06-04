// MiniMax (Token/Coding Plan) is push-only: the Chrome extension calls
// platform.minimax.io/v1/api/openplatform/coding_plan/remains with the
// browser's own session (HttpOnly cookie auth — an Authorization header
// actually breaks it) and POSTs the parsed result to /ingest/minimax.
// The required ?GroupId= comes from the non-HttpOnly minimax_group_id_v2
// cookie, so the extension needs no manual configuration.
//
// This server-side stub exists only so 'minimax' appears in the merged
// result set — same pattern as collectOpencode().

export async function collectMinimax() {
  return { provider: 'minimax', ok: false, error: 'push-only (provided by extension)' };
}
