/* YouScope — personalize.js
 * The model, not the code, decides what this person's interests ARE.
 *
 * Code's job: cluster their actual viewing into vocabulary groups and compute
 * every number. The model's job: name those groups in this person's terms,
 * decide which facts matter, and propose the report's own structure.
 *
 * Nothing here knows what "fitness" or "finance" means.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSPersonalize = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function getAI() {
    return (typeof YSAI !== 'undefined' ? YSAI : null)
      || (typeof window !== 'undefined' && window.YSAI)
      || (typeof require === 'function' ? require('./ai.js') : null)
      || (typeof global !== 'undefined' ? global.YSAI : null);
  }

  /* ── 1. Name the clusters ─────────────────────────────────────── */
  function taxonomyPrompt(clusters, meta) {
    const payload = clusters.map((c, i) => ({
      id: i,
      videos: c.count,
      channels: c.channels.slice(0, 4),
      words: c.terms.slice(0, 8),
      examples: c.samples.slice(0, 3).map((t) => String(t).slice(0, 70)),
    }));

    return `A person watched ${meta.total} videos. Their viewing has been grouped by shared vocabulary into the clusters below. The groups are pure arithmetic — nothing about their meaning has been decided yet.

YOUR TASK: name these clusters the way THIS person would describe them. Not textbook categories. If a cluster is "amazon, vcs, job, wfh, salary" then "Amazon employment stories" beats "Career". If it is "haseen, khayaal, gallan, talwiind" then name the actual music scene, not "Music".

CLUSTERS:
${JSON.stringify(payload, null, 1)}

Return JSON:
{
  "taxonomy": [
    {
      "clusterIds": [0, 3],
      "name": "what this person would call it, 2-5 words",
      "definition": "one line: what this body of watching actually is",
      "weight": "primary | secondary | peripheral"
    }
  ],
  "noticed": "one sentence on anything surprising in HOW these clusters relate"
}

Rules:
- Merge clusters that are really one interest. Split nothing — you only have these groups.
- Every cluster id 0-${clusters.length - 1} must appear exactly once across taxonomy.clusterIds.
- Names must come from the actual words and titles shown. Do not import outside categories.
- 4-9 groups. Fewer if the viewing is genuinely narrow.
- If one cluster is a catch-all of unrelated leftovers, name it honestly as such.
- JSON only, no fences.`;
  }

  /* ── 2. Decide what is worth saying ───────────────────────────── */
  function slimFacts(facts) {
    // Keep the fact sheet small enough for a reasoning model to answer quickly.
    const { hours, channelChurn, ...rest } = facts;
    return {
      ...rest,
      longReturns: (rest.longReturns || []).slice(0, 8),
      abandoned: (rest.abandoned || []).slice(0, 10),
      silences: (rest.silences || []).slice(0, 8),
      searchArc: (rest.searchArc || []).map((y) => ({ ...y, samples: y.samples.slice(0, 5) })),
      eras: (rest.eras || []).map((e) => ({ ...e, topChannels: e.topChannels.slice(0, 3) })),
    };
  }

  function structurePrompt(facts, taxonomy) {
    return `Here is a verifiable FACT SHEET about one person's ${facts.spanDays} days of YouTube history, plus the interest groups that emerged from it.

FACTS (every value computed from their data; you may not invent others):
${JSON.stringify(slimFacts(facts), null, 1)}

INTEREST GROUPS (named from their own vocabulary):
${JSON.stringify(taxonomy, null, 1)}

YOUR TASK: decide what is actually interesting about this person, and design the report around it.

Do NOT use generic section names like "Overview", "Interests", "How you changed". Those are templates. Choose the questions that THIS data answers in a way worth reading.

Return JSON:
{
  "headline": "one sentence, under 20 words, the single most striking true thing here",
  "sections": [
    {
      "title": "a specific question or claim, e.g. 'The year the searches stopped'",
      "intent": "what this section establishes",
      "citesFacts": ["names of the fact fields this section rests on, e.g. searchArc, silences, returns"]
    }
  ],
  "skip": "one sentence naming something you deliberately did NOT report, and why"
}

Rules:
- 3-6 sections. Every one must rest on at least one named fact field.
- Prefer facts with sharp contrast: returns after long gaps, silences, clusters that shrank, arcs that turned.
- If the facts are thin, say fewer things. Do not pad.
- JSON only, no fences.`;
  }

  /* ── 3. Write each section against its assigned facts ────────── */
  function sectionPrompt(section, facts, taxonomy, evidence) {
    return `Write ONE section of a personal report from verifiable data.

SECTION TITLE: ${section.title}
INTENT: ${section.intent}
FACTS IT SHOULD USE: ${JSON.stringify(section.citesFacts)}

FULL FACT SHEET:
${JSON.stringify(slimFacts(facts), null, 1)}

INTEREST GROUPS:
${JSON.stringify(taxonomy, null, 1)}

${evidence ? `SPECIFIC EVIDENCE FOR THIS SECTION:\n${evidence}\n` : ''}
Write 2-4 sentences. Second person. Concrete.

Rules:
- Every sentence must be traceable to a number or name above. If you cannot ground it, cut it.
- Never state a statistic that is not in the fact sheet. Do not round differently than the data does.
- No horoscope phrasing. No advice. No "you should".
- If the evidence is thin, write one honest sentence instead of three padded ones.
- Plain text, no markdown headers, no JSON wrapper.`;
  }

  /* ── orchestrator ─────────────────────────────────────────────── */
  async function run(facts, clusters, cfg, hooks) {
    hooks = hooks || {};
    const onStage = hooks.onStage || (() => {});
    const ai = getAI();
    if (!ai) throw new Error('AI module unavailable.');

    const call = async (prompt, maxTokens, json, label) => {
      const attempt = async (extra) => {
        const r = await ai.chat(cfg, [
          { role: 'system', content: 'You are a precise behavioural analyst. You only state what the data supports.' },
          { role: 'user', content: prompt + (extra || '') },
        ], { json: !!json, maxTokens });
        if (!json) return r.content;
        const parsed = ai.extractJson(r.content);
        if (parsed) return parsed;
        return { __parseFailed: true, __raw: String(r.content || '').slice(0, 300) };
      };

      let out = await attempt('');
      if (json && out && out.__parseFailed) {
        // One retry with an explicit pointer at the format.
        out = await attempt('\n\nReturn ONLY a JSON object. No prose, no markdown fences, no explanation.');
      }
      if (json && out && out.__parseFailed) {
        throw new Error(`The model returned text that was not JSON for "${label}". It said: "${out.__raw.slice(0, 160)}..." — try a model with stronger JSON support.`);
      }
      return out;
    };

    // 1. taxonomy
    onStage('Naming your interest groups');
    const taxOut = await call(taxonomyPrompt(clusters, { total: facts.totalWatched }), 2400, true, 'naming your groups');
    if (!taxOut || !Array.isArray(taxOut.taxonomy)) {
      throw new Error('The model did not return a usable taxonomy. Try a stronger model.');
    }
    const taxonomy = taxOut.taxonomy.map((t) => ({
      name: t.name,
      definition: t.definition,
      weight: t.weight || 'secondary',
      clusters: (t.clusterIds || []).map((id) => clusters[id]).filter(Boolean),
    })).filter((t) => t.clusters.length);

    const counts = taxonomy.map((t) => ({
      name: t.name, definition: t.definition, weight: t.weight,
      videos: t.clusters.reduce((n, c) => n + c.count, 0),
      share: +t.clusters.reduce((n, c) => n + c.share, 0).toFixed(1),
      channels: [...new Set(t.clusters.flatMap((c) => c.channels))].slice(0, 8),
      terms: [...new Set(t.clusters.flatMap((c) => c.terms || []))].slice(0, 10),
    })).sort((a, b) => b.videos - a.videos);

    // 2. structure
    onStage('Deciding what is worth saying');
    let struct = await call(structurePrompt(facts, counts), 2400, true, 'choosing what to report');
    if (!struct || !Array.isArray(struct.sections) || !struct.sections.length) {
      // Degrade rather than fail: keep the taxonomy, which is already useful,
      // and derive sections from the strongest facts we have.
      onStage('Structure step produced nothing usable — deriving sections from the facts');
      const derived = deriveSections(facts);
      struct = { headline: null, sections: derived, skip: null };
    }

    // 3. write sections
    const sections = [];
    for (let i = 0; i < struct.sections.length; i++) {
      const s = struct.sections[i];
      onStage(`Writing ${i + 1} of ${struct.sections.length}: ${s.title}`);
      try {
        const evidence = gatherEvidence(s, facts);
        const body = await call(sectionPrompt(s, facts, counts, evidence), 1200, false, s.title);
        if (body && String(body).trim()) {
          sections.push({ title: s.title, body: String(body).trim(), cites: s.citesFacts || [] });
        }
      } catch (e) {
        sections.push({ title: s.title, body: null, error: e.message });
      }
      if (hooks.delayMs) await new Promise((r) => setTimeout(r, hooks.delayMs));
    }

    return {
      source: 'ai-personalized',
      headline: struct.headline || null,
      taxonomy: counts,
      sections: sections.filter((s) => s.body),
      failedSections: sections.filter((s) => !s.body),
      skipped: struct.skip || null,
      noticed: taxOut.noticed || null,
    };
  }

  /* When the model cannot propose a structure, build one from whichever facts
   * are most striking. Ordering is by measurable contrast, not by taste. */
  function deriveSections(facts) {
    const out = [];
    if (facts.longReturns && facts.longReturns.length >= 3) {
      out.push({
        title: `Channels you came back to after ${Math.round(facts.longReturns[0].days / 365 * 10) / 10} years`,
        intent: 'show the returns after long gaps',
        citesFacts: ['longReturns'],
      });
    }
    if (facts.searchArc && facts.searchArc.length) {
      const peak = facts.searchArc.slice().sort((a, b) => b.count - a.count)[0];
      out.push({
        title: `The year you searched ${peak.count} times`,
        intent: 'trace how questions changed',
        citesFacts: ['searchArc'],
      });
    }
    if (facts.abandoned && facts.abandoned.length >= 3) {
      const top = facts.abandoned[0];
      out.push({
        title: `${facts.abandoned.length} channels went quiet`,
        intent: 'name what stopped',
        citesFacts: ['abandoned'],
      });
    }
    if (facts.eras && facts.eras.length >= 2) {
      const big = facts.eras.slice().sort((a, b) => b.watches - a.watches)[0];
      const share = ((100 * big.watches) / Math.max(1, facts.totalWatched)).toFixed(1);
      out.push({
        title: `Where ${share}% of your watching actually happened`,
        intent: 'describe the concentration',
        citesFacts: ['eras'],
      });
    }
    if (facts.silences && facts.silences.length) {
      out.push({
        title: 'The months that went quiet',
        intent: 'describe the gaps',
        citesFacts: ['silences'],
      });
    }
    if (!out.length) {
      out.push({ title: 'What the numbers show', intent: 'summarise', citesFacts: ['totalWatched', 'channels'] });
    }
    return out.slice(0, 5);
  }

  /* Pull the specific rows a section asked for, so the writer sees detail
   * rather than the whole fact sheet every time. */
  function gatherEvidence(section, facts) {
    const wants = (section.citesFacts || []).map((s) => String(s).toLowerCase());
    const lines = [];
    const pick = (key) => wants.some((w) => w.includes(key.toLowerCase()));

    if (pick('return') && facts.longReturns) {
      lines.push('Returns after long gaps: ' + facts.longReturns.map(
        (r) => `${r.channel} came back after ${r.days} days (${r.resumed})`).join('; '));
    }
    if (pick('abandon') && facts.abandoned) {
      lines.push('Channels they stopped: ' + facts.abandoned.slice(0, 8).map(
        (a) => `${a.channel} (${a.watches} videos, last ${a.lastSeen})`).join('; '));
    }
    if (pick('silence') && facts.silences) {
      lines.push('Unusually quiet periods: ' + facts.silences.map(
        (s) => `${s.month} had ${s.count} watches`).join('; '));
    }
    if (pick('search') && facts.searchArc) {
      lines.push('Searches by year: ' + facts.searchArc.map(
        (y) => `${y.year}: ${y.count} searches, e.g. ${(y.samples || []).slice(0, 4).join(' / ')}`).join(' || '));
    }
    if (pick('era') && facts.eras) {
      lines.push('Detected eras: ' + facts.eras.map(
        (e) => `${e.from}–${e.to}: ${e.channelsPerMonth} new channels/month, top groups ${(e.topGroups || []).join(', ')}`).join(' || '));
    }
    if (pick('hour') || pick('rhythm')) {
      lines.push(`Peak hour ${facts.rhythm.peakHour}:00, ${facts.rhythm.nightShare}% after midnight, busiest weekday ${facts.rhythm.busiestWeekday}`);
    }
    if (pick('total') || pick('coverage')) {
      lines.push(`Coverage ${facts.from} to ${facts.to} (${facts.spanDays} days), ${facts.totalWatched} watches across ${facts.channels} channels`);
    }
    return lines.length ? lines.join('\n') : null;
  }

  return { run, taxonomyPrompt, structurePrompt, sectionPrompt, slimFacts };
});
