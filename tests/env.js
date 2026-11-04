/* Shared jsdom environment for the test suite.
 * Loads engine/ and web/ modules into a browser-like window. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

function ensureWindow(url) {
  const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
    url: url || 'http://localhost:8000/',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  global.window = window;
  global.document = window.document;
  global.navigator = window.navigator;
  global.TextDecoder = require('util').TextDecoder;

  // localStorage throws simply on ACCESS for opaque origins (file://).
  // It must be probed inside try/catch, not just presence-checked.
  let lsObj = null;
  try { lsObj = window.localStorage; } catch (e) { lsObj = null; }
  if (!lsObj) {
    const mem = {};
    lsObj = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    };
    try { window.localStorage = lsObj; } catch (e) { /* read-only on this origin */ }
  }
  global.localStorage = lsObj;
  let ssObj = null;
  try { ssObj = window.sessionStorage; } catch (e) { ssObj = null; }
  if (!ssObj) {
    const mem2 = {};
    ssObj = {
      getItem: (k) => (k in mem2 ? mem2[k] : null),
      setItem: (k, v) => { mem2[k] = String(v); },
      removeItem: (k) => { delete mem2[k]; },
    };
    try { window.sessionStorage = ssObj; } catch (e) {}
  }
  global.sessionStorage = ssObj;

  const nodeFetch = globalThis.fetch;
  // Browsers resolve relative URLs against the page origin; Node does not.
  // Without this, the proxy path (/api/chat) fails in tests only.
  window.fetch = (u, o) => {
    const url = String(u);
    if (url.startsWith('/')) return nodeFetch((global.__TEST_ORIGIN__ || 'http://127.0.0.1:7777') + url, o);
    return nodeFetch(u, o);
  };
  window.Headers = globalThis.Headers;
  window.performance = globalThis.performance || { now: () => Date.now() };

  // Modules call bare `fetch` -> globalThis.fetch. Override it globally so
  // relative /api/* paths resolve like a browser would.
  globalThis.fetch = (u, o) => {
    const url = String(u);
    if (url.startsWith('/')) return nodeFetch((global.__TEST_ORIGIN__ || 'http://127.0.0.1:7777') + url, o);
    return nodeFetch(u, o);
  };

  if (!window.YSAI) {
    const root = path.resolve(__dirname, '..');
    const files = [
      'engine/takeout.js', 'engine/taxonomy.js', 'engine/analytics.js',
      'engine/correlations.js', 'engine/insights.js', 'engine/openrouter.js',
      'engine/ai.js', 'engine/deep.js', 'web/charts.js', 'web/portrait.js',
    ];
    for (const f of files) {
      const code = fs.readFileSync(path.join(root, f), 'utf8')
        .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
      new window.Function(code).call(window);
    }
  }
  return window;
}

module.exports = { ensureWindow };
