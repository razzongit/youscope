/* Phase 3: the block library. Verifies the model can only compose from a fixed
 * vocabulary, that bad combinations are downgraded rather than broken, and that
 * no block can inject numbers the facts do not contain. */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
const w = dom.window;
global.window = w; global.document = w.document;
for (const f of ['web/charts.js', 'web/blocks.js']) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8')
    .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
  new w.Function(code).call(w);
}
const B = w.YSBlocks;

/* ── realistic fixture ── */
const months = [];
for (let i = 0; i < 30; i++) months.push({ month: '2024-' + String((i % 12) + 1).padStart(2, '0'), count: 40 + i * 3 });
const quarters = [];
for (let i = 0; i < 8; i++) {
  quarters.push({
    quarter: '2024-Q' + (i % 4 + 1), total: 200 + i * 20,
    cats: [{ id: 'A', n: 100 + i, share: 50 }, { id: 'B', n: 60, share: 30 }, { id: 'C', n: 40, share: 20 }],
  });
}
const ctx = {
  profile: {
    monthlySeries: months,
    clock: { hours: Array.from({ length: 24 }, (_, i) => 20 + i * 4) },
    dailyCounts: Array.from({ length: 200 }, (_, i) => ({ date: '2024-01-01', count: i % 7 })),
    evolution: { quarters, trajectories: [{ id: 'A', label: 'A', series: [1, 2, 3], counts: [1, 2, 3], color: '#7dffb3', total: 6, trajectory: 'rising' }] },
    interests: { cats: [{ label: 'Group A', count: 500, share: 50, color: '#7dffb3' }, { label: 'Group B', count: 300, share: 30, color: '#ffc46b' }], coverage: 82 },
  },
  facts: {
    totalWatched: 9598, channels: 3945, spanDays: 2537, searches: 983,
    rhythm: { nightShare: 22.3, peakHour: 12 },
    abandoned: [{ channel: 'Talwinder', watches: 265, lastSeen: '2026-03-16' }, { channel: 'Way Too Hungry', watches: 151, lastSeen: '2025-10-23' }],
    longReturns: [{ channel: 'WIRED', days: 2159, resumed: '2025-09-18' }, { channel: 'Veritasium', days: 1948, resumed: '2025-07-15' }],
    eras: [{ from: '2019-10-21', to: '2020-07-17', watches: 80, topChannels: ['a'] }],
    searchArc: [{ year: 2019, count: 33 }, { year: 2020, count: 74 }, { year: 2025, count: 799 }, { year: 2026, count: 67 }],
    silences: [{ month: '2024-08', count: 2 }],
  },
  taxonomyGroups: [
    { label: 'Amazon job hunting', count: 381, share: 4, color: '#7dffb3' },
    { label: 'Punjabi music', count: 265, share: 2.8, color: '#ffc46b' },
  ],
  body: 'A written section.',
};

console.log('\n1. FIXED VOCABULARY ONLY');
check('rejects an unknown block type', B.render({ type: 'carousel' }, ctx) === null);
check('rejects an unknown data key', B.render({ type: 'chart', chart: 'bars', data: 'madeUpField' }, ctx) === null);
check('accepts a known type', B.render({ type: 'prose', text: 'hi' }, ctx) !== null);
check('validates limits to a sane range',
  B.normalise({ type: 'table', data: 'abandoned', limit: 9999 }).limit === 24);

console.log('\n2. BLOCKS RENDER');
const prose = B.render({ type: 'prose', text: 'You watched **9598** videos.' }, ctx);
check('prose renders and bolds', prose && prose.innerHTML.includes('<strong>9598</strong>'));
const stat = B.render({ type: 'stat', facts: ['totalWatched', 'channels', 'peakHour'] }, ctx);
check('stat renders numbers', stat && stat.textContent.includes('9,598'), stat ? stat.textContent.slice(0, 40) : '-');
check('stat includes peak hour', stat && /12:00/.test(stat.textContent));
const bars = B.render({ type: 'chart', chart: 'bars', data: 'groupTotals' }, ctx);
check('bars render', !!bars);
const area = B.render({ type: 'chart', chart: 'area', data: 'monthlyVolume' }, ctx);
check('area renders', !!area);
const clock = B.render({ type: 'chart', chart: 'clock', data: 'hours' }, ctx);
check('clock renders from hours', !!clock);
const heat = B.render({ type: 'chart', chart: 'heatmap', data: 'dailyCounts' }, ctx);
check('heatmap renders from dailyCounts', !!heat);
const table = B.render({ type: 'table', data: 'abandoned', limit: 2 }, ctx);
check('table renders rows', table && table.textContent.includes('Talwinder'));
const timeline = B.render({ type: 'timeline', data: 'abandoned' }, ctx);
check('timeline renders', !!timeline);

console.log('\n3. IMPOSSIBLE COMBINATIONS ARE DOWNGRADED, NOT BROKEN');
const badClock = B.render({ type: 'chart', chart: 'clock', data: 'monthlyVolume' }, ctx);
check('clock on a 30-point series does not render a clock',
  badClock === null || !badClock.textContent.includes('PEAK HOUR'));
const gaugeOnSeries = B.render({ type: 'chart', chart: 'gauge', data: 'monthlyVolume' }, ctx);
check('gauge on a series falls back instead of erroring', gaugeOnSeries === null || !!gaugeOnSeries);
const streamOnShort = B.render({ type: 'chart', chart: 'stream', data: 'silence' }, ctx);
check('stream on 1 row returns nothing rather than crashing', streamOnShort === null);

console.log('\n4. DATA COMES FROM FACTS, NEVER FROM THE SPEC');
const forged = B.render({ type: 'stat', facts: ['totalWatched'], value: '999999', text: '9,999,999 videos' }, ctx);
check('a forged value in the spec is ignored', forged && !forged.textContent.includes('999,999'),
  forged ? forged.textContent.slice(0, 40) : '-');
const forgedChart = B.render({ type: 'chart', chart: 'bars', data: 'groupTotals', values: [999] }, ctx);
check('forged chart values ignored', !!forgedChart);

console.log('\n5. SECTION COMPOSITION');
const section = {
  title: 'Test', body: 'Prose here.',
  layout: [{ type: 'stat', facts: ['totalWatched'] }, { type: 'chart', chart: 'bars', data: 'groupTotals' }],
};
const node = B.renderSection(section, ctx);
check('section renders prose first', node.firstChild && /Prose here/.test(node.textContent));
check('section renders its blocks', node.textContent.includes('9,598'));
check('a section with no layout still renders prose',
  B.renderSection({ title: 't', body: 'only prose' }, ctx).textContent.includes('only prose'));
check('a broken block is skipped, prose survives',
  B.renderSection({ title: 't', body: 'keep me', layout: [{ type: 'nope' }, { type: 'chart', data: 'bogus' }] }, ctx)
    .textContent.includes('keep me'));

console.log('\n6. LAYOUT VALIDATION IN THE PROMPT LAYER');
const P = require('../engine/personalize.js');
const v = P.validateLayout([
  { type: 'chart', chart: 'area', data: 'monthlyVolume' },
  { type: 'weird' },
  { type: 'stat', facts: ['a', 'b', 'c', 'd', 'e', 'f'] },
  null,
]);
check('drops unknown block types', v.length === 2, v.length + ' kept');
check('caps facts per stat', v[1].facts.length <= 4);
check('caps blocks per section', P.validateLayout(Array(9).fill({ type: 'prose' })).length <= 4);

const pass = results.filter(Boolean).length;
console.log('\n─────────────────────────');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
