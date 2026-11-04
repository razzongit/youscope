/* YouScope — cluster.js
 * Groups a person's channels and titles into clusters using arithmetic only.
 *
 * No categories are hardcoded here. Nothing knows what "fitness" or "finance"
 * means. A cluster is just: a set of channels that share vocabulary, sized by
 * how much the person watched them. What to CALL those clusters — and whether
 * they matter — is decided later, by the model, from this person's own data.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSCluster = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* Function words and platform noise. This list is language plumbing, not
   * taste: it exists so "the" and "shorts" do not look like signal. It makes no
   * claim about what the person is interested in. */
  const STOP = new Set(('a an the and or but if then than that this these those is are was were be been being ' +
    'to of in on at for with from by as it its it\'s you your yours we our us they them their he she his her ' +
    'i me my mine do does did doing done have has had having not no nor so such only own same too very can ' +
    'will just don should now what which who whom when where why how all any both each few more most other ' +
    'some there here about into over under again further once during before after above below between out up ' +
    'down off on off why how—also ' +
    /* YouTube/platform vocabulary */
    'video videos shorts short full episode part clip clips live stream highlights official music audio ' +
    'new latest update news hd 4k subscribe channel youtube watch playlist ' +
    /* generic verbs that dominate titles without carrying topic */
    'get got make made making take took taking go going went gone see saw seen know knew known think thought ' +
    'want wanted need needed use used using try tried work works working look looks looked say says said tell ' +
    'told give gave given come came coming put keep kept let thing things way ways time times day days year years ' +
    'people person man woman men women one two three ' +
    /* locale noise from Takeout titles */
    'hindi english india indian full movie song songs').split(/\s+/).filter(Boolean));

  function tokenize(text) {
    if (!text) return [];
    return String(text)
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9\u0900-\u097F\s'-]/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^[-']+|[-']+$/g, ''))
      .filter((w) => w.length >= 3 && w.length <= 30 && !STOP.has(w) && !/^\d+$/.test(w));
  }

  /* Build a term-frequency map for a set of documents. */
  function tf(docs) {
    const m = new Map();
    for (const d of docs) {
      const seen = new Set();
      for (const t of tokenize(d)) {
        m.set(t, (m.get(t) || 0) + 1);
        seen.add(t);
      }
    }
    return m;
  }

  /* Cosine similarity over term maps, weighted by inverse document frequency
   * across the whole corpus so ubiquitous words stop dominating. */
  function similarity(a, b, idf) {
    let dot = 0, na = 0, nb = 0;
    for (const [t, v] of a) {
      const w = v * (idf.get(t) || 1);
      na += w * w;
    }
    for (const [t, v] of b) {
      const w = v * (idf.get(t) || 1);
      nb += w * w;
    }
    const small = a.size < b.size ? a : b;
    const big = a.size < b.size ? b : a;
    for (const [t, v] of small) {
      const ov = big.get(t);
      if (!ov) continue;
      dot += (v * (idf.get(t) || 1)) * (ov * (idf.get(t) || 1));
    }
    if (!na || !nb) return 0;
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  /**
   * Cluster watched events into groups the person would recognise.
   *
   * Strategy: a channel is already a meaningful unit (a creator has a topic).
   * So group by channel first, then merge channels whose vocabularies overlap.
   * That avoids inventing categories and avoids the fragility of clustering
   * raw titles directly.
   *
   * @param {Array} events  watch events: {title, channel, ts}
   * @param {Object} opts   {maxClusters, minClusterSize, mergeThreshold}
   * @returns {{clusters: Array, assigned: number, total: number}}
   */
  function build(events, opts) {
    opts = opts || {};
    const minSize = opts.minClusterSize || 2;
    const mergeThreshold = opts.mergeThreshold !== undefined ? opts.mergeThreshold : 0.34;
    const maxClusters = opts.maxClusters || 18;

    const usable = (events || []).filter((e) => !e.ad && (e.channel || e.title));

    // 1. group by channel
    const byChannel = new Map();
    for (const e of usable) {
      const key = e.channel ? String(e.channel).replace(/\s*-\s*Topic$/i, '').trim() : '(unknown channel)';
      if (!byChannel.has(key)) byChannel.set(key, { channel: key, events: [], titles: [] });
      const g = byChannel.get(key);
      g.events.push(e);
      if (e.title) g.titles.push(e.title);
    }

    const all = [...byChannel.values()].sort((a, b) => b.events.length - a.events.length);
    const groups = all.filter((g) => g.events.length >= minSize);
    const residual = all.filter((g) => g.events.length < minSize);

    if (!groups.length) return { clusters: [], assigned: 0, total: usable.length, residual: usable.length };

    // 2. per-group term vectors + document frequency across groups
    const vecs = groups.map((g) => tf(g.titles.slice(0, 400)));
    const df = new Map();
    for (const v of vecs) {
      for (const t of v.keys()) df.set(t, (df.get(t) || 0) + 1);
    }
    const N = groups.length;
    const idf = new Map();
    for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 0.5)));

    // 3. greedy merge: highest-similarity pairs first
    const parent = groups.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

    const pairs = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const s = similarity(vecs[i], vecs[j], idf);
        if (s >= mergeThreshold) pairs.push({ i, j, s });
      }
    }
    pairs.sort((a, b) => b.s - a.s);
    for (const p of pairs) union(p.i, p.j);

    // 4. collect merged clusters
    const merged = new Map();
    groups.forEach((g, i) => {
      const r = find(i);
      if (!merged.has(r)) merged.set(r, { members: [], events: [], titles: [] });
      const m = merged.get(r);
      m.members.push(g.channel);
      m.events.push(...g.events);
      m.titles.push(...g.titles);
    });

    // 5. rank by volume, cap the count, and describe each with its own top terms
    let clusters = [...merged.values()]
      .sort((a, b) => b.events.length - a.events.length)
      .slice(0, maxClusters);

    const classified = [];
    for (const c of clusters) {
      const v = tf(c.titles.slice(0, 500));
      const terms = [...v.entries()]
        .map(([t, n]) => ({ t, w: n * (idf.get(t) || 1) }))
        .sort((a, b) => b.w - a.w)
        .slice(0, 12)
        .map((x) => x.t);

      const times = c.events.map((e) => e.ts).filter(Boolean).sort((a, b) => a - b);
      const sample = pickSpread(c.titles, 14);

      classified.push({
        channels: c.members.slice(0, 12),   // for the prompt (kept small)
        allChannels: c.members,             // for recomputing statistics
        channelCount: c.members.length,
        count: c.events.length,
        share: +((100 * c.events.length) / usable.length).toFixed(1),
        terms,
        samples: sample,
        first: times.length ? times[0] : null,
        last: times.length ? times[times.length - 1] : null,
      });
    }

    // The long tail is real signal: someone's scattered curiosity. Keep it as
    // one named-later bucket rather than discarding four fifths of the history.
    if (residual.length) {
      const rEvents = [];
      for (const g of residual) rEvents.push(...g.events);
      const rTitles = [];
      for (const g of residual) rTitles.push(...g.titles);
      if (rEvents.length) {
        const v = tf(rTitles.slice(0, 800));
        const terms = [...v.entries()]
          .map(([t, n]) => ({ t, w: n * (idf.get(t) || 1) }))
          .sort((a, b) => b.w - a.w).slice(0, 12).map((x) => x.t);
        const times = rEvents.map((e) => e.ts).filter(Boolean).sort((a, b) => a - b);
        classified.push({
          channels: residual.slice(0, 12).map((g) => g.channel),
          allChannels: residual.map((g) => g.channel),
          channelCount: residual.length,
          count: rEvents.length,
          share: +((100 * rEvents.length) / usable.length).toFixed(1),
          terms,
          samples: pickSpread(rTitles, 14),
          first: times.length ? times[0] : null,
          last: times.length ? times[times.length - 1] : null,
          isResidual: true,
        });
      }
    }

    const assigned = classified.reduce((n, c) => n + c.count, 0);
    return { clusters: classified, assigned, total: usable.length };
  }

  /* Evenly spaced sample so the model sees titles from across the whole span,
   * not just whatever happens to be first. */
  function pickSpread(arr, n) {
    if (!arr.length) return [];
    if (arr.length <= n) return arr.slice();
    const out = [];
    const step = arr.length / n;
    for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

  return { build, tokenize, pickSpread };
});
