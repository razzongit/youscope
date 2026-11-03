/* YouScope — deep.js
 * Two AI modes:
 *   DIGEST  (cheap) — one call, aggregate summary only.
 *   FULL    (personalised) — map-reduce over the person's OWN categories,
 *             sampling their real video titles per interest, then a synthesis
 *             pass. Costs a few calls; only ever runs when the user opts in.
 *
 * Privacy: FULL mode sends video TITLES the user actually watched (grouped by
 * interest). That is materially more revealing than the digest, so the UI
 * warns explicitly and shows exactly what will be sent before it goes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSDeep = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ── Build the sampling plan: per category, the videos that represent it ── */
  function buildSamples(data, profile, taxonomy, opts) {
    opts = opts || {};
    const perCat = opts.perCategory || 24;
    const maxCats = opts.maxCategories || 12;
    const events = (data.watch || []).filter(e => !e.ad && e.title);
    if (!events.length) return { categories: [], totals: {} };

    // Full density: one event per session (history gives ~1 entry per watch session),
    // so volume is preserved but repetition is not.
    const perCatEvents = new Map();
    for (const e of events) {
      const cats = taxonomy.classifyEvent(e);
      for (const c of cats) {
        if (!perCatEvents.has(c)) perCatEvents.set(c, []);
        perCatEvents.get(c).push(e);
      }
    }

    const ranked = profile.interests.cats.filter(c => perCatEvents.has(c.id));
    const out = [];
    for (const cat of ranked.slice(0, maxCats)) {
      const all = perCatEvents.get(cat.id);
      // Sample across time: bucket by quarter, take evenly, so we capture drift
      const byQ = new Map();
      for (const e of all) {
        if (!e.ts) continue;
        const d = new Date(e.ts);
        const q = d.getUTCFullYear() + 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
        if (!byQ.has(q)) byQ.set(q, []);
        byQ.get(q).push(e);
      }
      const quarters = [...byQ.keys()].sort();
      const picked = [];
      if (quarters.length) {
        // Allocate the budget across quarters proportionally, minimum 1 each,
        // then take evenly-spaced samples inside each quarter.
        const perQ = Math.max(1, Math.floor(perCat / quarters.length));
        for (const q of quarters) {
          if (picked.length >= perCat) break;
          const bucket = byQ.get(q);
          const want = Math.min(perQ, perCat - picked.length, bucket.length);
          const step = bucket.length / want;
          for (let i = 0; i < want; i++) {
            picked.push(bucket[Math.min(bucket.length - 1, Math.floor(i * step))]);
          }
        }
        // top up if quarters were sparse
        if (picked.length < perCat) {
          const step = Math.max(1, Math.floor(all.length / perCat));
          for (let i = 0; i < all.length && picked.length < perCat; i += step) picked.push(all[i]);
        }
      } else {
        const step = Math.max(1, Math.floor(all.length / perCat));
        for (let i = 0; i < all.length && picked.length < perCat; i += step) picked.push(all[i]);
      }
      // dedupe by title, keep order
      const seen = new Set();
      const titles = [];
      for (const e of picked) {
        const t = cleanTitle(e.title);
        if (!t || seen.has(t)) continue;
        seen.add(t);
        titles.push({ t, ch: e.channel ? cleanChannel(e.channel) : '', q: e.ts ? quarterOf(e.ts) : '' });
        if (titles.length >= perCat) break;
      }
      // dominant channels within this category
      const chCount = new Map();
      for (const e of all) { if (e.channel) chCount.set(e.channel, (chCount.get(e.channel) || 0) + 1); }
      const topCh = [...chCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([name, n]) => ({ name: cleanChannel(name), n }));

      out.push({
        id: cat.id, label: cat.label, share: cat.share, count: cat.count,
        trajectory: (profile.evolution.trajectories.find(t => t.id === cat.id) || {}).trajectory || 'unknown',
        topChannels: topCh,
        titles,
      });
    }
    return { categories: out, sourceEvents: events.length };
  }

  function cleanTitle(t) {
    if (!t) return '';
    return String(t)
      .replace(/\s*#\w+/g, '')            // strip hashtag spam
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
  }
  function cleanChannel(c) {
    return String(c || '').replace(/\s*-\s*Topic$/, '').trim();
  }
  function quarterOf(ts) {
    const d = new Date(ts);
    return d.getUTCFullYear() + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
  }

  /* ── Prompt for a single category ── */
  function categoryPrompt(cat, profile) {
    const titles = cat.titles.slice(0, 24).map(x => `- ${x.t}${x.ch ? ' [' + x.ch + ']' : ''}`).join('\n');
    return `You are analysing ONE interest of a real person, from the actual videos they watched.

INTEREST: ${cat.label}
SHARE OF THEIR TOTAL VIEWING: ${cat.share}% (${cat.count} videos)
LONG-TERM TRAJECTORY: ${cat.trajectory}
CHANNELS THEY RETURN TO: ${cat.topChannels.map(c => c.name + ' (' + c.n + ')').join(', ') || 'varied'}

A SAMPLE OF ${cat.titles.length} VIDEOS THEY ACTUALLY WATCHED (across different periods):
${titles}

Write a JSON object describing what this specific interest MEANS for this person. Do not describe the category in general — describe the pattern visible in these particular videos.

{
  "essence": "1-2 sentences: what is this person actually getting from this? Be concrete about the specific sub-topics visible in the titles, not the category name.",
  "subthemes": [
    { "name": "a specific recurring sub-topic visible in the titles", "evidence": "2-4 words quoting the nature of the titles" }
  ],
  "gravitation": "one sentence on what draws them back — is it utility, identity, aspiration, comfort, or curiosity, and why do you think so",
  "tension": "one sentence on a contradiction or unresolved pull visible in this interest, or null if none",
  "changed": "one sentence on how this shifted across the sample, or null if it looks static"
}

Rules:
- Ground every claim in the actual titles or channel names above.
- Use specific words from the titles (e.g. "acne", "Termux", "Roohafza"), not generic labels.
- 2-4 subthemes. Fewer is fine if the signal is weak.
- JSON only, no markdown fences.`;
  }

  /* ── Synthesis prompt across all categories ── */
  function synthesisPrompt(samples, profile, correlations) {
    const catSummaries = samples.categories.map(c => ({
      interest: c.label,
      share: c.share,
      trajectory: c.trajectory,
      essence: c.analysis ? c.analysis.essence : '',
      subthemes: c.analysis ? (c.analysis.subthemes || []).map(s => s.name) : [],
      tension: c.analysis ? c.analysis.tension : null,
    }));

    const stats = {
      from: new Date(profile.range.first).toISOString().slice(0, 10),
      to: new Date(profile.range.last).toISOString().slice(0, 10),
      watchEvents: profile.counts.watchEvents,
      channels: profile.counts.uniqueChannels,
      peakHour: profile.clock.peakHour,
      nightShare: +(profile.clock.nightOwlScore * 100).toFixed(0),
      longestStreak: profile.activity.longestStreak,
      searchThemes: profile.searchThemes.themes.slice(0, 6).map(t => t.label + ' (' + t.n + ')'),
      topSearches: profile.top.searchTerms.slice(0, 10).map(s => s.name),
    };

    return `You are writing the final portrait of a real person from a deep analysis of what they watched.

STATISTICS:
${JSON.stringify(stats, null, 1)}

PER-INTEREST ANALYSIS (already done, from their actual videos):
${JSON.stringify(catSummaries, null, 1)}

CROSS-INTEREST FINDINGS (statistical correlations across quarters):
${JSON.stringify(correlations.pairs.slice(0, 6), null, 1)}

TIME OF DAY:
${correlations.splits.map(s => s.band + ': ' + s.share + '%').join(', ')}

TENSIONS ALREADY DETECTED:
${(correlations.tensions || []).join('\n') || '(none detected)'}

Write the deepest honest portrait you can. This is not a horoscope — it is an inference from behaviour.

{
  "archetype": "2-4 words naming this person's pattern, e.g. 'The Deliberate Generalist'",
  "tagline": "one sentence under 20 words capturing them",
  "sections": [
    { "title": "The through-line", "body": "2-4 sentences. What single drive connects their most different interests? Ground it in specifics from the subthemes." },
    { "title": "How the pieces fit together", "body": "2-4 sentences drawing on the correlations — what moves together, what trades off, and what that implies." },
    { "title": "The shape of their days", "body": "2-3 sentences on the time-of-day split and what it says about when they are consuming vs. doing." },
    { "title": "What they are working toward", "body": "2-3 sentences on the future implied by their viewing, or honestly say if no direction is visible." },
    { "title": "The blind spot", "body": "2-3 sentences: what is conspicuously absent, or what tension they are avoiding. Be direct but not cruel." }
  ],
  "keywords": ["6-10 short tags drawn from their actual subthemes, not category names"],
  "confidence": "high | medium | low — and one clause saying why"
}

Rules:
- Every claim must trace to the subthemes, correlations, or statistics above.
- Do not moralise about screen time or productivity.
- Do not invent interests not present in the data.
- Where evidence is thin, say so rather than filling the gap.
- Write in second person.
- JSON only.`;
  }

  /* ── Orchestrator ── */
  async function analyzeFull(data, profile, taxonomy, correlations, cfg, hooks) {
    hooks = hooks || {};
    const onStage = hooks.onStage || (() => {});
    const onCategory = hooks.onCategory || (() => {});
    const ai = (typeof YSAI !== 'undefined' ? YSAI : null)
      || (typeof window !== 'undefined' && window.YSAI)
      || (typeof require === 'function' ? require('./ai.js') : null)
      || (typeof global !== 'undefined' ? global.YSAI : null);
    if (!ai) throw new Error('AI module not available.');

    const samples = buildSamples(data, profile, taxonomy, {
      perCategory: hooks.perCategory || 24,
      maxCategories: hooks.maxCategories || 12,
    });
    if (!samples.categories.length) throw new Error('No categories with enough data to analyse.');

    let stoppedEarly = null;
    onStage('Analysing ' + samples.categories.length + ' interests from your actual videos');

    // MAP: one call per category, small context each.
    // Free tiers rate-limit hard (often 10-20 req/min), so space the calls out.
    // The delay is configurable and skipped entirely for local endpoints.
    const gap = hooks.delayMs !== undefined ? hooks.delayMs
      : /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(String(cfg.baseUrl || '')) ? 0
      : 1200;
    for (let i = 0; i < samples.categories.length; i++) {
      const cat = samples.categories[i];
      onCategory(i + 1, samples.categories.length, cat.label);
      if (i > 0 && gap > 0) await new Promise(r => setTimeout(r, gap));
      try {
        const res = await ai.chat(cfg, [
          { role: 'system', content: 'You are a precise behavioural analyst. Output JSON only.' },
          { role: 'user', content: categoryPrompt(cat, profile) },
        ], { json: true, maxTokens: 700, temperature: 0.5 });
        const parsed = ai.extractJson(res.content);
        cat.analysis = parsed || null;
        cat.error = parsed ? null : 'unparseable response';
      } catch (e) {
        cat.error = e.message;
        cat.analysis = null;
        if (/429|rate limit/i.test(e.message)) {
          // Honour Retry-After when OpenRouter provides it; otherwise use a
          // conservative default. Free models are capped per minute, so a
          // short retry usually succeeds.
          const waitMs = (e.retryAfterMs && e.retryAfterMs > 0) ? e.retryAfterMs : 6000;
          onStage('Rate limited — waiting ' + Math.ceil(waitMs / 1000) + 's and retrying once');
          await new Promise(r => setTimeout(r, waitMs));
          try {
            const res2 = await ai.chat(cfg, [
              { role: 'system', content: 'You are a precise behavioural analyst. Output JSON only.' },
              { role: 'user', content: categoryPrompt(cat, profile) },
            ], { json: true, maxTokens: 700, temperature: 0.5 });
            const p2 = ai.extractJson(res2.content);
            if (p2) { cat.analysis = p2; cat.error = null; continue; }
          } catch (e2) { /* fall through to stopping */ }
          onStage('Still rate limited — stopping rather than burning your quota');
          stoppedEarly = { reason: 'rate-limit', at: i + 1, message: e.message };
          break;
        }
      }
    }

    const analysed = samples.categories.filter(c => c.analysis);
    if (!analysed.length) {
      const firstErr = samples.categories.find(c => c.error);
      throw new Error('Every category analysis failed. ' + (firstErr ? firstErr.error : ''));
    }

    // REDUCE: one synthesis call
    onStage('Synthesising the portrait from ' + analysed.length + ' analyses');
    let portrait = null;
    let synthError = null;
    try {
      portrait = await synthPass(ai, cfg, samples, profile, correlations);
    } catch (e) {
      synthError = e.message;
    }
    if (!portrait) {
      // Never discard the per-interest work: degrade to a local portrait instead.
      portrait = localFallback(samples, profile, correlations, synthError);
    }
    portrait.source = 'ai-full';
    portrait.model = portrait.model || (cfg.model || '');
    if (stoppedEarly && analysed.length < samples.categories.length) {
      portrait.confidence = (portrait.confidence ? portrait.confidence + ' · ' : '') +
        `partial — rate limited after ${analysed.length} of ${samples.categories.length} interests`;
    }
    portrait.categories = samples.categories.map(c => ({
      label: c.label, share: c.share, trajectory: c.trajectory,
      analysis: c.analysis, error: c.error, titlesSampled: c.titles.length,
    }));
    portrait.stats = {
      categoriesAnalysed: analysed.length,
      categoriesTotal: samples.categories.length,
      titlesSent: samples.categories.reduce((s2, c) => s2 + c.titles.length, 0),
      sourceEvents: samples.sourceEvents,
      synthesisDegraded: !!synthError,
      stoppedEarly: stoppedEarly || null,
      synthesisError: synthError,
      partial: analysed.length < samples.categories.length,
    };
    return portrait;
  }

  async function synthPass(ai, cfg, samples, profile, correlations) {
    const syn = await ai.chat(cfg, [
      { role: 'system', content: 'You are a sharp, honest portrait writer. Output JSON only.' },
      { role: 'user', content: synthesisPrompt(samples, profile, correlations) },
    ], { json: true, maxTokens: 2000, temperature: 0.65 });

    let portrait = ai.extractJson(syn.content);
    if (!portrait) {
      const retry = await ai.chat(cfg, [
        { role: 'system', content: 'Output valid JSON only, no fences.' },
        { role: 'user', content: synthesisPrompt(samples, profile, correlations) },
      ], { json: true, maxTokens: 2000 });
      portrait = ai.extractJson(retry.content);
      if (!portrait) throw new Error('The synthesis model did not return valid JSON. Try a stronger model.');
      portrait.model = retry.model;
      portrait.usage = retry.usage;
      return portrait;
    }
    portrait.model = syn.model;
    portrait.usage = syn.usage;
    return portrait;
  }

  /* Local synthesis when the model's synthesis step fails — keeps the
     per-interest work the user already paid for. */
  function localFallback(samples, profile, correlations, err) {
    const analysed = samples.categories.filter(c => c.analysis);
    const top = analysed.slice(0, 4);
    return {
      archetype: null,
      tagline: null,
      keywords: [],
      sections: [
        {
          title: 'What your interests actually consist of',
          body: top.map(c => `**${c.label}** (${c.share}%): ${c.analysis.essence || ''}`).join(' '),
        },
        {
          title: 'Cross-interest pattern',
          body: correlations.pairs.slice(0, 3)
            .map(p => `${p.aLabel} and ${p.bLabel} ${p.direction} across quarters (r=${p.r}).`)
            .join(' ') || 'No strong correlation found between interests.',
        },
        {
          title: 'Synthesis failed',
          body: `The per-interest analysis succeeded for ${analysed.length} interests, but the final synthesis call failed` +
                (err ? ` (${err})` : '') +
                '. The subthemes below are real and were computed from your videos. Re-run with a stronger model to get the full portrait.',
        },
      ],
      confidence: 'partial — synthesis step failed',
      categories: null,
    };
  }

  /* ── Preview what FULL mode would send (for the consent UI) ── */
  function previewPay(data, profile, taxonomy, opts) {
    const s = buildSamples(data, profile, taxonomy, opts);
    return {
      categories: s.categories.map(c => ({
        label: c.label,
        titles: c.titles.slice(0, 6).map(t => t.t),
        total: c.titles.length,
      })),
      totals: {
        categories: s.categories.length,
        titles: s.categories.reduce((n, c) => n + c.titles.length, 0),
        calls: s.categories.length + 1,
      },
    };
  }

  return { buildSamples, analyzeFull, categoryPrompt, synthesisPrompt, previewPayload: previewPay };
});
