/* Phase 1: the upload gate. Verifies the AI choice is offered up front with
 * real numbers, defaults sensibly, and degrades to instant without a model. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

function bootApp(url) {
  const dom = new JSDOM('<!doctype html><body></body>', { url });
  const w = dom.window;
  const prev = { window: global.window, document: global.document, fetch: global.fetch };
  global.window = w; global.document = w.document;
  const mem = {};
  global.localStorage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  global.sessionStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  w.localStorage = global.localStorage; w.sessionStorage = global.sessionStorage;
  global.TextDecoder = require('util').TextDecoder;
  w.performance = globalThis.performance || { now: () => Date.now() };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  w.fetch = global.fetch;

  const engine = ['takeout', 'taxonomy', 'analytics', 'correlations', 'insights',
    'openrouter', 'ai', 'deep', 'cluster', 'facts', 'personalize'];
  for (const f of engine) {
    const code = fs.readFileSync(path.join(ROOT, 'engine', f + '.js'), 'utf8')
      .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
    new w.Function(code).call(w);
  }
  for (const f of ['charts', 'settings', 'portrait']) {
    const code = fs.readFileSync(path.join(ROOT, 'web', f + '.js'), 'utf8')
      .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
    new w.Function(code).call(w);
  }
  const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8')
    .replace('window.YouScope = {', 'window.__gate = renderGate; window.__pending = (v) => { S.pending = v; }; window.YouScope = {');
  new w.Function(app).call(w);
  return { w, prev };
}

/* a minimal fixture — the gate only needs counts and filenames */
const fixture = () => {
  const now = Date.now();
  const watch = [];
  for (let i = 0; i < 500; i++) {
    watch.push({ title: 'video ' + i, channel: 'Chan' + (i % 9), ts: now - i * 86400000, ad: false });
  }
  const data = {
    watch, search: [{ query: 'job search', ts: now - 86400000 }],
    subscriptions: [], comments: [], playlists: [], musicLibrary: [],
  };
  const w = global.window;
  const X = w.YSTaxonomy, A = w.YSAnalytics;
  const profile = A.buildProfile(data, X, { now });
  const facts = w.YSFacts.build(data, { tzOffsetMin: 0 });
  if (facts) facts.eras = w.YSFacts.eras(facts, data.watch);
  const clusters = w.YSCluster.build(data.watch, { maxClusters: 10 });
  return { data, profile, facts, clusters, fileName: 'takeout-test.zip' };
};

console.log('\n1. GATE RENDERS WITH REAL NUMBERS');
const { w } = bootApp('http://localhost:7777/');
const f1 = fixture();
w.__pending(f1);
w.__gate();
const d = w.document;
const body = d.body.textContent || '';
check('gate has a Personalised option', !!d.querySelector('#gate-ai'));
check('gate has an Instant option', !!d.querySelector('#gate-instant'));
check('is a two-step flow', /STEP 2 OF 2/i.test(body));
check('shows the filename', body.includes('takeout-test.zip'));
check('shows how many videos were found', /500/.test(body), (body.match(/\d[\d,]* videos/) || [''])[0]);
check('mentions clusters found', /clusters/i.test(body));

console.log('\n2. DEFAULTS WITH A MODEL AVAILABLE');
check('AI selected by default on localhost', d.querySelector('#gate-ai').classList.contains('on'));
check('primary button invites personalising', /Personalise/i.test(d.querySelector('#gate-go').textContent));

console.log('\n3. SWITCHING TO INSTANT');
d.querySelector('#gate-instant').click();
check('instant deselects AI', !d.querySelector('#gate-ai').classList.contains('on'));
check('instant selected', d.querySelector('#gate-instant').classList.contains('on'));
check('button text changes', /dashboard/i.test(d.querySelector('#gate-go').textContent),
  d.querySelector('#gate-go').textContent.trim());

console.log('\n4. WITHOUT A MODEL (file:// origin)');
global.window = undefined;
const b2 = bootApp('https://example.test/');
const f2 = fixture();
b2.w.__pending(f2);
b2.w.__gate();
const d2 = b2.w.document;
check('AI not default without a model', !d2.querySelector('#gate-ai').classList.contains('on'));
check('instant selected instead', d2.querySelector('#gate-instant').classList.contains('on'));
check('explains that a model is needed', /needs a model/i.test(d2.body.textContent || ''));

console.log('\n5. NOTHING IS COMMITTED BEFORE CONTINUE');
check('no profile in state until continue', !b2.w.YouScope.state().profile);

const pass = results.filter(Boolean).length;
console.log('\n─────────────────────────');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
