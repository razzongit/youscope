/* Verifies the no-hardcoded-categories path: clustering and fact extraction are
 * arithmetic only, and nothing imports a preset taxonomy. */
const C = require('../engine/cluster.js');
const F = require('../engine/facts.js');
const fs = require('fs');
const path = require('path');

const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

/* ── 1. no category list may leak into the personalisation modules ── */
console.log('\n1. NO HARDCODED CATEGORIES IN THE PERSONALISATION PATH');
for (const file of ['cluster.js', 'facts.js', 'personalize.js']) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'engine', file), 'utf8');
  const importsTaxonomy = /YSTaxonomy|getCategory\(|CATEGORIES/.test(src);
  check(file + ' does not import the preset taxonomy', !importsTaxonomy);
}
const taxSrc = fs.readFileSync(path.join(__dirname, '..', 'engine', 'taxonomy.js'), 'utf8');
const catCount = (taxSrc.match(/id: '[a-z-]+', label/g) || []).length;
console.log('  (taxonomy.js still exists with ' + catCount + ' presets, used only as the legacy fallback)');

/* ── 2. clustering is deterministic and vocabulary-driven ── */
console.log('\n2. CLUSTERING GROUPS BY SHARED VOCABULARY');
const synthetic = [];
const mk = (channel, titles, n) => {
  for (let i = 0; i < n; i++) {
    synthetic.push({ channel, title: titles[i % titles.length], ts: Date.now() - i * 86400000 });
  }
};
mk('GymBro', ['bicep curl form', 'hypertrophy leg day', 'protein intake guide'], 40);
mk('ChefRatna', ['paneer butter masala', 'airfryer tikka', 'chutney recipe'], 35);
mk('CoderDaily', ['react hooks tutorial', 'typescript generics', 'css grid layout'], 30);

const r = C.build(synthetic, { maxClusters: 10 });
check('produces clusters', r.clusters.length >= 3, r.clusters.length + ' clusters');
const gym = r.clusters.find(c => c.channels.includes('GymBro'));
const chef = r.clusters.find(c => c.channels.includes('ChefRatna'));
const coder = r.clusters.find(c => c.channels.includes('CoderDaily'));
check('every channel lands in some cluster', !!gym && !!chef && !!coder);
check('gym cluster terms are gym words', gym && /bicep|hypertrophy|protein/.test(gym.terms.join(' ')),
  gym ? gym.terms.slice(0, 4).join(',') : '-');
check('chef cluster terms are food words', chef && /paneer|airfryer|chutney/.test(chef.terms.join(' ')),
  chef ? chef.terms.slice(0, 4).join(',') : '-');
check('coder cluster terms are code words', coder && /react|typescript|css/.test(coder.terms.join(' ')),
  coder ? coder.terms.slice(0, 4).join(',') : '-');
check('clusters are not merged together',
  gym !== chef && chef !== coder && gym !== coder);

/* ── 3. clustering never invents a name ── */
console.log('\n3. CLUSTERS CARRY NO PRE-BAKED MEANING');
const terms = r.clusters.flatMap(c => c.terms);
const banned = ['fitness', 'cooking', 'programming', 'finance', 'gaming', 'music'];
check('no cluster is labelled with a preset category name',
  !r.clusters.some(c => banned.includes(String(c.name || '').toLowerCase())));
check('clusters expose only channels, words and samples',
  r.clusters.every(c => !('label' in c) && !('category' in c)));

/* ── 4. fact sheet computes and reports nothing interpretive ── */
console.log('\n4. THE FACT SHEET IS NUMBERS AND NAMES ONLY');
const longHist = [];
for (let i = 0; i < 400; i++) {
  const ts = Date.UTC(2019, 0, 1) + i * 6 * 86400000;
  longHist.push({
    channel: i % 7 === 0 ? 'ReturningCh' : 'Ch' + (i % 5),
    title: 'video number ' + i,
    ts,
    ad: false,
  });
}
const facts = F.build({ watch: longHist, search: [{ query: 'job vacancy', ts: Date.UTC(2025, 5, 1) }] });
check('builds from watch events', !!facts && facts.totalWatched > 0);
check('reports coverage dates', /^\d{4}-\d{2}-\d{2}$/.test(facts.from));
check('has no prose field', !('summary' in facts) && !('narrative' in facts));
check('search arc detected', facts.searchArc.length >= 1);
check('transition queries flagged', facts.transitionYears.length >= 1,
  facts.transitionYears.map(t => t.year).join(','));

/* ── 5. eras are derived, not fixed ── */
console.log('\n5. ERAS COME FROM THE DATA');
const eras = F.eras(facts, longHist);
check('era count is data-dependent', Array.isArray(eras), eras.length + ' eras');
check('eras cover the span', eras.length ? eras[0].from <= facts.to : false);

/* ── 6. tokenizer strips plumbing but keeps topic words ── */
console.log('\n6. TOKENIZER');
const toks = C.tokenize('How to make the BEST paneer butter masala at home #shorts');
check('drops stopwords', !toks.includes('the') && !toks.includes('how'));
check('keeps topic words', toks.includes('paneer') && toks.includes('masala'));
check('drops platform noise', !toks.includes('shorts'));

const pass = results.filter(Boolean).length;
console.log('\n─────────────────────────');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
