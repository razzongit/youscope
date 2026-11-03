/* YouScope — correlations.js
 * Finds relationships BETWEEN interest categories that single-category
 * trajectory analysis cannot see. Pure local computation; feeds both the
 * deterministic writer and the AI digest.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSCorrelations = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : 0);

  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 3) return 0;
    const ma = mean(a), mb = mean(b);
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
      const x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    if (da === 0 || db === 0) return 0;
    return num / Math.sqrt(da * db);
  }

  /* Build monthly share series per category, then correlate.
   * Returns strongest +/– pairs, and per-category "companion" findings. */
  function build(profile, taxonomy) {
    const out = { pairs: [], companions: [], splits: [], notes: [] };
    const quarters = profile.evolution.quarters || [];
    if (quarters.length < 5) {
      out.notes.push(`Only ${quarters.length} quarters of data — too few to establish correlation between interests.`);
      return out;
    }

    // share matrix: category → [share per quarter]
    const ids = new Set();
    for (const q of quarters) for (const c of q.cats) ids.add(c.id);
    const matrix = new Map();
    for (const id of ids) {
      matrix.set(id, quarters.map(q => {
        const hit = q.cats.find(c => c.id === id);
        return hit ? hit.share : 0;
      }));
    }
    // only categories with material presence in several quarters
    const totalById = new Map();
    for (const q of quarters) for (const c of q.cats) totalById.set(c.id, (totalById.get(c.id) || 0) + c.n);

    const usable = [...ids].filter(id => {
      const s = matrix.get(id);
      return (totalById.get(id) || 0) >= 40 && s.filter(v => v > 0).length >= Math.ceil(quarters.length * 0.5);
    });

    // pairwise correlation
    const pairs = [];
    for (let i = 0; i < usable.length; i++) {
      for (let j = i + 1; j < usable.length; j++) {
        const a = usable[i], b = usable[j];
        const r = pearson(matrix.get(a), matrix.get(b));
        if (Math.abs(r) >= 0.55) {
          pairs.push({
            a, b, r: +r.toFixed(2),
            aLabel: labelOf(taxonomy, a), bLabel: labelOf(taxonomy, b),
            direction: r > 0 ? 'move together' : 'trade off',
          });
        }
      }
    }
    pairs.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
    out.pairs = pairs.slice(0, 8);

    // per-category strongest companion / opponent
    for (const id of usable) {
      const mine = matrix.get(id);
      let best = null, worst = null;
      for (const other of usable) {
        if (other === id) continue;
        const r = pearson(mine, matrix.get(other));
        if (!best || r > best.r) best = { other, r };
        if (!worst || r < worst.r) worst = { other, r };
      }
      const entry = {
        id, label: labelOf(taxonomy, id),
        risesWith: best && best.r >= 0.55 ? { label: labelOf(taxonomy, best.other), r: +best.r.toFixed(2) } : null,
        fallsAgainst: worst && worst.r <= -0.55 ? { label: labelOf(taxonomy, worst.other), r: +worst.r.toFixed(2) } : null,
      };
      if (entry.risesWith || entry.fallsAgainst) out.companions.push(entry);
    }
    out.companions.sort((a, b) => (Math.abs(b.risesWith?.r || 0) + Math.abs(b.fallsAgainst?.r || 0)) -
                                  (Math.abs(a.risesWith?.r || 0) + Math.abs(a.fallsAgainst?.r || 0)));

    // ── time-of-day splits: what dominates the night vs the morning ──
    out.splits = timeSplits(profile, taxonomy);

    // ── volume vs. breadth: does this person narrow over time? ──
    const breadth = quarters.map(q => q.cats.filter(c => c.share >= 2).length);
    if (quarters.length >= 5) {
      const early = mean(breadth.slice(0, Math.ceil(breadth.length / 2)));
      const late = mean(breadth.slice(-Math.ceil(breadth.length / 2)));
      if (Math.abs(late - early) >= 1) {
        out.notes.push(late < early
          ? `Your interests have narrowed: early quarters touched ${early.toFixed(1)} categories above 2% share, recent ones touch ${late.toFixed(1)}. You are consolidating.`
          : `Your interests have broadened: early quarters touched ${early.toFixed(1)} categories above 2%, recent ones ${late.toFixed(1)}. You are diversifying.`);
      }
    }

    return out;
  }

  function labelOf(taxonomy, id) {
    const m = taxonomy && taxonomy.getCategory ? taxonomy.getCategory(id) : null;
    return m ? m.label : id;
  }

  /* Requires raw events to split by hour band — recomputed from profile.events if present. */
  function timeSplits(profile, taxonomy) {
    const res = [];
    const hw = profile.clock && profile.clock.hourWeekday;
    if (!hw) return res;
    // We only have aggregate hour×weekday counts, so report the shape, not categories.
    const hours = profile.clock.hours;
    const total = sum(hours) || 1;
    const night = sum(hours.slice(0, 6));
    const morning = sum(hours.slice(6, 12));
    const afternoon = sum(hours.slice(12, 18));
    const evening = sum(hours.slice(18, 24));
    res.push({
      band: 'midnight–6am', share: +(100 * night / total).toFixed(1), count: night,
    }, {
      band: '6am–noon', share: +(100 * morning / total).toFixed(1), count: morning,
    }, {
      band: 'noon–6pm', share: +(100 * afternoon / total).toFixed(1), count: afternoon,
    }, {
      band: '6pm–midnight', share: +(100 * evening / total).toFixed(1), count: evening,
    });
    return res;
  }

  /* Category mix per hour band — needs raw events. Called by deep mode only. */
  function categoryByBand(events, taxonomy) {
    const bands = [
      { id: 'night', label: 'midnight–6am', lo: 0, hi: 6 },
      { id: 'morning', label: '6am–noon', lo: 6, hi: 12 },
      { id: 'afternoon', label: 'noon–6pm', lo: 12, hi: 18 },
      { id: 'evening', label: '6pm–midnight', lo: 18, hi: 24 },
    ];
    const tzMin = 330; // events carry UTC ms; hour band uses the profile timezone at call site
    const acc = {};
    for (const b of bands) acc[b.id] = { total: 0, cats: {} };
    for (const e of events) {
      if (!e.ts || e.ad) continue;
      const h = new Date(e.ts + tzMin * 60000).getUTCHours();
      const band = bands.find(b => h >= b.lo && h < b.hi);
      if (!band) continue;
      acc[band.id].total++;
      for (const c of taxonomy.classifyEvent(e)) {
        acc[band.id].cats[c] = (acc[band.id].cats[c] || 0) + 1;
      }
    }
    return bands.map(b => ({
      band: b.label,
      total: acc[b.id].total,
      top: Object.entries(acc[b.id].cats)
        .sort((x, y) => y[1] - x[1]).slice(0, 4)
        .map(([id, n]) => ({
          label: labelOf(taxonomy, id),
          share: acc[b.id].total ? +(100 * n / acc[b.id].total).toFixed(1) : 0,
        })),
    }));
  }

  /* Contradiction / tension finder — things the data implies but doesn't say */
  function tensions(profile) {
    const out = [];
    const cats = profile.interests.cats;
    const byId = Object.fromEntries(cats.map(c => [c.id, c]));

    if (byId['finance-startups'] && byId['fashion-style'] &&
        byId['finance-startups'].share > 3 && byId['fashion-style'].share < 1) {
      out.push('You watch finance and business content at ' + byId['finance-startups'].share +
        '% but style content at only ' + byId['fashion-style'].share +
        '% — you are optimising your money, not how you look.');
    }
    if (byId['fitness-health'] && profile.clock.nightOwlScore > 0.2) {
      out.push('Fitness is ' + byId['fitness-health'].share + '% of your viewing, but ' +
        (profile.clock.nightOwlScore * 100).toFixed(0) +
        '% of your watching happens after midnight — you are researching a body you are not resting.');
    }
    if (byId['self-improvement'] && byId['comedy-entertainment'] &&
        byId['comedy-entertainment'].share > byId['self-improvement'].share * 3) {
      out.push('Self-improvement is ' + byId['self-improvement'].share + '% of your viewing, against ' +
        byId['comedy-entertainment'].share + '% comedy — you watch the plan far more than the practice.');
    }
    if (byId['education-career'] && byId['programming'] &&
        byId['education-career'].share > byId['programming'].share * 1.5) {
      out.push('You consume coursework and career content more than hands-on building — the learning is wider than the doing.');
    }
    const deadRatio = profile.counts.deadLinks / Math.max(1, profile.counts.watchEvents);
    if (deadRatio > 0.04) {
      out.push(Math.round(deadRatio * 100) + '% of your history is now dead links. A meaningful share of what shaped you has been deleted from YouTube entirely.');
    }
    const musicVsVideo = profile.counts.musicPlays / Math.max(1, profile.counts.watchEvents);
    if (musicVsVideo > 0.5) {
      out.push('More than half your activity is music rather than video — YouTube is functioning as your audio player, not your television.');
    }
    return out;
  }

  return { build, categoryByBand, tensions, pearson };
});
