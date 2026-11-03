/* Verifies the file:// diagnostics: the app must explain the real cause. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const APP = process.cwd() + '/';

// Start from a file:// URL — exactly the double-click case
const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  url: 'file:///home/user/Downloads/youscope/index.html',
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
// localStorage is unavailable on opaque origins (file://) in jsdom and some browsers
const memStore = {};
global.localStorage = {
  getItem: (k) => (k in memStore ? memStore[k] : null),
  setItem: (k, v) => { memStore[k] = String(v); },
  removeItem: (k) => { delete memStore[k]; },
};
window.localStorage = global.localStorage;
global.TextDecoder = require('util').TextDecoder;
window.performance = globalThis.performance || { now: () => Date.now() };

// On file://, fetch to an http origin is blocked by the browser. Emulate that.
window.fetch = async () => { throw new window.TypeError('Failed to fetch'); };
global.fetch = window.fetch;

function load(p) {
  const code = fs.readFileSync(APP + p, 'utf8')
    .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
  new window.Function(code).call(window);
}
['engine/takeout.js', 'engine/taxonomy.js', 'engine/analytics.js', 'engine/correlations.js',
 'engine/insights.js', 'engine/ai.js', 'engine/deep.js', 'web/charts.js', 'web/portrait.js'].forEach(load);

const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

(async () => {
  console.log('\n1. PROTOCOL DETECTION');
  check('isFileProtocol() true on file://', window.YSAI.isFileProtocol() === true);

  const prof = JSON.parse(fs.readFileSync('/tmp/tier-profile.json', 'utf8'));
  const host = window.document.getElementById('host');
  window.YSportrait.render(host, {
    profile: prof.p, insights: prof.insights,
    data: { watch: [], search: [], subscriptions: [], comments: [], playlists: [], musicLibrary: [] },
    aiCfg: {},
  });
  const $ = (s) => host.querySelector(s);

  console.log('\n2. WARNING SHOWN IN UI');
  $('.tier[data-tier="digest"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const panelText = $('[data-f="prog"]') ? host.textContent : '';
  check('file:// warning visible in the form', /opened this from a file/i.test(host.textContent),
    /python3 -m http\.server/.test(host.textContent) ? 'includes the fix command' : 'missing command');

  console.log('\n3. ERROR MESSAGE IS ACTIONABLE');
  $('[data-f="provider"]').value = 'custom';
  $('[data-f="provider"]').dispatchEvent(new window.Event('change', { bubbles: true }));
  $('[data-f="base"]').value = 'https://openrouter.ai/api/v1';
  $('[data-f="model"]').value = 'some/model';
  $('[data-f="key"]').value = 'sk-test';
  $('[data-f="test"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 700));
  const msg = $('[data-f="prog"]').textContent;
  check('explains it is the file:// rule', /file:\/\//i.test(msg) || /opened from a file/i.test(msg), msg.slice(0, 100));
  check('gives a concrete fix', /http\.server|npx serve|localhost/i.test(msg));
  check('does not blame the key', !/invalid key|wrong key/i.test(msg));

  console.log('\n4. NORMALISATION STILL CORRECT ON file://');
  check('strips pasted endpoint', window.YSAI.normalizeBase('https://api.x.com/v1/chat/completions') === 'https://api.x.com/v1');
  check('adds scheme', window.YSAI.normalizeBase('api.x.com/v1') === 'https://api.x.com/v1');

  const passed = results.filter(Boolean).length;
  console.log('\n─────────────────────────');
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
})();
