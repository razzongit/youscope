/* YouScope — insights.js
 * Deterministic insight generation. Works with zero API keys.
 * Produces the same "core interests / evolution / what this says about you" structure
 * that the AI layer returns, so the UI can render either one identically.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSInsights = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));
  const pct = (n) => n.toFixed(1).replace(/\.0$/, '') + '%';
  const hourWord = (h) => h < 5 ? 'deep night' : h < 8 ? 'early morning' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 20 ? 'evening' : h < 23 ? 'late evening' : 'just before midnight';
  const list = (a) => a.length <= 1 ? (a[0] || '') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  function build(p, opts) {
    opts = opts || {};
    const out = { source: 'deterministic', generatedAt: new Date().toISOString(), sections: [] };

    const C = p.counts, R = p.range, A = p.activity;
    const firstY = new Date(R.first).getUTCFullYear();
    const lastY = new Date(R.last).getUTCFullYear();
    const span = firstY === lastY ? String(firstY) : firstY + '–' + lastY;
    const topCats = p.interests.cats.slice(0, 6);
    const persistent = p.evolution.trajectories.filter(t => t.trajectory === 'persistent').slice(0, 5);
    const rising = p.evolution.trajectories.filter(t => t.trajectory === 'rising').slice(0, 3);
    const fading = p.evolution.trajectories.filter(t => t.trajectory === 'fading' || t.trajectory === 'faded').slice(0, 3);

    // ── 1. Portrait ──
    const hour = p.clock.peakHour;
    const nightPct = p.clock.nightOwlScore * 100;
    const monthName = (ms) => new Date(ms).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const rhythmBits = [`your busiest hour of the day is ${String(hour).padStart(2, '0')}:00 — ${hourWord(hour)} YouTube`];
    if (nightPct > 22) rhythmBits.push(`${pct(nightPct)} of all your watching happens between midnight and 6am`);

    let portrait = `Between ${monthName(R.first)} and ${monthName(R.last)} you watched **${fmt(C.watchEvents)}** videos across ${fmt(C.uniqueChannels)} different channels — roughly ${A.avgPerActiveDay} a day on the ${A.activeDays} days you actually opened YouTube. In that time ${rhythmBits.join(', and ')}.`;
    if (A.longestStreak >= 30) portrait += ` Your longest unbroken run was **${A.longestStreak} days** — this isn't a casual habit, it's a daily ritual.`;
    out.sections.push({ id: 'portrait', title: 'Who the data says you are', body: portrait });

    // ── 2. Core interests ──
    if (topCats.length) {
      const lead = topCats[0];
      let body = `Your centre of gravity is **${lead.label}** — ${pct(lead.share)} of everything you watched, ${fmt(lead.count)} videos.`;
      if (lead.topChannels.length) body += ` Within it you keep returning to ${list(lead.topChannels.slice(0, 3).map(c => '**' + c.name + '**'))}.`;
      const rest = topCats.slice(1, 5);
      if (rest.length) body += ` Around that core sits a second ring: ${list(rest.map(c => c.label + ' (' + pct(c.share) + ')'))}.`;
      if (p.interests.coverage < 85) body += ` The classifier could place ${pct(p.interests.coverage)} of your watch events into a category — the rest is the genuine long tail of one-off curiosity, which is itself a signal: you graze widely rather than staying in a single lane.`;
      out.sections.push({ id: 'core', title: 'Your core interests', body });
    }

    // ── 3. Evolution ──
    {
      let body = '';
      if (rising.length) body += `What's growing: ${list(rising.map(t => '**' + t.label + '**'))}. `;
      if (fading.length) body += `What's cooling off: ${list(fading.map(t => '**' + t.label + '**'))}. `;
      const nQ = p.evolution.quarters.length;
      const material = p.evolution.trajectories.filter(t => t.total >= 20);
      if (nQ < 5) {
        body += `This export only covers ${nQ} quarter${nQ === 1 ? '' : 's'}, which is too short to call anything truly persistent — a longer export is what turns "current" into "core". That said, ${list(material.slice(0, 4).map(t => t.label))} dominate consistently across every quarter present. `;
      } else {
        const pers = p.evolution.trajectories.filter(t => t.trajectory === 'persistent');
        if (pers.length) body += `${pers.length} of ${p.evolution.trajectories.length} categories never dropped out of a single quarter — those are the load-bearing ones: ${list(pers.slice(0, 4).map(t => t.label))}. `;
      }
      // biggest quarter-over-quarter shift
      const qs = p.evolution.quarters;
      if (qs.length >= 4) {
        const early = qs.slice(0, Math.ceil(qs.length / 3));
        const late = qs.slice(-Math.ceil(qs.length / 3));
        const avg = (arr, id) => {
          let n = 0, t = 0;
          for (const q of arr) { const h = q.cats.find(c => c.id === id); if (h) n += h.n; t += q.total; }
          return t ? (100 * n / t) : 0;
        };
        let best = null;
        for (const tr of p.evolution.trajectories) {
          if (tr.total < 30) continue;
          const d = avg(late, tr.id) - avg(early, tr.id);
          if (!best || Math.abs(d) > Math.abs(best.d)) best = { id: tr.id, label: tr.label, d };
        }
        if (best && Math.abs(best.d) > 3) {
          body += ` The single biggest shift across the whole window is **${best.label}**, which moved ${best.d > 0 ? 'up' : 'down'} by ${pct(Math.abs(best.d))} of your watch share between the start and the end of the period.`;
        }
      }
      out.sections.push({ id: 'evolution', title: 'How your interests moved', body: body.trim() });
    }

    // ── 4. Habits & quirks ──
    {
      const bits = [];
      if (p.sessions.longest.length) {
        const s = p.sessions.longest[0];
        bits.push(`Your heaviest single session ran **${s.durationMin} minutes** and ${s.n} videos${s.topChannel ? ', orbiting ' + s.topChannel : ''}`);
      }
      if (p.binges.length) {
        const b = p.binges[0];
        bits.push(`the most concentrated binge was ${b.n} videos of **${b.channel}** inside 24 hours`);
      }
      const threeAm = p.clock.hours[3] || 0;
      if (threeAm >= 20 && threeAm / Math.max(1, p.counts.watchEvents) > 0.02) {
        bits.push(`${threeAm} videos were watched in the 3am hour alone (${(100 * threeAm / p.counts.watchEvents).toFixed(1)}% of everything)`);
      }
      if (C.musicPlays) bits.push(`${fmt(C.musicPlays)} of your plays were music (${pct(100 * C.musicPlays / C.watchEvents)}), with ${list(p.top.musicArtists.slice(0, 3).map(a => a.name))} on repeat`);
      if (p.top.searchTerms.length) bits.push(`your most repeated search was "${p.top.searchTerms[0].name}"`);
      const commentStyle = p.extra.comments;
      if (commentStyle.total) bits.push(`you left ${commentStyle.total} comments averaging ${commentStyle.avgWords} words — ${commentStyle.emojiRatio > 0.5 ? 'you speak in emoji more than sentences' : 'you actually write sentences'}`);
      let body = bits.length ? bits.join('; ') + '.' : '';
      if (body) { body = body.charAt(0).toUpperCase() + body.slice(1); out.sections.push({ id: 'habits', title: 'How you actually use it', body }); }
    }

    // ── 5. What it concludes ──
    {
      const traits = [];
      const catIds = new Set(topCats.map(c => c.id));
      if (catIds.has('programming') || catIds.has('ai-tech')) traits.push('**a builder**, who consumes technical content as raw material rather than entertainment');
      if (catIds.has('finance-startups') || catIds.has('education-career')) traits.push('**an optimiser**, with finance and self-improvement viewing pointed at a future version of yourself');
      if (catIds.has('fitness-health')) traits.push('**a physiology nerd**, researching your own body instead of guessing at the gym');
      if (catIds.has('science-curiosity')) traits.push('**mechanically curious** — you want to know how things work, not just that they do');
      if (catIds.has('podcasts-talks')) traits.push("**a listener**, taking other people's experience second-hand and at length rather than in headlines");
      if (catIds.has('comedy-entertainment')) traits.push('**a comedy-as-decompression** type, leaning Indian observational and roast humour');
      if (catIds.has('music-punjabi')) traits.push('**culturally rooted in your listening**, with Punjabi and Hindi music as a constant backdrop rather than a phase');
      if (catIds.has('food-cooking')) traits.push('**a practical cook** (or an aspirational one), whose food viewing is recipe-shaped rather than food-porn');
      if (catIds.has('travel-vlogs')) traits.push('**restless**, watching travel as aspiration rather than itinerary');
      if (catIds.has('gaming')) traits.push('**a player**, treating YouTube as a second screen — the game is the context, the video is the company');
      if (catIds.has('movies-series')) traits.push('**a story-first watcher**, preferring narrative to information; you finish things');
      if (catIds.has('music-global')) traits.push('**globally tuned in your listening**, with Western pop and hip-hop sitting alongside Indian music rather than replacing it');
      if (catIds.has('tech-gadgets')) traits.push('**a spec-reader**, following hardware closely enough that the reviews are research, not entertainment');
      if (catIds.has('news-politics')) traits.push('**politically engaged**, keeping current enough with Indian public life that it competes with leisure for your attention');
      if (catIds.has('sports-cricket')) traits.push('**a fan with a schedule**, letting live sport set the rhythm of certain evenings');
      if (catIds.has('self-improvement')) traits.push('**self-auditing**, using video as a mirror and a plan rather than a way to pass time');
      if (catIds.has('design-creative')) traits.push('**visually literate**, paying attention to how things are made and presented, not just what they say');
      if (catIds.has('fashion-style')) traits.push('**image-conscious in a considered way**, treating presentation as something to be studied');
      if (catIds.has('life-hacks-diy')) traits.push('**hands-on**, preferring a demonstration you could copy over a description you could read');
      if (catIds.has('cars-auto')) traits.push('**mechanical in your curiosity about machines**, reading vehicles the way other people read people');

      let body = '';
      if (traits.length) {
        const picked = traits.slice(0, 4);
        const joined = picked.length <= 1 ? picked[0]
          : picked.slice(0, -1).join('; ') + '; and ' + picked[picked.length - 1];
        body = `Reading across the signal, this is the attention history of ${joined}. `;
      }
      else body = `The categories are too evenly split to name a single archetype — which is itself the finding: you are a broad grazer rather than a specialist. `;
      // honesty clause: what the data CAN'T say
      body += `What this data cannot tell you: watch history records attention, not agreement or enjoyment. A video you hated and finished looks identical to one you loved. `;
      if (C.deadLinks > 100) body += `About ${fmt(C.deadLinks)} of your entries are dead links — videos that were deleted or made private since you watched them, which quietly removes part of your own past from the record. `;
      if (p.interests.coverage < 90) body += `And ${pct(100 - p.interests.coverage)} of your viewing sits outside any category we recognise — which is where the most personal stuff usually hides.`;
      out.sections.push({ id: 'conclusion', title: 'What it concludes about you', body: body.trim() });
    }

    // ── headline stats for cards ──
    out.headline = {
      topInterest: topCats[0] ? topCats[0].label : '—',
      topInterestShare: topCats[0] ? topCats[0].share : 0,
      persistentCount: p.evolution.trajectories.filter(t => t.trajectory === 'persistent').length,
      peakHour: hour,
    };
    return out;
  }

  /* Build the compact aggregate digest sent to an LLM (privacy: no raw titles beyond top lists) */
  function buildDigest(p) {
    if (!p || !p.range || !p.counts) {
      throw new Error('The profile is incomplete — reload your data. (A digest needs range and counts.)');
    }
    return {
      coverage: {
        from: new Date(p.range.first).toISOString().slice(0, 10),
        to: new Date(p.range.last).toISOString().slice(0, 10),
        days: p.range.days,
      },
      totals: p.counts,
      activity: {
        activeDays: p.activity.activeDays,
        avgPerActiveDay: p.activity.avgPerActiveDay,
        longestStreak: p.activity.longestStreak,
        busiestDay: p.activity.busiestDay,
      },
      rhythm: {
        peakHour: p.clock.peakHour,
        hours: p.clock.hours,
        weekdays: p.clock.weekdays,
        nightShare: p.clock.nightOwlScore,
      },
      interests: p.interests.cats.map(c => ({
        label: c.label, share: c.share, count: c.count,
        topChannels: c.topChannels.slice(0, 4).map(x => x.name),
      })),
      evolution: p.evolution.quarters.map(q => ({
        quarter: q.quarter, total: q.total,
        top: q.cats.slice(0, 5).map(c => ({ id: c.id, share: c.share })),
      })),
      trajectories: p.evolution.trajectories.map(t => ({
        label: t.label, total: t.total, trajectory: t.trajectory,
        shareByQuarter: t.series,
      })),
      topChannels: p.top.channels.slice(0, 25).map(c => ({ name: c.name, count: c.count })),
      topMusicArtists: p.top.musicArtists.slice(0, 12).map(a => ({ name: a.name, count: a.count })),
      topSearches: p.top.searchTerms.slice(0, 20).map(s => s.name),
      searchThemes: p.searchThemes.themes.slice(0, 8).map(t => ({ label: t.label, n: t.n, samples: t.samples.slice(0, 5) })),
      binges: p.binges.slice(0, 6).map(b => ({ channel: b.channel, videos: b.n })),
      longestSessions: p.sessions.longest.slice(0, 5).map(s => ({ minutes: s.durationMin, videos: s.n, channel: s.topChannel })),
      comments: {
        total: p.extra.comments.total,
        avgWords: p.extra.comments.avgWords,
        emojiRatio: p.extra.comments.emojiRatio,
        byYear: p.extra.comments.byYear,
      },
      playlists: p.extra.playlists.map(x => x.title),
      classifierCoverage: p.interests.coverage,
    };
  }

  return { build, buildDigest };
});
