// Ollama Cloud usage collector.
// Ollama has no public JSON API for usage — SSR only. We fetch /settings with the
// __Secure-session cookie and parse the rendered HTML.
//
// Cookie is HttpOnly. Extract manually from DevTools -> Application -> Cookies.

const SETTINGS_URL = 'https://ollama.com/settings';

export async function collectOllama({ cookie } = {}) {
  if (!cookie) {
    return { provider: 'ollama', ok: false, error: 'OLLAMA_SESSION_COOKIE not set' };
  }

  let res;
  try {
    res = await fetch(SETTINGS_URL, {
      headers: {
        'Cookie': `__Secure-session=${cookie}`,
        'Accept': 'text/html',
        'User-Agent': 'usage-monitor/0.1',
      },
      redirect: 'manual',
    });
  } catch (err) {
    return { provider: 'ollama', ok: false, error: `fetch failed: ${err.message}` };
  }

  if (res.status === 302 || res.status === 301) {
    return { provider: 'ollama', ok: false, error: 'redirected to login — cookie expired?' };
  }
  if (!res.ok) {
    return { provider: 'ollama', ok: false, error: `HTTP ${res.status}` };
  }

  const html = await res.text();
  const plainText = htmlToText(html);

  const plan = matchFirst(plainText, /Cloud Usage\s*\n\s*(\w+)/i);
  const sessionBlock = matchPair(
    plainText,
    /Session usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i,
  );
  const weeklyBlock = matchPair(
    plainText,
    /Weekly usage\s*\n\s*([\d.]+)%\s*used\s*\n\s*Resets in\s*([^\n]+)/i,
  );

  if (!sessionBlock && !weeklyBlock) {
    return { provider: 'ollama', ok: false, error: 'could not parse usage block — HTML structure may have changed' };
  }

  return {
    provider: 'ollama',
    ok: true,
    plan: plan ?? null,
    windows: [
      sessionBlock && {
        label: 'session',
        used_pct: parseFloat(sessionBlock[0]),
        resets_in: sessionBlock[1].trim(),
      },
      weeklyBlock && {
        label: 'weekly',
        used_pct: parseFloat(weeklyBlock[0]),
        resets_in: weeklyBlock[1].trim(),
      },
    ].filter(Boolean),
  };
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

function matchFirst(text, re) {
  const m = text.match(re);
  return m ? m[1] : null;
}

function matchPair(text, re) {
  const m = text.match(re);
  return m ? [m[1], m[2]] : null;
}
