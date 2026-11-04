/* YouScope — facts.js
 * Every verifiable thing that can be computed about an export.
 *
 * Design rule: this file produces FACTS ONLY. It never decides what they mean,
 * never ranks them by importance, never writes a sentence about them. Naming
 * and interpretation belong to the model (personalize.js). Keeping that line
 * clean is what makes the output auditable — any claim in the report can be
 * traced back to a value computed here.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSFacts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const dstr = (ms) => new Date(ms).toISOString().slice(0, 10);
  const mstr = (ms) => new Date(ms).toISOString().slice(0, 7);

  /* Words whose presence in a query suggests a life transition rather than a
   * topic. This is a language heuristic, not a taxonomy of interests. */
  const TRANSITION = /\b(job|jobs|salary|hire|hiring|resign|quit|fired|interview|place|placement|intern|internship|admission|admit|exam|result|fail|backlog|degree|college|university|drop|rent|rented|lease|licen[cs]e|loan|debt|fee|fees|money|broke|shift|relocat|move|visa|marriage|marry|pregnan|hospital|surgery|diagnos)\b/i;

  function build(data, opts) {
    opts = opts || {};
    const watch = (data.watch || []).filter((e) => !e.ad && e.ts);
    const search = (data.search || []).filter((s) => s.ts);
    if (!watch.length) return null;

    watch.sort((a, b) => a.ts - b.ts);
    const first = watch[0].ts;
    const last = watch[watch.length - 1].ts;
    const days = Math.max(1, Math.round((last - first) / DAY) + 1);

    /* tz: use the modal label so hours are local, not UTC */
    let tzMin = 0;
    if (opts.tzOffsetMin !== undefined) tzMin = opts.tzOffsetMin;
    const localHour = (ts) => new Date(ts + tzMin * 60000).getUTCHours();
    const localMonth = (ts) => new Date(ts + tzMin * 60000).toISOString().slice(0, 7);

    /* ── channels: lifetime, gaps, abandonment, returns ─────────── */
    const chMap = new Map();
    for (const e of watch) {
      if (!e.channel) continue;
      const k = String(e.channel).replace(/\s*-\s*Topic$/i, '').trim();
      if (!chMap.has(k)) chMap.set(k, { channel: k, times: [], titles: [] });
      const c = chMap.get(k);
      c.times.push(e.ts);
      if (e.title) c.titles.push(e.title);
    }

    const cutoff = last - 180 * DAY;
    const abandoned = [];
    const longReturns = [];
    const churnByMonth = new Map();

    for (const [name, c] of chMap) {
      c.times.sort((a, b) => a - b);
      const n = c.times.length;
      if (n >= 2) {
        // largest gap followed by a resume
        let bestGap = 0, resumeAt = 0;
        for (let i = 1; i < n; i++) {
          const g = c.times[i] - c.times[i - 1];
          if (g > bestGap) { bestGap = g; resumeAt = c.times[i]; }
        }
        const gapDays = Math.round(bestGap / DAY);
        if (gapDays >= 120 && n >= 3) {
          longReturns.push({ channel: name, days: gapDays, resumed: dstr(resumeAt), watches: n });
        }
      }
      if (n >= 4 && c.times[n - 1] < cutoff) {
        abandoned.push({ channel: name, watches: n, lastSeen: dstr(c.times[n - 1]) });
      }
      // first-seen month = churn
      const fm = localMonth(c.times[0]);
      churnByMonth.set(fm, (churnByMonth.get(fm) || 0) + 1);
    }

    longReturns.sort((a, b) => b.days - a.days);
    abandoned.sort((a, b) => b.watches - a.watches);

    /* ── monthly volume, silences ───────────────────────────────── */
    const monthCount = new Map();
    for (const e of watch) {
      const m = localMonth(e.ts);
      monthCount.set(m, (monthCount.get(m) || 0) + 1);
    }
    const monthList = [...monthCount.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const counts = monthList.map((x) => x[1]);
    const activeMonths = counts.filter((c) => c > 0);
    const median = activeMonths.slice().sort((a, b) => a - b)[Math.floor(activeMonths.length / 2)] || 1;

    // a "silence" is a month at or below 15% of the median
    const silences = monthList
      .filter(([, c]) => c <= Math.max(2, median * 0.15))
      .map(([month, count]) => ({ month, count }))
      .slice(0, 12);

    /* ── rhythm ─────────────────────────────────────────────────── */
    const hours = new Array(24).fill(0);
    const dows = new Array(7).fill(0);
    for (const e of watch) {
      const h = localHour(e.ts);
      hours[h]++;
      dows[new Date(e.ts + tzMin * 60000).getUTCDay()]++;
    }
    const peakHour = hours.indexOf(Math.max(...hours));
    const dowNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    /* ── search arc: how questions changed per year ─────────────── */
    const byYear = new Map();
    for (const s of search) {
      const y = new Date(s.ts + tzMin * 60000).getUTCFullYear();
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(s.query);
    }
    const searchArc = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, qs]) => {
      const transition = qs.filter((q) => TRANSITION.test(q));
      return {
        year,
        count: qs.length,
        transitionQueries: transition.length,
        samples: qs.slice(0, 8),
        transitionSamples: transition.slice(0, 6),
      };
    });

    /* ── title morphology: what shape is the content ───────────── */
    const titles = watch.map((e) => e.title || '').filter(Boolean);
    let shorts = 0, longform = 0, live = 0;
    for (const t of titles) {
      const l = t.toLowerCase();
      if (/#shorts|#short|shortsfeed|ytshorts/.test(l)) shorts++;
      else if (/live|stream|premiere/.test(l)) live++;
      else longform++;
    }

    /* ── volume by cluster-free buckets: just counts, no naming ─── */
    const totalWatched = watch.length;
    const uniqueChannels = chMap.size;

    return {
      /* coverage */
      from: dstr(first),
      to: dstr(last),
      spanDays: days,
      spanYears: +(days / 365.25).toFixed(1),

      /* volume */
      totalWatched,
      channels: uniqueChannels,
      searches: search.length,
      activeMonths: monthCount.size,

      /* shape */
      shape: {
        shorts, live, longform,
        shortsShare: +((100 * shorts) / Math.max(1, titles.length)).toFixed(1),
      },

      /* rhythm */
      rhythm: {
        peakHour,
        nightShare: +((100 * sum(hours.slice(0, 6))) / totalWatched).toFixed(1),
        busiestWeekday: dowNames[dows.indexOf(Math.max(...dows))],
        hours,
      },

      /* movement */
      longReturns: longReturns.slice(0, 12),
      abandoned: abandoned.slice(0, 15),
      silences,
      medianMonthVolume: median,

      /* questions they asked */
      searchArc,
      transitionYears: searchArc.filter((y) => y.transitionQueries > 0)
        .map((y) => ({ year: y.year, count: y.transitionQueries, samples: y.transitionSamples })),

      /* churn: when did new channels appear */
      channelChurn: [...churnByMonth.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([month, n]) => ({ month, newChannels: n })),
    };
  }

  /* Eras: segment the timeline where behaviour changes, using only counts.
   * A boundary is placed where the mix of top channels shifts and monthly
   * volume changes level. No labels — eras are unnamed periods. */
  function eras(facts, watch, opts) {
    opts = opts || {};
    const minEraDays = opts.minEraDays || 120;
    if (!facts) return [];
    const events = (watch || []).filter((e) => !e.ad && e.ts);
    if (events.length < 50) return [];

    events.sort((a, b) => a.ts - b.ts);
    const first = events[0].ts;
    const last = events[events.length - 1].ts;

    // bucket into 90-day windows
    const WINDOW = 90 * DAY;
    const buckets = new Map();
    for (const e of events) {
      const idx = Math.floor((e.ts - first) / WINDOW);
      if (!buckets.has(idx)) buckets.set(idx, { start: first + idx * WINDOW, events: [] });
      buckets.get(idx).events.push(e);
    }
    const series = [...buckets.values()].sort((a, b) => a.start - b.start);
    if (series.length < 3) return [];

    // boundary score: how different is the channel set from the previous window
    const scores = [];
    for (let i = 1; i < series.length; i++) {
      const prev = new Set(series[i - 1].events.map((e) => e.channel).filter(Boolean));
      const cur = new Set(series[i].events.map((e) => e.channel).filter(Boolean));
      let overlap = 0;
      for (const c of cur) if (prev.has(c)) overlap++;
      const turnover = 1 - overlap / Math.max(1, Math.min(prev.size, cur.size));
      const volDelta = Math.abs(series[i].events.length - series[i - 1].events.length) /
        Math.max(1, series[i - 1].events.length);
      scores.push({ i, score: turnover * 0.7 + Math.min(1, volDelta) * 0.3 });
    }

    // take the strongest boundaries, respecting minEraDays
    scores.sort((a, b) => b.score - a.score);
    const chosen = [];
    for (const s of scores) {
      const at = series[s.i].start;
      if (chosen.some((c) => Math.abs(c - at) < minEraDays * DAY)) continue;
      if (s.score < 0.45) continue;
      chosen.push(at);
      if (chosen.length >= 5) break;
    }
    chosen.sort((a, b) => a - b);

    const bounds = [first, ...chosen, last + 1];
    return bounds.slice(0, -1).map((start, idx) => {
      const end = bounds[idx + 1] - 1;
      const inEra = events.filter((e) => e.ts >= start && e.ts <= end);
      const chCount = new Map();
      for (const e of inEra) if (e.channel) chCount.set(e.channel, (chCount.get(e.channel) || 0) + 1);
      const topChannels = [...chCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([c, n]) => `${c} (${n})`);
      const months = Math.max(1, (end - start) / (30 * DAY));
      return {
        from: dstr(start),
        to: dstr(end),
        watches: inEra.length,
        perMonth: +(inEra.length / months).toFixed(1),
        topChannels,
      };
    });
  }

  return { build, eras, TRANSITION };
});
