/* YouScope — blocks.js
 * A block is one visual unit a section can render. The model composes sections
 * from this fixed vocabulary; it cannot invent widgets.
 *
 * Safety model:
 *   - The model may only name a block type and reference a fact field.
 *   - Every block declares which data shapes it accepts; a mismatched request
 *     is DOWNGRADED to something renderable (gauge on a series becomes bars)
 *     rather than rendering broken. Validation happens before paint.
 *   - The model never supplies numbers. All values come from facts / profile.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSBlocks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const h = (tag, attrs, html) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    }
    if (html !== undefined && html !== null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const C = () => window.YSCharts;

  /* ── data resolvers: fact-field name → renderable rows ────────── */
  const RESOLVERS = {
    /* volume over time */
    monthlyVolume(ctx) {
      const ms = (ctx.profile && ctx.profile.monthlySeries) || [];
      return ms.map((m) => ({ label: m.month, value: m.count }));
    },
    /* per-group totals */
    groupTotals(ctx) {
      const cats = (ctx.taxonomyGroups || []).length
        ? ctx.taxonomyGroups
        : ((ctx.profile && ctx.profile.interests && ctx.profile.interests.cats) || []);
      return cats.slice(0, 12).map((c) => ({ name: c.label, count: c.count, color: c.color }));
    },
    /* grouped evolution over quarters */
    quarterlyShares(ctx) {
      const q = (ctx.profile && ctx.profile.evolution && ctx.profile.evolution.quarters) || [];
      return q;
    },
    trajectories(ctx) {
      return (ctx.profile && ctx.profile.evolution && ctx.profile.evolution.trajectories) || [];
    },
    /* channel abandonment, as dated points */
    abandoned(ctx) {
      return ((ctx.facts && ctx.facts.abandoned) || []).map((a) => ({
        name: a.channel, count: a.watches, when: a.lastSeen,
      }));
    },
    longReturns(ctx) {
      return ((ctx.facts && ctx.facts.longReturns) || []).map((r) => ({
        name: r.channel, count: r.days, when: r.resumed,
      }));
    },
    /* searches by year */
    searchArc(ctx) {
      return ((ctx.facts && ctx.facts.searchArc) || []).map((y) => ({
        label: String(y.year), value: y.count,
      }));
    },
    /* hours histogram */
    hours(ctx) {
      return (ctx.profile && ctx.profile.clock && ctx.profile.clock.hours) || [];
    },
    /* monthly watch counts for a heatmap */
    dailyCounts(ctx) {
      return (ctx.profile && ctx.profile.dailyCounts) || [];
    },
    eras(ctx) {
      return ((ctx.facts && ctx.facts.eras) || []).map((e) => ({
        name: e.from + ' → ' + e.to, count: e.watches, detail: e.topChannels.join(', '),
      }));
    },
    silence(ctx) {
      return ((ctx.facts && ctx.facts.silences) || []).map((s) => ({
        label: s.month, value: s.count,
      }));
    },
  };

  /* What each fact field can actually be drawn as. Used to downgrade a bad
   * request instead of failing. */
  const SHAPES = {
    monthlyVolume: 'series', searchArc: 'series', silence: 'series',
    hours: 'histogram', dailyCounts: 'calendar',
    groupTotals: 'bars', trajectories: 'bars', abandoned: 'bars',
    longReturns: 'bars', eras: 'bars',
    quarterlyShares: 'stack',
  };

  const AVAILABLE = Object.keys(RESOLVERS);

  /* ── renderers ───────────────────────────────────────────────── */
  const RENDER = {
    prose(spec, ctx) {
      const body = spec.text || ctx.body || '';
      if (!body) return null;
      return h('p', { class: 'narr', style: 'margin:0 0 4px' }, esc(body).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>'));
    },

    stat(spec, ctx) {
      const rows = [];
      for (const key of (spec.facts || [])) {
        const v = statValue(key, ctx);
        if (v) rows.push(v);
      }
      if (!rows.length) return null;
      const grid = h('div', { style: 'display:flex;gap:26px;flex-wrap:wrap;margin:2px 0' });
      rows.slice(0, 4).forEach((r) => {
        grid.appendChild(h('div', {}, `<div class="mono" style="font-size:1.5rem;letter-spacing:-.02em;color:var(--text)">${esc(r.value)}</div>
          <div class="hint" style="margin-top:2px">${esc(r.label)}</div>`));
      });
      return grid;
    },

    tags(spec, ctx) {
      let items = [];
      if (spec.data === 'channels' && ctx.blockChannels) items = ctx.blockChannels;
      else if (spec.data === 'terms' && ctx.blockTerms) items = ctx.blockTerms;
      else if (spec.data && RESOLVERS[spec.data]) {
        items = RESOLVERS[spec.data](ctx).slice(0, spec.limit || 12).map((x) => x.name || x.label);
      }
      if (!items || !items.length) return null;
      const wrap = h('div', { class: 'tags', style: 'margin:2px 0' });
      items.slice(0, spec.limit || 12).forEach((t) => wrap.appendChild(h('span', { class: 'tag' }, esc(t))));
      return wrap;
    },

    table(spec, ctx) {
      const res = RESOLVERS[spec.data];
      if (!res) return null;
      const rows = res(ctx).slice(0, spec.limit || 8);
      if (!rows.length) return null;
      const t = h('div', { style: 'font-size:.84rem' });
      rows.forEach((r, i) => {
        t.appendChild(h('div', {
          style: 'display:grid;grid-template-columns:22px 1fr auto;gap:10px;padding:6px 0;' +
            (i < rows.length - 1 ? 'border-bottom:1px solid rgba(255,255,255,.05)' : ''),
        }, `<span class="mono dim" style="font-size:.7rem">${i + 1}</span>
            <span>${esc(r.name || r.label || '')}</span>
            <span class="mono dim" style="font-size:.75rem">${esc(r.when || r.count || r.value || '')}</span>`));
      });
      return t;
    },

    timeline(spec, ctx) {
      const res = RESOLVERS[spec.data];
      if (!res) return null;
      const rows = res(ctx).filter((r) => r.when).slice(0, spec.limit || 10);
      if (rows.length < 2) return null;
      const dates = rows.map((r) => Date.parse(r.when)).filter(Number.isFinite);
      if (dates.length < 2) return null;
      const min = Math.min(...dates), max = Math.max(...dates);
      const span = Math.max(1, max - min);

      const box = h('div', { style: 'position:relative;height:56px;margin:16px 0 8px' });
      box.appendChild(h('div', {
        style: 'position:absolute;left:0;right:0;top:26px;height:1px;background:rgba(255,255,255,.13)',
      }));
      rows.forEach((r) => {
        const t = Date.parse(r.when);
        if (!Number.isFinite(t)) return;
        const pct = ((t - min) / span) * 100;
        const dot = h('div', {
          title: r.name + ' — ' + r.when,
          style: `position:absolute;left:${pct}%;top:20px;width:2px;height:13px;background:var(--accent);` +
            'border-radius:1px;opacity:.85;transform:translateX(-1px)',
        });
        box.appendChild(dot);
      });
      const labels = h('div', {
        style: 'display:flex;justify-content:space-between;font-family:var(--mono);font-size:.66rem;color:var(--text-dim)',
      }, `<span>${esc(new Date(min).toISOString().slice(0, 7))}</span><span>${esc(new Date(max).toISOString().slice(0, 7))}</span>`);
      const wrap = h('div');
      wrap.appendChild(box); wrap.appendChild(labels);
      return wrap;
    },

    chart(spec, ctx) {
      let kind = spec.chart;
      let data = spec.data;
      const shape = SHAPES[data];
      if (!shape) return null;

      // Downgrade impossible combinations rather than rendering nonsense.
      const ok = {
        series: ['area'],
        histogram: ['clock'],
        calendar: ['heatmap'],
        bars: ['bars'],
        stack: ['stream'],
      }[shape];
      if (!ok.includes(kind)) {
        kind = ok[0];
        spec = { ...spec, downgradedFrom: spec.chart, chart: kind };
      }

      const res = RESOLVERS[data];
      const rows = res(ctx);
      if (!rows.length) return null;

      if (kind === 'area') {
        const items = rows.map((r) => ({ label: r.label, value: r.value }));
        if (items.length < 3) return null;
        return C().areaChart(items, { h: 150, color: 'var(--accent)', xTicks: 6 });
      }
      if (kind === 'bars') {
        const items = rows.filter((r) => (r.count || r.value)).map((r) => ({
          name: r.name || r.label, count: r.count || r.value, color: r.color,
        }));
        if (items.length < 2) return null;
        return C().barRows(items.slice(0, 10), {});
      }
      if (kind === 'clock') {
        if (rows.length !== 24) return null;
        return C().clockRing(rows, { color: 'var(--accent)', centerTop: '', centerBottom: 'watches' });
      }
      if (kind === 'heatmap') {
        if (rows.length < 20) return null;
        return C().heatmap(rows);
      }
      if (kind === 'stream') {
        const q = rows;
        if (q.length < 4) return null;
        return C().streamChart(q, (ctx.profile.evolution && ctx.profile.evolution.trajectories) || q, { h: 170, layers: 6 });
      }
      return null;
    },
  };

  function statValue(key, ctx) {
    const f = ctx.facts || {};
    const p = ctx.profile || {};
    const map = {
      totalWatched: () => ({ value: nf(f.totalWatched), label: 'videos watched' }),
      channels: () => ({ value: nf(f.channels), label: 'channels' }),
      spanDays: () => ({ value: nf(f.spanDays), label: 'days covered' }),
      searches: () => ({ value: nf(f.searches), label: 'searches' }),
      nightShare: () => ({ value: (f.rhythm ? f.rhythm.nightShare + '%' : ''), label: 'after midnight' }),
      peakHour: () => ({ value: f.rhythm ? String(f.rhythm.peakHour).padStart(2, '0') + ':00' : '', label: 'peak hour' }),
      abandoned: () => ({ value: nf((f.abandoned || []).length), label: 'channels went quiet' }),
      longReturns: () => ({ value: nf((f.longReturns || []).length), label: 'came back after a gap' }),
      eras: () => ({ value: nf((f.eras || []).length), label: 'phases detected' }),
      coverage: () => ({ value: (p.interests ? p.interests.coverage + '%' : ''), label: 'grouped' }),
    };
    const fn = map[key];
    const v = fn ? fn() : null;
    return v && v.value && v.value !== 'undefined' && v.value !== 'NaN' ? v : null;
  }
  const nf = (n) => (typeof n === 'number' ? n.toLocaleString() : String(n || ''));

  /* ── public: validate a spec, then paint ─────────────────────── */
  function normalise(spec) {
    if (!spec || typeof spec !== 'object') return null;
    const type = String(spec.type || '').toLowerCase();
    if (!RENDER[type]) return null;
    const out = { type };
    if (spec.data) {
      if (!AVAILABLE.includes(spec.data)) return null;   // unknown fact field
      out.data = spec.data;
    }
    if (spec.chart) out.chart = String(spec.chart).toLowerCase();
    if (Array.isArray(spec.facts)) out.facts = spec.facts.filter((k) => typeof k === 'string');
    if (spec.text) out.text = String(spec.text).slice(0, 1200);
    if (spec.limit) out.limit = Math.max(1, Math.min(24, Number(spec.limit) || 8));
    return out;
  }

  /** Render one block. Returns null when it cannot be drawn at all. */
  function render(spec, ctx) {
    const s = normalise(spec);
    if (!s) return null;
    try {
      return RENDER[s.type](s, ctx) || null;
    } catch (e) {
      console.warn('block render failed:', s.type, e.message);
      return null;
    }
  }

  /** Render a section: prose first if given, then its blocks. */
  function renderSection(section, ctx) {
    const wrap = h('div');
    const prose = render({ type: 'prose', text: section.body }, ctx);
    if (prose) wrap.appendChild(prose);

    for (const spec of (section.layout || [])) {
      const el = render(spec, ctx);
      if (el) {
        const holder = h('div', { style: 'margin-top:14px' });
        holder.appendChild(el);
        if (spec.caption) {
          holder.appendChild(h('div', { class: 'hint', style: 'margin-top:6px;font-size:.72rem' }, esc(spec.caption)));
        }
        wrap.appendChild(holder);
      }
    }
    return wrap;
  }

  return { render, renderSection, normalise, AVAILABLE, SHAPES };
});
