/* YouScope — retaxonomise.js
 * Recompute every statistic against the model's taxonomy instead of the
 * preset 22 categories.
 *
 * Why this exists: the AI names the person's interests, but the charts were
 * still drawn from taxonomy.js. That made the personalisation cosmetic — the
 * labels changed and the numbers did not. This module makes the AI's grouping
 * the one the charts actually use.
 *
 * Input:  raw events + the model's taxonomy (each group carrying its clusters,
 *         and each cluster carrying its channel list).
 * Output: the same shape analytics.js produces, so views need no rewrite.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSRetax = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;

  /* Build channel → groupName from the model's taxonomy. */
  /* Accept both shapes:
   *   live run  : [{name, clusters: [{channels: [...]}]}]
   *   saved JSON: [{name, channels: [...], terms: [...]}]
   * Returns channel → group plus a term → group index used as a fallback when
   * the channel list is truncated (a saved report keeps only ~8 per group). */
  function buildIndex(taxonomy) {
    const byChannel = new Map();
    const byTerm = new Map();
    for (const group of taxonomy) {
      const chans = [];
      for (const cluster of (group.clusters || [])) {
        // allChannels is the full membership; channels is the prompt-sized sample.
        chans.push(...(cluster.allChannels || cluster.channels || []));
      }
      chans.push(...(group.allChannels || []));
      chans.push(...(group.channels || []));
      for (const ch of chans) {
        const key = String(ch).replace(/\s*-\s*Topic$/i, '').trim().toLowerCase();
        if (key && !byChannel.has(key)) byChannel.set(key, group.name);
      }
      for (const term of (group.terms || [])) {
        const t = String(term).toLowerCase().trim();
        if (t && !byTerm.has(t)) byTerm.set(t, group.name);
      }
    }
    return { byChannel, byTerm };
  }

  function channelIndex(taxonomy) {
    return buildIndex(taxonomy).byChannel;
  }

  /* Resolve one event to a group: channel first, then title vocabulary. */
  function classifyEvent(e, idx) {
    if (e.channel) {
      const key = String(e.channel).replace(/\s*-\s*Topic$/i, '').trim().toLowerCase();
      if (idx.byChannel.has(key)) return idx.byChannel.get(key);
    }
    if (e.title && idx.byTerm.size) {
      const words = String(e.title).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
      let best = null, bestHits = 0;
      const seen = new Set();
      for (const w of words) {
        if (seen.has(w)) continue;
        seen.add(w);
        const g = idx.byTerm.get(w);
        if (!g) continue;
        // count how many of this group's terms appear in the title
        let hits = 0;
        for (const x of words) if (idx.byTerm.get(x) === g) hits++;
        if (hits > bestHits) { bestHits = hits; best = g; }
      }
      if (best && bestHits >= 2) return best;
    }
    return null;
  }

  /**
   * Recompute interests, quarterly evolution and trajectories under the AI's
   * grouping.
   *
   * @param data     parsed takeout {watch, search, ...}
   * @param profile  the analytics profile (used for timezone + totals)
   * @param taxonomy the model's groups: [{name, definition, weight, clusters:[{channels}]}]
   * @param opts     {tzOffsetMin}
   */
  function build(data, profile, taxonomy, opts) {
    opts = opts || {};
    const tz = opts.tzOffsetMin !== undefined ? opts.tzOffsetMin
      : ((profile.timezone && profile.timezone.offsetMin) || 0);

    const events = (data.watch || []).filter((e) => !e.ad && e.ts);
    const idx = buildIndex(taxonomy);

    // colour per group — deterministic so re-runs look identical
    const palette = ['#7dffb3', '#ffc46b', '#b39dff', '#6fc7ff', '#ff8a65', '#81c784',
      '#f06292', '#ffd54f', '#4fc3f7', '#ba68c8', '#aed581', '#9575cd'];
    const colour = new Map();
    taxonomy.forEach((g, i) => colour.set(g.name, palette[i % palette.length]));

    const UNMATCHED = 'Everything else';

    /* ── interests ─────────────────────────────────────────────── */
    const catCount = new Map();
    const catChannels = new Map();
    let matched = 0;

    for (const e of events) {
      const hit = classifyEvent(e, idx);
      const group = hit || UNMATCHED;
      if (hit) matched++;
      catCount.set(group, (catCount.get(group) || 0) + 1);
      if (e.channel) {
        if (!catChannels.has(group)) catChannels.set(group, new Map());
        const m = catChannels.get(group);
        const name = String(e.channel).replace(/\s*-\s*Topic$/i, '').trim();
        m.set(name, (m.get(name) || 0) + 1);
      }
    }

    const total = events.length || 1;
    const defByName = new Map(taxonomy.map((g) => [g.name, g.definition]));

    const cats = [...catCount.entries()].map(([name, count]) => ({
      id: name,
      label: name,
      definition: defByName.get(name) || '',
      color: colour.get(name) || '#8a9aa8',
      count,
      share: +((100 * count) / total).toFixed(1),
      topChannels: [...(catChannels.get(name) || new Map()).entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([ch, n]) => ({ name: ch, n })),
    })).sort((a, b) => b.count - a.count);

    const interests = {
      cats,
      classified: matched,
      coverage: +((100 * matched) / total).toFixed(1),
      source: 'ai-taxonomy',
    };

    /* ── evolution by quarter ──────────────────────────────────── */
    const byQ = new Map();
    for (const e of events) {
      const d = new Date(e.ts + tz * 60000);
      const q = d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
      if (!byQ.has(q)) byQ.set(q, { total: 0, cats: new Map() });
      const o = byQ.get(q);
      o.total++;
      const hit2 = classifyEvent(e, idx);
      const group = hit2 || UNMATCHED;
      o.cats.set(group, (o.cats.get(group) || 0) + 1);
    }

    const quarters = [...byQ.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([q, o]) => ({
      quarter: q,
      total: o.total,
      cats: [...o.cats.entries()].map(([id, n]) => ({
        id, n, share: +((100 * n) / o.total).toFixed(1),
      })).sort((a, b) => b.n - a.n),
    }));

    /* ── trajectories, same rules as analytics.js ───────────────── */
    const ids = new Set();
    for (const q of quarters) for (const c of q.cats) ids.add(c.id);
    const nQ = quarters.length;
    const trajectories = [...ids].map((id) => {
      const series = quarters.map((q) => {
        const hit = q.cats.find((c) => c.id === id);
        return hit ? hit.share : 0;
      });
      const counts = series.map((s, i) => (s * quarters[i].total) / 100);
      const totalN = Math.round(counts.reduce((a, b) => a + b, 0));
      const active = counts.filter((c) => c > 0).length;
      const firstHalf = counts.slice(0, Math.ceil(nQ / 2)).reduce((a, b) => a + b, 0);
      const secondHalf = counts.slice(Math.floor(nQ / 2)).reduce((a, b) => a + b, 0);

      let trajectory;
      const material = totalN >= 20;
      if (!material) trajectory = 'minor';
      else if (nQ < 5) {
        if (nQ >= 3 && counts[nQ - 1] > counts[0] * 1.8) trajectory = 'rising';
        else if (nQ >= 3 && counts[nQ - 1] * 1.8 < counts[0]) trajectory = 'fading';
        else trajectory = 'steady';
      } else if (active === nQ) trajectory = 'persistent';
      else if (secondHalf > firstHalf * 1.4) trajectory = 'rising';
      else if (secondHalf === 0 && firstHalf > 0) trajectory = 'faded';
      else if (firstHalf > secondHalf * 1.4) trajectory = 'fading';
      else trajectory = 'steady';

      return {
        id, label: id,
        color: colour.get(id) || '#8a9aa8',
        series,
        counts: counts.map((c) => Math.round(c)),
        total: totalN,
        activeQuarters: active,
        trajectory,
      };
    }).sort((a, b) => b.total - a.total);

    return { interests, evolution: { quarters, trajectories }, source: 'ai-taxonomy' };
  }

  /* Convenience: apply the recomputation onto a profile object, returning a
   * new profile so the fixed-taxonomy version stays available for comparison. */
  function applyToProfile(profile, data, taxonomy, opts) {
    const r = build(data, profile, taxonomy, opts);
    return {
      ...profile,
      interests: r.interests,
      evolution: r.evolution,
      taxonomySource: 'ai-taxonomy',
    };
  }

  return { build, applyToProfile, channelIndex, buildIndex, classifyEvent };
});
