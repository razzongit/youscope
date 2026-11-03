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

  // localStorage may be unavailable on opaque origins
  if (!window.localStorage) {
    const mem = {};
    window.localStorage = {
      getItem: (k) => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: (k) => { delete mem[k]; },
    };
  }
  global.localStorage = window.localStorage;
  global.sessionStorage = window.sessionStorage;

  const nodeFetch = globalThis.fetch;
  window.fetch = (u, o) => nodeFetch(u, o);
  window.Headers = globalThis.Headers;
  window.performance = globalThis.performance || { now: () => Date.now() };

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
