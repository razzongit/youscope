/* YouScope — charts.js
 * Hand-rolled SVG charts. No dependencies, works offline, prints well.
 */
(function (root) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, kids) => {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) { if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]); }
    if (kids) (Array.isArray(kids) ? kids : [kids]).forEach(k => k && n.appendChild(k));
    return n;
  };
  const txt = (s) => document.createTextNode(s);

  let TIP = null;
  function tip() {
    if (!TIP) { TIP = document.createElement('div'); TIP.id = 'tip'; document.body.appendChild(TIP); }
    return TIP;
  }
  function showTip(e, html) {
    const t = tip();
    t.innerHTML = html; t.classList.add('on');
    const pad = 14;
    let x = e.clientX + pad, y = e.clientY - 34;
    const r = t.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y < 8) y = e.clientY + 18;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { if (TIP) TIP.classList.remove('on'); }

  function fmt(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n * 10) / 10);
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return step * p;
  }

  /* ── area/line chart ───────────────────────────────────────────
   * data: [{label, value}]  opts: {h, color, area, labels, yTicks, fmtVal}
   */
  function areaChart(data, opts) {
    opts = opts || {};
    // Guard: an empty series used to throw and take the entire view down.
    if (!Array.isArray(data) || data.length === 0) return el('svg', { class: 'chart' });
    const W = opts.w || 900, H = opts.h || 220;
    const P = { t: 14, r: 12, b: 26, l: 42 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const max = niceMax(Math.max(...data.map(d => d.value), 1));
    const n = data.length;
    const x = i => P.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = v => P.t + ih - (v / max) * ih;
    const color = opts.color || 'var(--accent)';
    const gid = 'g' + Math.random().toString(36).slice(2, 8);

    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img' });

    // grid + y labels
    const ticks = opts.yTicks || 3;
    for (let i = 0; i <= ticks; i++) {
      const v = (max / ticks) * i;
      svg.appendChild(el('line', { x1: P.l, x2: W - P.r, y1: y(v), y2: y(v), class: 'grid-line' }));
      const t = el('text', { x: P.l - 8, y: y(v) + 3, 'text-anchor': 'end', class: 'axis-label' });
      t.appendChild(txt(fmt(v))); svg.appendChild(t);
    }

    const pts = data.map((d, i) => [x(i), y(d.value)]);
    if (opts.area !== false) {
      const defs = el('defs', null, el('linearGradient', { id: gid, x1: '0', y1: '0', x2: '0', y2: '1' },
        [el('stop', { offset: '0', 'stop-color': color, 'stop-opacity': '.34' }),
         el('stop', { offset: '1', 'stop-color': color, 'stop-opacity': '0' })]));
      svg.appendChild(defs);
      const d = `M ${pts[0][0]} ${P.t + ih} ` + pts.map(p => `L ${p[0]} ${p[1]}`).join(' ') + ` L ${pts[pts.length - 1][0]} ${P.t + ih} Z`;
      svg.appendChild(el('path', { d, fill: `url(#${gid})` }));
    }
    svg.appendChild(el('path', {
      d: 'M ' + pts.map(p => `${p[0]} ${p[1]}`).join(' L '),
      fill: 'none', stroke: color, 'stroke-width': '1.6', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    }));

    // dots + hover targets
    const every = Math.max(1, Math.floor(n / 60));
    pts.forEach((p, i) => {
      if (i % every !== 0 && i !== n - 1) return;
      svg.appendChild(el('circle', { cx: p[0], cy: p[1], r: '1.7', fill: color, opacity: '.85' }));
    });
    // x labels
    const lab = opts.labels || [];
    const stepL = Math.max(1, Math.ceil(n / (opts.xTicks || 8)));
    data.forEach((d, i) => {
      if (i % stepL !== 0 && i !== n - 1) return;
      const t = el('text', { x: x(i), y: H - 7, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'axis-label' });
      t.appendChild(txt(lab[i] !== undefined ? lab[i] : d.label)); svg.appendChild(t);
    });

    // hover layer
    const hover = el('rect', { x: P.l, y: P.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair' });
    const vline = el('line', { y1: P.t, y2: P.t + ih, stroke: color, 'stroke-width': '1', opacity: '0', 'stroke-dasharray': '3 3' });
    const vdot = el('circle', { r: '3.6', fill: color, opacity: '0' });
    svg.appendChild(vline); svg.appendChild(vdot); svg.appendChild(hover);

    hover.addEventListener('mousemove', (e) => {
      const box = svg.getBoundingClientRect();
      const rel = (e.clientX - box.left) / box.width * W;
      let i = Math.round(((rel - P.l) / iw) * (n - 1));
      i = Math.max(0, Math.min(n - 1, i));
      const d = data[i];
      vline.setAttribute('x1', x(i)); vline.setAttribute('x2', x(i)); vline.setAttribute('opacity', '.5');
      vdot.setAttribute('cx', x(i)); vdot.setAttribute('cy', y(d.value)); vdot.setAttribute('opacity', '1');
      showTip(e, `${lab[i] !== undefined ? lab[i] : d.label} · <b style="color:${color}">${fmt(d.value)}</b>${opts.unit ? ' ' + opts.unit : ''}`);
    });
    hover.addEventListener('mouseleave', () => {
      vline.setAttribute('opacity', '0'); vdot.setAttribute('opacity', '0'); hideTip();
    });

    return svg;
  }

  /* ── horizontal bars ────────────────────────────────────────── */
  function barRows(items, opts) {
    opts = opts || {};
    if (!Array.isArray(items) || items.length === 0) { const d = document.createElement("div"); d.className = "bars"; return d; }
    const wrap = document.createElement('div');
    wrap.className = 'bars';
    const max = Math.max(...items.map(i => i.count || i.value || 0), 1);
    items.forEach((it, idx) => {
      const v = it.count !== undefined ? it.count : it.value;
      const row = document.createElement('div');
      row.className = 'brow';
      const track = document.createElement('div');
      track.className = 'track';
      const fill = document.createElement('div');
      fill.className = 'fill' + (opts.alt ? ' alt' : '');
      fill.style.width = Math.max(1.2, (v / max) * 100) + '%';
      if (it.color) { fill.style.background = `linear-gradient(90deg, ${it.color}55, ${it.color}18)`; }
      const nm = document.createElement('div'); nm.className = 'nm';
      nm.textContent = (opts.numbered ? (idx + 1) + '. ' : '') + (it.name || it.title || '');
      if (it.title && it.name) nm.title = it.title;
      track.appendChild(fill); track.appendChild(nm);
      const ct = document.createElement('div'); ct.className = 'ct';
      ct.textContent = opts.suffix ? fmt(v) + opts.suffix : fmt(v);
      row.appendChild(track); row.appendChild(ct);
      if (it.url) { row.style.cursor = 'pointer'; row.addEventListener('click', () => window.open(it.url, '_blank')); }
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* ── calendar heatmap ───────────────────────────────────────── */
  function heatmap(dailyCounts, opts) {
    opts = opts || {};
    if (!Array.isArray(dailyCounts) || dailyCounts.length === 0) { const g = document.createElement("div"); g.className = "heat"; return g; }
    const wrap = document.createElement('div');
    wrap.style.overflowX = 'auto';
    const grid = document.createElement('div');
    grid.className = 'heat';
    if (!dailyCounts.length) return grid;

    const byDate = new Map(dailyCounts.map(d => [d.date, d.count]));
    const start = new Date(dailyCounts[0].date + 'T00:00:00Z');
    // back up to Sunday
    const startDow = start.getUTCDay();
    start.setUTCDate(start.getUTCDate() - startDow);
    const end = new Date(dailyCounts[dailyCounts.length - 1].date + 'T00:00:00Z');
    const max = Math.max(...dailyCounts.map(d => d.count), 1);

    const today = new Date();
    let cur = new Date(start);
    while (cur <= end) {
      const k = cur.getUTCFullYear() + '-' + String(cur.getUTCMonth() + 1).padStart(2, '0') + '-' + String(cur.getUTCDate()).padStart(2, '0');
      const c = byDate.get(k) || 0;
      const cell = document.createElement('i');
      if (c > 0) {
        const t = Math.min(1, Math.pow(c / max, .55));
        cell.style.background = `rgba(125,255,179,${(0.14 + t * 0.86).toFixed(3)})`;
        cell.style.boxShadow = t > .62 ? `0 0 7px rgba(125,255,179,${(t * .34).toFixed(2)})` : 'none';
      }
      cell.dataset.date = k; cell.dataset.count = c;
      grid.appendChild(cell);
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    grid.addEventListener('mousemove', (e) => {
      const t = e.target;
      if (t.tagName !== 'I') return;
      const c = +t.dataset.count;
      showTip(e, `${t.dataset.date} · ${c ? '<b>' + c + '</b> watches' : 'nothing watched'}`);
    });
    grid.addEventListener('mouseleave', hideTip);
    wrap.appendChild(grid);
    return wrap;
  }

  /* ── clock (polar hour ring) ────────────────────────────────── */
  function clockRing(hours, opts) {
    opts = opts || {};
    if (!Array.isArray(hours) || hours.length < 24) return el("svg");
    const W = 300, H = 300, cx = 150, cy = 150;
    const max = Math.max(...hours, 1);
    const svg = el('svg', { class: 'chart chart-fixed', viewBox: `0 0 ${W} ${H}` });
    const rIn = 56, rOut = 128;
    hours.forEach((v, h) => {
      const a0 = (h / 24) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((h + 0.86) / 24) * Math.PI * 2 - Math.PI / 2;
      const len = rIn + ((rOut - rIn) * (v / max));
      const x0 = cx + Math.cos(a0) * rIn, y0 = cy + Math.sin(a0) * rIn;
      const x1 = cx + Math.cos(a0) * len, y1 = cy + Math.sin(a0) * len;
      const x2 = cx + Math.cos(a1) * len, y2 = cy + Math.sin(a1) * len;
      const x3 = cx + Math.cos(a1) * rIn, y3 = cy + Math.sin(a1) * rIn;
      const p = el('path', {
        d: `M ${x0} ${y0} L ${x1} ${y1} A ${len} ${len} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${rIn} ${rIn} 0 0 0 ${x0} ${y0} Z`,
        fill: opts.color || 'var(--accent)', opacity: (0.22 + 0.78 * (v / max)).toFixed(2),
        style: 'transition:opacity .2s',
      });
      p.addEventListener('mousemove', (e) => showTip(e, `${String(h).padStart(2, '0')}:00 · <b>${v}</b> watches`));
      p.addEventListener('mouseleave', hideTip);
      svg.appendChild(p);
    });
    // hour ticks 0,6,12,18
    [0, 6, 12, 18].forEach(h => {
      const a = (h / 24) * Math.PI * 2 - Math.PI / 2;
      const t = el('text', {
        x: cx + Math.cos(a) * (rOut + 16), y: cy + Math.sin(a) * (rOut + 16) + 3,
        'text-anchor': 'middle', class: 'axis-label',
      });
      t.appendChild(txt(String(h).padStart(2, '0'))); svg.appendChild(t);
    });
    const c1 = el('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'axis-label', style: 'font-size:19px;fill:var(--text)' });
    c1.appendChild(txt(opts.centerTop || '')); svg.appendChild(c1);
    const c2 = el('text', { x: cx, y: cy + 15, 'text-anchor': 'middle', class: 'axis-label' });
    c2.appendChild(txt(opts.centerBottom || '')); svg.appendChild(c2);
    return svg;
  }

  /* ── streamgraph (interest evolution) ───────────────────────── */
  function streamChart(quarters, trajectories, opts) {
    opts = opts || {};
    if (!Array.isArray(quarters) || quarters.length === 0) return el("svg");
    const W = opts.w || 900, H = opts.h || 300;
    const P = { t: 12, r: 8, b: 24, l: 8 };
    const iw = W - P.l - P.r, ih = H - P.t - P.b;
    const n = quarters.length;
    if (!n) return el('svg');
    const top = trajectories.slice(0, opts.layers || 9);
    // compute per-quarter totals per layer as share
    const layerVals = top.map(t => quarters.map(q => {
      const hit = q.cats.find(c => c.id === t.id);
      return hit ? hit.share : 0;
    }));
    const colTotals = quarters.map((q, i) => layerVals.reduce((s, l) => s + l[i], 0) || 1);
    const x = i => P.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const scale = ih / 100;
    const svg = el('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none' });

    // y-axis: cumulative share of the top-N layers (0 → top-N total, usually ~100)
    for (let pct = 0; pct <= 100; pct += 25) {
      const yy = P.t + ih - pct * scale;
      if (yy < P.t - 1) break;
      svg.appendChild(el('line', { x1: P.l, x2: W - P.r, y1: yy, y2: yy, class: 'grid-line' }));
      const t = el('text', { x: P.l + 2, y: yy - 3, class: 'axis-label', style: 'font-size:8.5px' });
      t.appendChild(txt(pct + '%')); svg.appendChild(t);
    }

    // stacked (non-centered) area bands
    const cum = quarters.map(() => 0);
    for (let li = 0; li < layerVals.length; li++) {
      const vals = layerVals[li];
      const upper = vals.map((v, i) => cum[i] + v);
      const dTop = vals.map((v, i) => `${x(i)} ${P.t + ih - upper[i] * scale}`);
      const dBot = vals.map((v, i) => `${x(i)} ${P.t + ih - cum[i] * scale}`).reverse();
      const d = 'M ' + dTop.join(' L ') + ' L ' + dBot.join(' L ') + ' Z';
      const path = el('path', { d, fill: top[li].color, opacity: '.62', stroke: 'rgba(0,0,0,.3)', 'stroke-width': '.6' });
      path.addEventListener('mousemove', (e) => showTip(e, `<b style="color:${top[li].color}">${top[li].label}</b> · ${vals.map(v => v.toFixed(1)).slice(-1)[0]}% latest`));
      path.addEventListener('mouseleave', hideTip);
      svg.appendChild(path);
      for (let i = 0; i < n; i++) cum[i] += vals[i];
    }
    // x labels — years for long spans, quarters for short ones
    if (n <= 6) {
      quarters.forEach((q, i) => {
        const t = el('text', {
          x: x(i), y: H - 5,
          'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle',
          class: 'axis-label', style: 'font-size:8.5px',
        });
        t.appendChild(txt(q.quarter.replace('-', ' '))); svg.appendChild(t);
      });
    } else {
      let lastY = '';
      quarters.forEach((q, i) => {
        const y = q.quarter.split('-')[0];
        if (y !== lastY) {
          const t = el('text', { x: x(i), y: H - 5, 'text-anchor': 'start', class: 'axis-label' });
          t.appendChild(txt(y)); svg.appendChild(t); lastY = y;
        }
      });
    }
    return svg;
  }

  /* ── radial gauge ───────────────────────────────────────────── */
  function gauge(value, opts) {
    opts = opts || {};
    const W = 160, H = 100, cx = 80, cy = 88, r = 62;
    const pct = Math.max(0, Math.min(1, value));
    const a0 = Math.PI, a1 = Math.PI + Math.PI * pct;
    const svg = el('svg', { class: 'chart chart-fixed', viewBox: `0 0 ${W} ${H}`, style: 'max-width:190px' });
    svg.appendChild(el('path', {
      d: `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`,
      fill: 'none', stroke: 'rgba(255,255,255,.08)', 'stroke-width': '9', 'stroke-linecap': 'round',
    }));
    if (pct > 0.01) {
      svg.appendChild(el('path', {
        d: `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + Math.cos(a1 - Math.PI) * -r * -1} ${cy + Math.sin(a1 - Math.PI) * r}`,
        fill: 'none', stroke: opts.color || 'var(--accent)', 'stroke-width': '9', 'stroke-linecap': 'round',
        style: 'filter:drop-shadow(0 0 6px rgba(125,255,179,.4))',
      }));
    }
    const t = el('text', { x: cx, y: cy - 14, 'text-anchor': 'middle', class: 'axis-label', style: 'font-size:22px;fill:var(--text)' });
    t.appendChild(txt(opts.text || Math.round(pct * 100) + '%')); svg.appendChild(t);
    const s = el('text', { x: cx, y: cy + 1, 'text-anchor': 'middle', class: 'axis-label' });
    s.appendChild(txt(opts.label || '')); svg.appendChild(s);
    return svg;
  }

  root.YSCharts = { areaChart, barRows, heatmap, clockRing, streamChart, gauge, fmt, showTip, hideTip };
})(typeof self !== 'undefined' ? self : this);
