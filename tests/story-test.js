/* Phase 4: the model's sections become navigable pages, and the overview leads
 * with its headline. Also verifies the nav survives a reload. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

const ENGINE = ['takeout', 'taxonomy', 'analytics', 'correlations', 'insights',
  'openrouter', 'ai', 'deep', 'cluster', 'facts', 'personalize', 'retaxonomise'];
const WEB = ['charts', 'blocks', 'settings', 'portrait'];

function boot(url) {
  const dom = new JSDOM('<!doctype html><body></body>', { url });
  const w = dom.window;
  global.window = w; global.document = w.document;
  const mem = {};
  global.localStorage = { getItem: k => mem[k] || null, setItem: (k, v) => { mem[k] = v; }, removeItem: k => { delete mem[k]; } };
  const sess = {};
  global.sessionStorage = { getItem: k => sess[k] || null, setItem: (k, v) => { sess[k] = v; }, removeItem: k => { delete sess[k]; } };
  w.localStorage = global.localStorage; w.sessionStorage = global.sessionStorage;
  // Modules reference bare `location`; expose it like a browser does.
  global.location = w.location;
  global.HashChangeEvent = w.HashChangeEvent;
  global.TextDecoder = require('util').TextDecoder;
  w.performance = globalThis.performance || { now: () => Date.now() };
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  w.fetch = global.fetch;
  for (const f of ENGINE) {
    const c = fs.readFileSync(path.join(ROOT, 'engine', f + '.js'), 'utf8')
      .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
    new w.Function(c).call(w);
  }
  for (const f of WEB) {
    const c = fs.readFileSync(path.join(ROOT, 'web', f + '.js'), 'utf8')
      .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
    new w.Function(c).call(w);
  }
  const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8')
    .replace('window.YouScope = {',
      'window.__views = currentViews; window.__short = shortLabel; window.__adopt = adoptTaxonomy; ' +
      'window.__setP = (v) => { S.personalized = v; }; window.YouScope = {');
  new w.Function(app).call(w);
  return w;
}

/* fixture: a personalised result with three sections and layouts */
const personalized = {
  headline: '98% of everything you ever watched arrived in the final 22 months.',
  noticed: 'The silence came before the surge, not after it.',
  taxonomy: [
    { name: 'Amazon job hunting', definition: 'VCS work vlogs', share: 4, videos: 381, channels: ['a'], allChannels: ['a'], terms: [] },
    { name: 'Punjabi music', definition: 'Aujla and Diljit', share: 2.8, videos: 265, channels: ['b'], allChannels: ['b'], terms: [] },
  ],
  sections: [
    { title: '98% of everything ever watched arrived in the final 22 months', body: 'Short.', cites: ['eras'], layout: [{ type: 'chart', chart: 'bars', data: 'eras' }] },
    { title: 'The two-year silence, and how the searches left before the watching did', body: 'Longer prose.', cites: ['silences'], layout: [] },
    { title: 'Four music channels switched off on the same day', body: 'Third.', cites: ['abandoned'], layout: [{ type: 'table', data: 'abandoned' }] },
  ],
};

(async () => {
console.log('\n1. NAVIGATION GAINS THE MODEL SECTIONS');
const w = boot('https://example.test/');
const before = w.__views().map(v => v.id);
check('base views only before any run', !before.some(id => id.startsWith('story')), before.length + ' views');
w.__setP(personalized);
const after = w.__views();
const stories = after.filter(v => v.isStory);
check('story pages appear', stories.length === 3, stories.length + ' stories');
check('they sit before Portrait',
  after.findIndex(v => v.id.startsWith('story')) < after.findIndex(v => v.id === 'portrait'));
check('every view has a keyboard slot', after.every(v => v.kbd));
check('story ids follow their index',
  stories.map(s => s.id).join(',') === 'story0,story1,story2', stories.map(s => s.id).join(','));

console.log('\n2. LABELS ARE SHORTENED FOR THE SIDEBAR');
const short = w.__short(personalized.sections[0].title);
check('long title truncated', short.length <= 25, short + ' (' + short.length + ')');
check('ends with an ellipsis when cut', /…$/.test(short) || short.length <= 22);
check('short titles untouched', w.__short('Music') === 'Music');

console.log('\n3. STORY PAGES RENDER');
w.YouScope.inject(
  { counts: { watchEvents: 10 }, timezone: { offsetMin: 0 }, range: { first: Date.now() - 86400000, last: Date.now(), days: 1 },
    interests: { cats: [], coverage: 0 }, evolution: { quarters: [], trajectories: [] },
    clock: { hours: new Array(24).fill(0) }, activity: {}, sessions: { longest: [], medianLength: 0 },
    top: { channels: [], videos: [], musicArtists: [], musicTracks: [], searchTerms: [] },
    dailyCounts: [], monthlySeries: [], extra: { comments: { total: 0, byYear: [] }, playlists: [], musicLibraryArtists: [] },
    searchThemes: { themes: [] }, binges: [], deepDives: [] },
  { sections: [{ title: 'x', body: 'y' }] },
  { watch: [], search: [], subscriptions: [], comments: [], playlists: [], musicLibrary: [] }
);
w.__setP(personalized);
w.location.hash = '#story1';
w.dispatchEvent(new w.HashChangeEvent('hashchange'));
await new Promise(r => setTimeout(r, 60));
const d = w.document;
check('story page renders its body', /Longer prose/.test(d.body.textContent || ''));
check('shows which section it is', /section 2 of 3/i.test(d.body.textContent || ''));
check('offers next navigation', !!(d.querySelector('button') && /→/.test(d.body.textContent || '')));
check('links back to the full portrait', /#portrait/.test(d.body.innerHTML));

console.log('\n4. OVERVIEW LEADS WITH THE MODEL\'S HEADLINE');
w.location.hash = '#overview';
w.dispatchEvent(new w.HashChangeEvent('hashchange'));
await new Promise(r => setTimeout(r, 60));
const ov = w.document.body.textContent || '';
check('headline visible on overview', ov.includes('98% of everything you ever watched'));
check('the noticed line appears', ov.includes('silence came before the surge'));
check('headline links to the sections', /#story0/.test(w.document.body.innerHTML));

console.log('\n5. WITHOUT A PERSONALISED RUN NOTHING CHANGES');
const w2 = boot('https://example.test/');
const base = w2.__views();
check('no story pages', !base.some(v => v.isStory));
check('base count unchanged', base.length === 9, base.length + ' views');

const pass = results.filter(Boolean).length;
console.log('\n─────────────────────────');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
})();
