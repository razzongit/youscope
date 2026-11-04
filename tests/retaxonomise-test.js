/* Phase 2: recomputing every statistic against the model's taxonomy, so the
 * charts stop being drawn from the preset 22 categories. */
const R = require('../engine/retaxonomise.js');

const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

/* ── build a small synthetic history with three obvious groups ── */
const now = Date.UTC(2026, 0, 1);
const events = [];
function add(channel, n, startMonth) {
  for (let i = 0; i < n; i++) {
    const d = new Date(startMonth);
    d.setUTCMonth(d.getUTCMonth() + Math.floor(i / 4));
    events.push({ channel, title: 'video ' + i, ts: d.getTime(), ad: false });
  }
}
add('GymBro', 80, Date.UTC(2020, 0, 1));
add('ChefRatna', 50, Date.UTC(2022, 0, 1));
add('CoderDaily', 30, Date.UTC(2024, 0, 1));

const data = { watch: events, search: [], subscriptions: [], comments: [], playlists: [], musicLibrary: [] };
const profile = {
  timezone: { offsetMin: 0 },
  counts: { watchEvents: events.length },
};

/* the model's naming of those groups */
const taxonomy = [
  { name: 'Lifting & macros', definition: 'gym programming', weight: 'primary', clusters: [{ channels: ['GymBro'], count: 80 }] },
  { name: 'Home cooking', definition: 'paneer and tiffin', weight: 'secondary', clusters: [{ channels: ['ChefRatna'], count: 50 }] },
  { name: 'Frontend studies', definition: 'react and typescript', weight: 'secondary', clusters: [{ channels: ['CoderDaily'], count: 30 }] },
];

console.log('\n1. INTERESTS ARE THE MODEL\'S GROUPS');
const r = R.build(data, profile, taxonomy);
check('produces the same number of groups', r.interests.cats.length === 3, r.interests.cats.length + ' groups');
check('uses the model\'s names verbatim',
  r.interests.cats.map(c => c.label).sort().join('|') ===
  ['Frontend studies', 'Home cooking', 'Lifting & macros'].sort().join('|'),
  r.interests.cats.map(c => c.label).join(', '));
check('none of the preset category names appear',
  !r.interests.cats.some(c => /Podcasts|Finance|Fitness & Health|Programming & Web Dev/.test(c.label)));
check('carries the model\'s definitions',
  r.interests.cats.find(c => c.label === 'Lifting & macros').definition === 'gym programming');
check('source is marked as ai-taxonomy', r.interests.source === 'ai-taxonomy');

console.log('\n2. SHARES ARE RECOMPUTED, NOT COPIED');
const total = events.length;
const gym = r.interests.cats.find(c => c.label === 'Lifting & macros');
check('share matches the event count', Math.abs(gym.share - (100 * 80 / total)) < 0.5,
  gym.share + '% vs expected ' + (100 * 80 / total).toFixed(1) + '%');
check('counts sum to the total watched', r.interests.cats.reduce((n, c) => n + c.count, 0) === total);
check('coverage is 100% when every channel is named', r.interests.coverage === 100);

console.log('\n3. QUARTERLY EVOLUTION FOLLOWS THE SAME GROUPING');
check('has quarters', r.evolution.quarters.length > 4, r.evolution.quarters.length + ' quarters');
check('quarter categories use model names',
  r.evolution.quarters[0].cats.every(c => taxonomy.some(t => t.name === c.id) || c.id === 'Everything else'));
const gymTraj = r.evolution.trajectories.find(t => t.id === 'Lifting & macros');
check('trajectory exists for each group', !!gymTraj);
check('trajectory series length equals quarters',
  gymTraj.series.length === r.evolution.quarters.length);
check('fading detected for a group that stopped in 2021', gymTraj.trajectory === 'fading' || gymTraj.trajectory === 'faded',
  gymTraj.trajectory);

console.log('\n4. UNMATCHED CHANNELS ARE EXPLICIT');
const data2 = { watch: [...events, { channel: 'RandomUnknown', title: 'x', ts: now, ad: false }], search: [] };
const r2 = R.build(data2, profile, taxonomy);
const leftover = r2.interests.cats.find(c => c.label === 'Everything else');
check('unmatched bucket exists', !!leftover);
check('unmatched is counted, not dropped', leftover.count === 1);
check('coverage reflects it', r2.interests.coverage < 100, r2.interests.coverage + '%');

console.log('\n5. CHART DATA SHAPES MATCH THE EXISTING VIEWS');
check('cats have label/count/share/color',
  r.interests.cats.every(c => 'label' in c && 'count' in c && 'share' in c && 'color' in c));
check('cats have topChannels for the detail cards',
  r.interests.cats.every(c => Array.isArray(c.topChannels)));
check('quarters have {quarter,total,cats}',
  r.evolution.quarters.every(q => 'quarter' in q && 'total' in q && Array.isArray(q.cats)));
check('trajectories have {id,label,series,counts,trajectory}',
  r.evolution.trajectories.every(t => 'id' in t && 'label' in t && 'series' in t && 'counts' in t && 'trajectory' in t));

console.log('\n6. APPLYING TO A PROFILE LEAVES THE ORIGINAL INTACT');
const base = { interests: { cats: [{ label: 'Podcasts & Long-form' }] }, evolution: { quarters: [], trajectories: [] } };
const applied = R.applyToProfile(base, data, taxonomy);
check('returns a new object', applied !== base);
check('original taxonomy untouched', base.interests.cats[0].label === 'Podcasts & Long-form');
check('applied one uses model names', applied.interests.cats[0].label !== 'Podcasts & Long-form');
check('marks the source on the profile', applied.taxonomySource === 'ai-taxonomy');

console.log('\n7. FULL MEMBERSHIP SURVIVES THE CLUSTER SHAPE');
const clusterShaped = [{
  name: 'Everything', definition: '', weight: 'primary',
  clusters: [{
    channels: ['GymBro'],                       // prompt-sized sample
    allChannels: ['GymBro', 'ChefRatna', 'CoderDaily'],  // full membership
  }],
}];
const rFull = R.build(data, profile, clusterShaped);
check('reads allChannels, not just the sample', rFull.interests.coverage === 100,
  rFull.interests.coverage + '% covered');

const pass = results.filter(Boolean).length;
console.log('\n─────────────────────────');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
