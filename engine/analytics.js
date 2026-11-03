/* YouScope — analytics.js
 * Computes all dashboard analytics from parsed Takeout data.
 * Pure functions, runs in browser and Node.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSAnalytics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY = 86400000;

  function isIsoDst(shiftDateStr) {
    // EU DST: last Sunday of March to last Sunday of October
    if (!shiftDateStr) return false;
    const d = new Date(shiftDateStr + 'T12:00:00Z');
    return d.getUTCMonth() > 2 && d.getUTCMonth() < 9;
  }

  function fmtShort(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }

  // ─────────────────────────────────────────────────────────────
  // Core: build a "profile" object with all computed metrics
  // data: { watch, search, subscriptions, comments, playlists, musicLibrary }
  // taxonomy: YSTaxonomy module (required)
  // opts: { now: ms (for "active streak" calc) }
  // ─────────────────────────────────────────────────────────────
  function buildProfile(data, taxonomy, opts) {
    opts = opts || {};
    const X = taxonomy;
    const watch = (data.watch || []).filter(e => !e.ad);
    const music = watch.filter(e => e.product === 'music');
    const videos = watch.filter(e => e.product !== 'music');
    const dated = watch.filter(e => e.ts);
    dated.sort((a, b) => a.ts - b.ts);
    const first = dated.length ? dated[0].ts : null;
    const last = dated.length ? dated[dated.length - 1].ts : null;

    // ── basic counts ──
    const p = {};
    p.counts = {
      watchEvents: watch.length,
      musicPlays: music.length,
      videoWatches: videos.length,
      searches: (data.search || []).length,
      subscriptions: (data.subscriptions || []).length,
      comments: (data.comments || []).length,
      deadLinks: watch.filter(e => !e.title).length,
      adsExcluded: (data.watch || []).filter(e => e.ad).length,
      channels: new Set(watch.map(e => e.channel).filter(Boolean)).size,
      uniqueChannels: new Set(videos.map(e => e.channel).filter(Boolean)).size,
    };

    // ── date range & days ──
    p.range = {
      first, last,
      days: first ? Math.max(1, Math.round((last - first) / DAY) + 1) : 0,
      years: first ? +(Math.abs(last - first) / (365.25 * DAY)).toFixed(1) : 0,
    };

    // ── local-time helper (from tz label on first event, fallback UTC) ──
    const tzTally = new Map();
    for (const e of dated) { if (e.tz) tzTally.set(e.tz, (tzTally.get(e.tz) || 0) + 1); }
    const tzLabel = [...tzTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    let tzOffsetMin = 0;
    if (tzLabel === 'IST') tzOffsetMin = 330;
    else if (tzLabel) {
      const map = { CET: 60, CEST: 120, EST: -300, EDT: -240, PST: -480, PDT: -420,
        BST: 60, GST: 240, JST: 540, KST: 540, AEST: 600, HKT: 480, SGT: 480, MSK: 180 };
      tzOffsetMin = map[tzLabel] || 0;
    }
    p.timezone = { label: tzLabel, offsetMin: tzOffsetMin };

    const localDateKey = (ts) => {
      const d = new Date(ts + tzOffsetMin * 60000);
      return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    };
    const localHour = (ts) => new Date(ts + tzOffsetMin * 60000).getUTCHours();

    // ── daily counts (calendar heatmap source) ──
    const dayMap = new Map();
    for (const e of dated) {
      const k = localDateKey(e.ts);
      dayMap.set(k, (dayMap.get(k) || 0) + 1);
    }
    p.dailyCounts = [...dayMap.entries()].map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date < b.date ? -1 : 1);

    // active days, streaks
    p.activity = {
      activeDays: dayMap.size,
      avgPerActiveDay: dayMap.size ? +(watch.length / dayMap.size).toFixed(1) : 0,
      busiestDay: p.dailyCounts.reduce((a, b) => (b.count > (a ? a.count : -1) ? b : a), null),
      longestStreak: longestStreak(dayMap),
      currentStreak: currentStreak(dayMap, opts.now || Date.now()),
    };

    // ── month series (timeline) ──
    const monthMap = new Map();
    for (const e of dated) {
      const d = new Date(ts_localMs(e.ts, tzOffsetMin));
      const k = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
      monthMap.set(k, (monthMap.get(k) || 0) + 1);
    }
    p.monthlySeries = [...monthMap.entries()].map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month < b.month ? -1 : 1);

    // ── hour-of-day × weekday ──
    const hours = new Array(24).fill(0);
    const weekdays = new Array(7).fill(0);
    const hourWeekday = Array.from({ length: 7 }, () => new Array(24).fill(0));
    for (const e of dated) {
      if (!Number.isFinite(e.ts)) continue;
      const d = new Date(ts_localMs(e.ts, tzOffsetMin));
      const hr = d.getUTCHours(), wd = d.getUTCDay();
      if (!Number.isFinite(hr) || !Number.isFinite(wd)) continue;
      hours[hr]++; weekdays[wd]++;
      hourWeekday[wd][hr]++;
    }
    p.clock = { hours, weekdays, hourWeekday };
    p.clock.peakHour = indexOfMax(hours);
    p.clock.nightOwlScore = +(sum(hours.slice(0, 6)) / watch.length).toFixed(3);
    p.clock.earlyBirdScore = +(sum(hours.slice(5, 9)) / watch.length).toFixed(3);

    // ── sessions / binges ──
    p.sessions = detectSessions(dated, localHour, tzOffsetMin);
    p.binges = findBinges(dated);
    p.deepDives = findDeepDives(watch);

    // ── top lists ──
    p.top = {
      channels: topN(videos, e => e.channel, 50),
      videos: topNTitled(videos, 30),
      musicArtists: topN(music, e => (e.channel || '').replace(/ - Topic$/, ''), 30),
      musicTracks: topNTitled(music, 40),
      searchTerms: topN(data.search || [], s => s.query, 30),
    };

    // ── interest categories ──
    p.interests = computeInterests(watch, X);

    // ── yearly evolution ──
    p.evolution = computeEvolution(watch, X, tzOffsetMin);

    // ── music library / playlists / comments summaries ──
    p.extra = {
      playlists: (data.playlists || []).map(pl => ({ title: pl.title, createdAt: pl.createdAt, updatedAt: pl.updatedAt, visibility: pl.visibility })),
      comments: summarizeComments(data.comments || []),
      musicLibraryArtists: topNArtistsFromLibrary(data.musicLibrary || []),
    };

    // ── curiosity radar (search-based traits) ──
    p.searchThemes = analyzeSearches(data.search || []);

    return p;
  }

  function ts_localMs(ts, offsetMin) { return ts + offsetMin * 60000; }
  function sum(a) { return a.reduce((x, y) => x + y, 0); }
  function indexOfMax(a) { let i = 0; for (let j = 1; j < a.length; j++) if (a[j] > a[i]) i = j; return i; }

  function longestStreak(dayMap) {
    const days = [...dayMap.keys()].sort();
    let best = 0, cur = 0, prev = null;
    for (const k of days) {
      const t = Date.parse(k + 'T00:00:00Z');
      cur = prev !== null && t - prev === DAY ? cur + 1 : 1;
      best = Math.max(best, cur);
      prev = t;
    }
    return best;
  }

  function currentStreak(dayMap, now) {
    // days ending today (local) counting back with no gap
    const today = new Date(now);
    const tk = today.getUTCFullYear() + '-' + String(today.getUTCMonth() + 1).padStart(2, '0') + '-' + String(today.getUTCDate()).padStart(2, '0');
    let streak = 0;
    let t = Date.parse(tk + 'T00:00:00Z');
    // allow streak to end today or yesterday
    if (!dayMap.has(isoKey(t))) t -= DAY;
    while (dayMap.has(isoKey(t))) { streak++; t -= DAY; }
    return streak;
  }
  function isoKey(t) {
    const d = new Date(t);
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }

  function topN(events, keyFn, n) {
    const m = new Map();
    for (const e of events) {
      const k = keyFn(e);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
      .map(([name, count]) => ({ name, count }));
  }

  function topNTitled(events, n) {
    const m = new Map();
    for (const e of events) {
      if (!e.title || !e.titleUrl) continue;
      const vid = (e.titleUrl.match(/[?&]v=([\w-]{6,})/) || [])[1];
      const k = vid || e.title;
      if (!m.has(k)) m.set(k, { title: e.title, url: e.titleUrl, count: 0, channel: e.channel || '' });
      m.get(k).count++;
    }
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);
  }

  function detectSessions(dated, localHour, tzOffsetMin) {
    // group consecutive events within 30 min into sessions
    const sessions = [];
    let cur = null;
    for (const e of dated) {
      if (cur && e.ts - cur.end <= 30 * 60000) {
        cur.end = e.ts; cur.n++;
      } else {
        if (cur) sessions.push(cur);
        cur = { start: e.ts, end: e.ts, n: 1, channels: new Map() };
      }
      if (e.channel && cur) {
        cur.channels.set(e.channel, (cur.channels.get(e.channel) || 0) + 1);
        const best = [...cur.channels.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best) cur.topChannel = best[0];
      }
      cur.title = e.title;
      if (e.channel) cur.lastChannel = e.channel;
    }
    if (cur) sessions.push(cur);
    const ranked = sessions.filter(s => s.n >= 3).sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 12);
    return {
      total: sessions.length,
      medianLength: median(sessions.map(s => s.n)),
      longest: ranked.map(s => ({
        start: s.start, durationMin: Math.round((s.end - s.start) / 60000), n: s.n,
        topChannel: s.topChannel || s.lastChannel || '',
        channelCount: s.channels.size,
        sampleTitle: s.title || '',
      })),
    };
  }

  function median(a) {
    if (!a.length) return 0;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
  }

  function findBinges(dated) {
    // binge = ≥4 watches of same channel within 24h
    const byCh = new Map();
    for (const e of dated) {
      if (!e.channel) continue;
      if (!byCh.has(e.channel)) byCh.set(e.channel, []);
      byCh.get(e.channel).push(e.ts);
    }
    const binges = [];
    for (const [ch, times] of byCh) {
      times.sort((a, b) => a - b);
      let i = 0;
      while (i < times.length) {
        let j = i;
        while (j + 1 < times.length && times[j + 1] - times[i] <= DAY) j++;
        const n = j - i + 1;
        if (n >= 4) binges.push({ channel: ch, n, start: times[i] });
        i = j + 1;
      }
    }
    return binges.sort((a, b) => b.n - a.n).slice(0, 12);
    }

  function findDeepDives(watch) {
    // a "deep dive" = same channel ≥8 total with distinct-day spread ≥5 → dedicated fandom
    const byCh = new Map();
    for (const e of watch) {
      if (!e.channel || e.product === 'music') continue;
      const k = e.channel;
      if (!byCh.has(k)) byCh.set(k, { n: 0, days: new Set() });
      const o = byCh.get(k);
      o.n++; o.days.add(Math.floor(e.ts / DAY));
    }
    return [...byCh.entries()]
      .filter(([ch, o]) => o.n >= 8 && o.days.size >= 5)
      .map(([ch, o]) => ({ channel: ch, watches: o.n, days: o.days.size }))
      .sort((a, b) => b.watches - a.watches)
      .slice(0, 15);
    }

  function computeInterests(watch, X) {
    const catCount = new Map();
    const catChannels = new Map();
    let classified = 0;
    for (const e of watch) {
      const cats = X.classifyEvent(e);
      if (cats.length) classified++;
      for (const c of cats) {
        catCount.set(c, (catCount.get(c) || 0) + 1);
        if (!catChannels.has(c)) catChannels.set(c, new Map());
        if (e.channel) catChannels.get(c).set(e.channel, (catChannels.get(c).get(e.channel) || 0) + 1);
      }
    }
    const total = watch.length || 1;
    const cats = [...catCount.entries()].map(([id, count]) => {
      const meta = X.getCategory(id);
      return {
        id, label: meta ? meta.label : id, color: meta ? meta.color : '#888',
        count, share: +(100 * count / total).toFixed(1),
        topChannels: [...(catChannels.get(id) || new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n })),
      };
    }).sort((a, b) => b.count - a.count);
    return { cats, classified, coverage: +(100 * classified / total).toFixed(1) };
  }

  function computeEvolution(watch, X, tzOffsetMin) {
    // per-quarter interest shares → persistent vs rising vs fading
    const byQ = new Map(); // "2024-Q2" → { total, cats: Map }
    for (const e of watch) {
      if (!e.ts) continue;
      const d = new Date(ts_localMs(e.ts, tzOffsetMin));
      const q = d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
      if (!byQ.has(q)) byQ.set(q, { total: 0, cats: new Map() });
      const o = byQ.get(q);
      o.total++;
      for (const c of X.classifyEvent(e)) o.cats.set(c, (o.cats.get(c) || 0) + 1);
    }
    const quarters = [...byQ.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([q, o]) => ({
      quarter: q,
      total: o.total,
      cats: [...o.cats.entries()].map(([id, n]) => ({ id, n, share: +(100 * n / o.total).toFixed(1) })).sort((a, b) => b.n - a.n),
    }));
    // classify trajectory per category
    const all = new Set();
    for (const q of quarters) for (const c of q.cats) all.add(c.id);
    const trajectories = [];
    const nQ = quarters.length;
    for (const id of all) {
      const series = quarters.map(q => {
        const hit = q.cats.find(c => c.id === id);
        return hit ? hit.share : 0;
      });
      const totals = quarters.map(q => q.total);
      const counts = quarters.map((q, i) => series[i] * totals[i] / 100);
      const firstHalf = sum(counts.slice(0, Math.ceil(nQ / 2)));
      const secondHalf = sum(counts.slice(Math.floor(nQ / 2)));
      const active = counts.filter(c => c > 0).length;
      const meta = X.getCategory(id);
      const total = Math.round(sum(counts));
      // Span-aware trajectory: with few quarters, "persistent" is meaningless —
      // require both persistence AND material presence to earn a label.
      let trajectory;
      const material = total >= 20;
      const shortSpan = nQ < 5;
      if (!material) trajectory = 'minor';
      else if (shortSpan) {
        // can't infer trend from 1-4 quarters; only flag strong movement
        if (nQ >= 3 && counts[nQ - 1] > 0 && counts[0] > 0 && counts[nQ - 1] > counts[0] * 1.8) trajectory = 'rising';
        else if (nQ >= 3 && counts[nQ - 1] * 1.8 < counts[0]) trajectory = 'fading';
        else trajectory = 'steady';
      } else if (active === nQ) trajectory = 'persistent';
      else if (secondHalf > firstHalf * 1.4) trajectory = 'rising';
      else if (secondHalf === 0 && firstHalf > 0) trajectory = 'faded';
      else if (firstHalf > secondHalf * 1.4) trajectory = 'fading';
      else trajectory = 'steady';
      trajectories.push({
        id, label: meta ? meta.label : id, color: meta ? meta.color : '#888',
        series, counts: counts.map(c => Math.round(c)),
        total, activeQuarters: active, trajectory,
      });
    }
    return { quarters, trajectories: trajectories.sort((a, b) => b.total - a.total) };
    }

  function summarizeComments(comments) {
    const byYear = new Map();
    let words = 0, emojis = 0;
    const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
    for (const c of comments) {
      const y = c.createdAt ? c.createdAt.slice(0, 4) : '?';
      byYear.set(y, (byYear.get(y) || 0) + 1);
    }
    for (const c of comments) {
      words += (c.text.match(/\S+/g) || []).length;
      emojis += (c.text.match(emojiRe) || []).length;
    }
    const shortest = comments.reduce((a, c) => (a === null || c.text.length < a.length ? c.text : a), null);
    return {
      total: comments.length, byYear: [...byYear.entries()].sort(),
      avgWords: comments.length ? +(words / comments.length).toFixed(1) : 0,
      emojiRatio: comments.length ? +(emojis / comments.length).toFixed(2) : 0,
      shortest: shortest && shortest.length <= 40 ? shortest : null,
    };
  }

  function topNArtistsFromLibrary(lib) {
    const m = new Map();
    for (const s of lib) {
      const a = s.artists && s.artists[0];
      if (a && !/topic/i.test(a)) m.set(a, (m.get(a) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, n]) => ({ name, songs: n }));
  }

  function analyzeSearches(searches) {
    // cluster searches into themes by keywords
    const themes = [
      { id: 'howto', label: 'How-to & fixes', re: /^(how to|how do|what is|why|fix|repair|remove|get rid|clean|install|setup|make|cook|bake)/i },
      { id: 'learning', label: 'Learning & courses', re: /(tutorial|course|lecture|explained|beginner|roadmap|full course|dsa|python|javascript|react|next\.?js|leetcode)/i },
      { id: 'tech', label: 'Tech & products', re: /(iphone|android|phone|laptop|gpu|review|unboxing|specs|headphone|earbud|watch|nothing|oneplus|samsung|pixel|macbook|keyboard)/i },
      { id: 'food', label: 'Food & recipes', re: /(recipe|cook|food|cake|pizza|bake|chicken|paneer|biryani|restaurant|eat|ice cream|chocolate|coffee|tea)/i },
      { id: 'fitness', label: 'Fitness', re: /(workout|gym|protein|muscle|abs|fitness|exercise|yoga|diet|weight)/i },
      { id: 'music', label: 'Music', re: /(song|lyrics|music|album|remix|cover|audio|spotify|gaana|jiosaavn)/i },
      { id: 'entertainment', label: 'Shows & people', re: /(trailer|movie|film|series|episode|netflix|prime|anime|cast|interview|podcast|roast|comedy)/i },
      { id: 'news', label: 'News & current', re: /(news|election|india|modi|bjp|congress|war|israel|ukraine|stock|market|economy)/i },
    ];
    const counts = {}; const matched = new Map();
    for (const s of searches) {
      const q = (s.query || '').toLowerCase();
      for (const t of themes) {
        if (t.re.test(q)) {
          counts[t.id] = (counts[t.id] || 0) + 1;
          if (!matched.has(t.id)) matched.set(t.id, []);
          if (matched.get(t.id).length < 24) matched.get(t.id).push(s.query);
          break; // first matching theme wins
        }
      }
    }
    const themed = Object.entries(counts).map(([id, n]) => ({
      id, n, label: themes.find(t => t.id === id).label,
      samples: matched.get(id).slice(0, 12),
    })).sort((a, b) => b.n - a.n);
    return { total: searches.length, themes: themed, unmatched: searches.length - sum(Object.values(counts)) };
  }

  return { buildProfile, fmtShort, topN, median, sum };
});
