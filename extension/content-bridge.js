// Injected on http://localhost:3030/*.
// Relays refresh requests from the dashboard page to the extension's
// background service worker, which has the cross-origin fetch permissions.

(function () {
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== 'usage-monitor:refresh') return;
    chrome.runtime.sendMessage({ type: 'fetchAll', pushToLocal: true }, (results) => {
      // Optionally echo results back to the page; the dashboard polls /api/usage
      // anyway, so this is informational only.
      window.postMessage({ type: 'usage-monitor:results', results: results || [] }, window.location.origin);
    });
  });
})();
