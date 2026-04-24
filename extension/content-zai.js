// Injected on https://z.ai/*. Reads the Bearer JWT from localStorage and
// forwards it to the background service worker so fetchZai() can call
// api.z.ai from the extension context without the user pasting an API key.
//
// The token is stored under `z-ai-open-platform-token-production` on z.ai.
// It is a plain JWT (no exp claim observed — appears long-lived).

(function () {
  try {
    const tok = localStorage.getItem('z-ai-open-platform-token-production');
    if (!tok) return;
    chrome.runtime.sendMessage({ type: 'zai:capture-jwt', jwt: tok });
  } catch {
    // localStorage access can fail in rare sandboxed frames — ignore.
  }
})();
