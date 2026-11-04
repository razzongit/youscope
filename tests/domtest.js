const { JSDOM } = require('jsdom');
const fs = require('fs');
const APP = process.cwd() + '/';

const dom = new JSDOM('<!doctype html><html><body><div id="host"></div></body></html>', {
  url: 'https://example.test/',   // non-localhost: tests the direct path
  pretendToBeVisual: true,
});
const { window } = dom;
global.window = window;
global.document = window.document;
global.navigator = window.navigator;
global.localStorage = window.localStorage;
global.sessionStorage = window.sessionStorage;
global.TextDecoder = require('util').TextDecoder;
const nodeFetch = globalThis.fetch;

window.fetch = (u, o) => nodeFetch(u, o);
global.fetch = window.fetch;
window.performance = globalThis.performance || { now: () => Date.now() };

function load(file) {
  const code = fs.readFileSync(APP + file, 'utf8');
  // force the browser branch of each UMD wrapper
  const patched = code.replace(
    /if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /,
    ''
  );
  new window.Function(patched).call(window);
}

const files = [
  'engine/takeout.js', 'engine/taxonomy.js', 'engine/analytics.js',
  'engine/correlations.js', 'engine/insights.js', 'engine/ai.js',
  'engine/deep.js', 'web/charts.js', 'web/portrait.js',
];
for (const f of files) {
  try { load(f); console.log('✓', f); }
  catch (e) { console.log('✗', f, '—', e.message); process.exit(1); }
}
console.log('\nYSAI:', !!window.YSAI, '| YSportrait:', !!window.YSportrait, '| YSDeep:', !!window.YSDeep);
module.exports = { window, dom };
