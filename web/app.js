/* YouScope — app.js
 * Orchestrates: upload → parse → analyze → render. No framework, no build step.
 */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
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
  const fmt = (n) => {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + 'k';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n * 10) / 10 % 1 === 0 ? Math.round(n) : (Math.round(n * 10) / 10));
  };
  const md = (s) => window.YSAI.renderMarkdown(String(s || ''));

  const S = {
    profile: null, data: null, insights: null, ai: null, aiCfg: null, fileName: '',
    facts: null, clusters: null, personalized: null, mode: null, pending: null,
    aiProfile: null,   // profile recomputed on the model's taxonomy
  };
  const C = () => window.YSCharts;

  /* ─────────────────────────── shell ─────────────────────────── */
  function shell(active) {
    return `
      <div class="shell">
        <aside class="side">
          <div class="brand">
            <div class="brand-mark"></div>
            <div class="brand-name">You<em>Scope</em></div>
          </div>
          <nav class="nav" id="nav">
            ${navHTML(active)}
          </nav>
          <div class="side-foot">
            <div class="privacy-note">
              <b>Local only.</b> Your zip is unzipped in this tab. Nothing is uploaded — except an anonymous aggregate summary, and only if you add your own AI key.
            </div>
            <button class="btn ghost sm" id="btn-reset" style="width:100%;justify-content:center">Load different data</button>
          </div>
        </aside>
        <main class="main" id="main"></main>
      </div>`;
  }

  /* Base views are fixed; when the model has produced its own sections they are
   * appended as navigable pages, so navigation is partly authored by the
   * analysis rather than only by this file. */
  const BASE_VIEWS = [
    { id: 'overview', label: 'Overview' },
    { id: 'interests', label: 'Interests' },
    { id: 'evolution', label: 'Evolution' },
    { id: 'rhythm', label: 'Rhythm' },
    { id: 'channels', label: 'Channels' },
    { id: 'music', label: 'Music' },
    { id: 'search', label: 'Searches' },
    { id: 'portrait', label: 'Portrait' },
    { id: 'settings', label: 'Settings' },
  ];

  function currentViews() {
    const views = BASE_VIEWS.slice();
    const pers = S.personalized;
    if (pers && pers.sections && pers.sections.length) {
      const at = views.findIndex((v) => v.id === 'portrait');
      const extra = pers.sections.map((sec, i) => ({
        id: 'story' + i, label: shortLabel(sec.title), isStory: true, index: i,
      }));
      views.splice(at < 0 ? views.length : at, 0, ...extra);
    }
    return views.map((v, i) => ({ ...v, kbd: String(i + 1) }));
  }

  /* Nav labels must be short; the model writes full sentences. */
  function shortLabel(title) {
    const t = String(title || '').replace(/[?:.]+$/, '').trim();
    if (t.length <= 22) return t;
    const words = t.split(/\s+/);
    let out = '';
    for (const w of words) {
      if ((out + ' ' + w).trim().length > 22) break;
      out = (out + ' ' + w).trim();
    }
    return (out || words[0].slice(0, 22)) + '…';
  }

  let VIEWS = BASE_VIEWS;   // base list, kept for compatibility

  function navHTML(active) {
    const icons = {
      overview: '<path d="M3 12h4l2-7 3 14 2-7h5"/>',
      interests: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
      evolution: '<path d="M3 17l5-6 4 3 5-8 4 4"/>',
      rhythm: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
      channels: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 19v2M16 19v2"/>',
      music: '<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="16" r="2"/>',
      search: '<circle cx="11" cy="11" r="7"/><path d="M16 16l4 4"/>',
      portrait: '<path d="M12 3a4 4 0 100 8 4 4 0 000-8zM4 21c0-4 4-6 8-6s8 2 8 6"/>',
      story: '<path d="M4 5h16M4 12h16M4 19h9"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>',
    };
    return currentViews().map(v => `<a href="#${v.id}" data-view="${v.id}" class="${active === v.id ? 'active' : ''}">
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[v.isStory ? 'story' : v.id] || icons.overview}</svg>
      ${esc(v.label)}${v.isStory ? '<span class="kbd" style="color:var(--accent)">story</span>' : `<span class="kbd">${v.kbd}</span>`}</a>`).join('');
  }

  function mount(active) {
    document.body.innerHTML = '<div class="grain"></div>' + shell(active);
    $('#btn-reset').addEventListener('click', () => { resetAll(); });
    $$('#nav a').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      // Settings must be reachable before any data is loaded.
      if (!S.profile && a.dataset.view !== 'settings') return;
      location.hash = a.dataset.view;
    }));
  }

  /* ─────────────────────────── landing ─────────────────────────── */
  function renderLanding(err) {
    mount('overview');
    const m = $('#main');
    m.innerHTML = `
      <div class="drop-wrap">
        <div class="eyebrow reveal" style="margin-bottom:18px">Belongs to no one but you</div>
        <h1 class="reveal" style="animation-delay:.05s">What your watch history<br>actually says about you.</h1>
        <p class="lede reveal" style="animation-delay:.1s;margin:22px 0 34px">
          Drop your Google Takeout zip. YouScope reads every watch, search and music play,
          then maps your interests, tracks how they shifted year by year, and writes a portrait
          of the person behind the timeline.
        </p>
        ${err ? `<div class="state err reveal" style="animation-delay:.12s;margin-bottom:20px"><h3>${esc(err.title || 'Something went wrong')}</h3><p class="muted">${esc(err.body || '')}</p></div>` : ''}
        <div class="dropzone reveal" id="dz" style="animation-delay:.16s">
          <svg class="dz-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent)">
            <path d="M12 16V4m0 0L7 9m5-5l5 5"/><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"/>
          </svg>
          <h2>Drop takeout-*.zip here</h2>
          <p class="lede" style="margin:0 auto 24px">or choose the file — it stays on your device</p>
          <button class="btn" id="btn-file">Choose zip file</button>
          <input type="file" accept=".zip,.html,.csv" id="file" hidden>
          <div id="prog"></div>
        </div>
        <div class="grid g-3 reveal" style="animation-delay:.22s;margin-top:18px">
          <div class="card kpi"><div class="label">Interests</div><div class="value">22<small>categories</small></div><div class="foot">Mapped from channels and titles, no cloud calls</div></div>
          <div class="card kpi"><div class="label">Evolution</div><div class="value">Q<small>by Q</small></div><div class="foot">Persistent vs rising vs fading, per quarter</div></div>
          <div class="card kpi"><div class="label">Portrait</div><div class="value">AI<small>optional</small></div><div class="foot">Bring your own key, or use the built-in writer</div></div>
        </div>
        <p class="hint reveal" style="animation-delay:.24s;margin-top:18px;text-align:center">
          Want the AI portrait too? <a class="link" href="#settings">Connect a model</a> — one key, saved on this machine.
        </p>
        <p class="hint reveal" style="animation-delay:.26s;margin-top:14px;text-align:center">
          How to get the file: <a class="link" href="https://takeout.google.com" target="_blank" rel="noopener">takeout.google.com</a>
          → deselect all → tick <b>YouTube and YouTube Music</b> → format <b>HTML</b> → export.
        </p>
      </div>`;
    wireDropzone();
  }

  function wireDropzone() {
    const dz = $('#dz'), inp = $('#file');
    $('#btn-file').addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { if (inp.files[0]) start(inp.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files[0];
      if (f) start(f);
    });
  }

  function progress(pct, step) {
    const p = $('#prog');
    if (!p) return;
    if (!p.firstChild) {
      p.className = 'progress';
      p.innerHTML = '<div class="bar"><i></i></div><div class="step"></div>';
    }
    p.querySelector('.bar i').style.width = Math.max(2, pct) + '%';
    p.querySelector('.step').textContent = step;
  }

  /* ─────────────────────────── pipeline ─────────────────────────── */
  /* Upload pipeline, in two halves:
   *   readAndAnalyse() — unzip, parse, profile, facts, clusters. All local.
   *   start()          — runs that, then shows the mode gate.
   * The gate exists so the AI choice is made with real numbers visible
   * ("9,645 videos", "19 clusters found") rather than before uploading. */
  async function readAndAnalyse(file) {
    $('#btn-file').disabled = true;
    progress(4, 'Reading ' + file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB)');

    let files;
    if (/\.zip$/i.test(file.name)) {
      const buf = await file.arrayBuffer();
      progress(12, 'Opening archive');
      files = await window.YSZip.readTakeoutZip(buf, (name, i, total) => {
        progress(12 + (i / total) * 48, 'Extracting ' + name.split('/').pop());
      });
    } else {
      const text = await file.text();
      files = [{ name: file.name, text }];
    }
    if (!files.length) throw new Error('No readable files found. Is this a YouTube Takeout zip?');

    progress(62, 'Parsing ' + files.length + ' files');
    await tick();
    const data = window.YSTakeout.parseTakeoutFiles(files);
    if (!data.watch.length) {
      throw new Error('Found the archive but no watch history inside. Make sure "YouTube and YouTube Music" was selected, and choose HTML format (not JSON).');
    }

    progress(74, 'Analysing ' + fmt(data.watch.length) + ' watch events');
    await tick();
    const profile = window.YSAnalytics.buildProfile(data, window.YSTaxonomy, { now: Date.now() });

    progress(84, 'Writing the built-in reading');
    await tick();
    const insights = window.YSInsights.build(profile);

    // facts + clusters power the personalised path and inform the gate
    progress(90, 'Finding patterns in your viewing');
    await tick();
    let facts = null, clusters = null;
    try {
      const tz = (profile.timezone && profile.timezone.offsetMin) || 0;
      facts = window.YSFacts.build(data, { tzOffsetMin: tz });
      if (facts) facts.eras = window.YSFacts.eras(facts, data.watch);
      clusters = window.YSCluster.build(data.watch, { maxClusters: 18 });
    } catch (e) { console.warn('facts/clusters unavailable:', e.message); }

    progress(98, 'Ready');
    return { data, profile, insights, facts, clusters, fileName: file.name };
  }

  async function start(file) {
    try {
      const result = await readAndAnalyse(file);
      S.pending = result;
      renderGate();
    } catch (e) {
      console.error(e);
      renderLanding({ title: 'Could not read that file', body: e.message });
    }
  }

  /* Commit the analysed data into app state and persist what is safe to keep.
   * Raw events stay in memory only; the aggregate survives a refresh. */
  function commitPending(mode) {
    const r = S.pending;
    if (!r) return false;
    S.data = r.data;
    S.profile = r.profile;
    S.insights = r.insights;
    S.facts = r.facts;
    S.clusters = r.clusters;
    S.fileName = r.fileName;
    S.mode = mode;
    try {
      sessionStorage.setItem('youscope.profile', JSON.stringify({
        profile: r.profile, insights: r.insights, fileName: r.fileName,
        facts: r.facts, mode,
        dataLight: {
          watch: [],
          search: r.data.search, subscriptions: r.data.subscriptions,
          comments: r.data.comments, playlists: r.data.playlists,
          musicLibrary: r.data.musicLibrary,
        },
      }));
    } catch (e) { /* quota — no reload persistence, fine */ }
    return true;
  }

  /* ── the mode gate ─────────────────────────────────────────── */
  function renderGate() {
    const r = S.pending;
    if (!r) return renderLanding();
    mount('overview');

    const c = r.clusters;
    const f = r.facts;
    const canAi = window.YSsettings ? window.YSsettings.proxyMode() : false;
    const clusterLine = c && c.clusters.length
      ? 'Grouped your viewing into **' + c.clusters.length + ' clusters** by shared vocabulary.'
      : '';
    const factsLine = f
      ? fmt(f.totalWatched) + ' videos · ' + fmt(f.channels) + ' channels · ' +
        (f.eras ? f.eras.length + ' phases' : '') + ' · ' +
        f.longReturns.length + ' channels returned after a long gap'
      : '';

    const m = $('#main');
    m.innerHTML = `
      <div style="max-width:820px;margin:14px auto 0">
        <div class="eyebrow reveal" style="margin-bottom:16px">STEP 2 OF 2 · HOW SHOULD I READ THIS?</div>
        <h1 class="reveal" style="animation-delay:.04s;font-size:clamp(1.9rem,3.4vw,2.9rem)">
          ${esc(r.fileName)}
        </h1>
        <p class="lede reveal" style="animation-delay:.08s;margin:16px 0 8px">${factsLine}</p>
        <p class="hint reveal" style="animation-delay:.1s;margin-bottom:30px">${clusterLine}</p>

        <div class="grid g-2 reveal" style="animation-delay:.14s;gap:14px">
          <button class="tier on" id="gate-ai" style="padding:22px 20px;text-align:left">
            <div class="tier-top"><span class="tier-icon">●</span>
              <span class="tier-name">Personalised</span>
              <span class="tier-badge">recommended</span></div>
            <div class="tier-cost">≈5 API calls · ${canAi ? 'key ready' : 'needs a model'}</div>
            <div class="tier-desc">I read your actual videos, name your interests in your own
              words, and build the report around what is genuinely interesting here.</div>
            <div class="tier-detail">No preset categories · no template sections</div>
          </button>

          <button class="tier" id="gate-instant" style="padding:22px 20px;text-align:left">
            <div class="tier-top"><span class="tier-icon">◐</span>
              <span class="tier-name">Instant</span></div>
            <div class="tier-cost">free · no key · ~2s</div>
            <div class="tier-desc">Charts from the numbers on this device. Uses a fixed set of
              22 categories, so it may not match how you would describe yourself.</div>
            <div class="tier-detail">Nothing leaves the browser</div>
          </button>
        </div>

        <div class="reveal" style="animation-delay:.2s;margin-top:26px;display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          <button class="btn" id="gate-go">Continue</button>
          <button class="btn ghost" id="gate-back">Choose a different file</button>
          <span class="hint" id="gate-note"></span>
        </div>

        <p class="hint reveal" style="animation-delay:.24s;margin-top:26px;line-height:1.7">
          Personalised sends your video titles to the model you configured — that is what makes
          the reading specific. Instant never touches the network.
          <a class="link" href="#settings">Change model</a>
        </p>
      </div>`;

    let choice = canAi ? 'ai' : 'instant';
    const aiBtn = $('#gate-ai'), instBtn = $('#gate-instant'), goBtn = $('#gate-go'), note = $('#gate-note');

    const paint = () => {
      aiBtn.classList.toggle('on', choice === 'ai');
      instBtn.classList.toggle('on', choice === 'instant');
      goBtn.textContent = choice === 'ai' ? 'Personalise my report' : 'Show my dashboard';
      note.textContent = choice === 'ai' && !canAi
        ? 'Open this from the local app (node server.mjs) to use a model.'
        : '';
    };
    aiBtn.addEventListener('click', () => { choice = 'ai'; paint(); });
    instBtn.addEventListener('click', () => { choice = 'instant'; paint(); });
    $('#gate-back').addEventListener('click', () => { S.pending = null; renderLanding(); });
    goBtn.addEventListener('click', async () => {
      if (choice === 'ai' && !canAi) { location.hash = '#settings'; return; }
      if (choice === 'instant') {
        commitPending('instant');
        goBtn.disabled = true; goBtn.textContent = 'Building…';
        await tick();
        location.hash = 'overview';
        renderView('overview');
        return;
      }
      commitPending('ai');
      goBtn.disabled = true; goBtn.innerHTML = '<span class="spin"></span> personalising';
      location.hash = 'portrait';
      renderView('portrait', { autorun: 'personal' });
    });
    paint();
  }

  const tick = () => new Promise(r => setTimeout(r, 16));

  /* ─────────────────────────── views ─────────────────────────── */
  function renderView(id, opts) {
    // Settings is reachable before any data is loaded — it is the first thing
    // a new user needs.
    if (id === 'settings') {
      mount('settings');
      $('#nav').innerHTML = navHTML('settings');
      $$('#nav a').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); location.hash = a.dataset.view; }));
      $('#btn-reset').addEventListener('click', resetAll);
      const m = $('#main');
      m.innerHTML = topbar('Connect a model', 'YouScope · settings', [
        { text: window.YSsettings.proxyMode() ? 'local app' : 'opened as file', cls: window.YSsettings.proxyMode() ? 'good' : 'warn' },
      ]);
      const host = h('div');
      m.appendChild(host);
      window.YSsettings.render(host, () => { /* saved; nothing to reload */ });
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    if (!S.profile) return renderLanding();
    const p = S.profile;
    mount(id);
    const m = $('#main');
    $('#nav').innerHTML = navHTML(id);
    $$('#nav a').forEach(a => a.addEventListener('click', (e) => { e.preventDefault(); location.hash = a.dataset.view; }));
    $('#btn-reset').addEventListener('click', resetAll);

    if (id.startsWith('story')) {
      const idx = Number(id.slice(5));
      return viewStory(m, S.personalized && S.personalized.sections[idx], idx);
    }
    const views = { overview: viewOverview, interests: viewInterests, evolution: viewEvolution,
      rhythm: viewRhythm, channels: viewChannels, music: viewMusic, search: viewSearch,
      portrait: viewPortrait, settings: viewSettings };
    const prof = (S.aiProfile && ['overview', 'interests', 'evolution'].includes(id))
      ? S.aiProfile : p;
    (views[id] || viewOverview)(m, prof, opts || {});
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function topbar(title, sub, chips) {
    return `<div class="topbar">
      <div>
        <div class="eyebrow" style="margin-bottom:8px">${esc(sub)}</div>
        <h1>${esc(title)}</h1>
      </div>
      <div class="spacer"></div>
      ${(chips || []).map(c => `<span class="chip ${c.cls || ''}">${esc(c.text)}</span>`).join('')}
    </div>`;
  }

  function rangeChip(p) {
    const d = (ms) => new Date(ms).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    return { text: d(p.range.first) + ' → ' + d(p.range.last) };
  }

  /* ── OVERVIEW ── */
  function viewOverview(m, p) {
    const C = window.YSCharts;
    const monthly = p.monthlySeries;
    const insights = S.insights;
    m.innerHTML = topbar('The shape of your attention', 'YouScope · overview', [
      rangeChip(p),
      { text: fmt(p.counts.watchEvents) + ' watches', cls: 'good' },
      ...(p.taxonomySource === 'ai-taxonomy' ? [{ text: 'your taxonomy', cls: 'good' }] : []),
      { text: p.timezone.label || 'UTC' },
    ]);

    const wrap = h('div');
    m.appendChild(wrap);

    // When the model has written a headline, it leads — that is the conclusion,
    // and the KPIs below are the evidence for it.
    if (S.personalized && S.personalized.headline) {
      const lede = h('div', { class: 'card reveal', style: 'margin-bottom:16px;border-color:rgba(125,255,179,.28)' });
      lede.innerHTML = `
        <div style="font-family:var(--serif);font-size:clamp(1.25rem,2.4vw,1.75rem);line-height:1.3;letter-spacing:-.01em">
          ${esc(S.personalized.headline)}
        </div>
        ${S.personalized.noticed ? `<div class="hint" style="margin-top:10px">${esc(S.personalized.noticed)}</div>` : ''}
        <div class="tags" style="margin-top:14px">
          ${(S.personalized.sections || []).slice(0, 4).map((sec, i) =>
            `<a class="tag hot" href="#story${i}" style="text-decoration:none">${esc(shortLabel(sec.title))}</a>`).join('')}
        </div>`;
      wrap.appendChild(lede);
    }

    // KPI row
    const kpis = h('div', { class: 'grid g-4 reveal' });
    const sessionsMedian = p.sessions.medianLength;
    [
      ['Videos watched', fmt(p.counts.watchEvents), `${fmt(p.counts.uniqueChannels)} channels · ${p.activity.avgPerActiveDay}/active day`],
      ['Days with activity', fmt(p.activity.activeDays), `longest streak <b>${p.activity.longestStreak}</b> days`],
      ['Music plays', fmt(p.counts.musicPlays), `${(100 * p.counts.musicPlays / p.counts.watchEvents).toFixed(0)}% of everything`],
      ['Peak hour', String(p.clock.peakHour).padStart(2, '0') + ':00', `median session <b>${sessionsMedian}</b> videos`],
    ].forEach(([label, val, foot]) => {
      kpis.appendChild(h('div', { class: 'card kpi' },
        `<div class="label">${label}</div><div class="value">${val}</div><div class="foot">${foot}</div>`));
    });
    wrap.appendChild(kpis);

    // timeline
    const tl = h('div', { class: 'card reveal', style: 'margin-top:16px;animation-delay:.06s' });
    tl.appendChild(h('div', { class: 'card-head' },
      `<h3>Watch volume</h3><span class="sub">per month · ${monthly.length} months</span>`));
    tl.appendChild(C.areaChart(monthly.map(x => ({ label: x.month, value: x.count })),
      { h: 240, labels: monthly.map(x => x.month.replace('-', ' ').replace('20', "'")), color: 'var(--accent)', unit: 'watches', xTicks: 10 }));
    wrap.appendChild(tl);

    // heatmap + clock
    const row = h('div', { class: 'grid g-2-1 reveal', style: 'margin-top:16px;animation-delay:.12s' });
    const hm = h('div', { class: 'card' });
    hm.appendChild(h('div', { class: 'card-head' }, `<h3>Every day you pressed play</h3><span class="sub">${p.activity.activeDays} active days</span>`));
    hm.appendChild(C.heatmap(p.dailyCounts));
    hm.appendChild(h('div', { class: 'hint', style: 'margin-top:14px' },
      `Busiest day: <b>${p.activity.busiestDay ? p.activity.busiestDay.date : '—'}</b> with ${p.activity.busiestDay ? p.activity.busiestDay.count : 0} watches.`));
    row.appendChild(hm);

    const ck = h('div', { class: 'card' });
    ck.appendChild(h('div', { class: 'card-head' }, `<h3>When you watch</h3>`));
    ck.appendChild(C.clockRing(p.clock.hours, { centerTop: String(p.clock.peakHour).padStart(2, '0'), centerBottom: 'PEAK HOUR' }));
    ck.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-top:10px' },
      `${(p.clock.nightOwlScore * 100).toFixed(0)}% happens between midnight and 6am`));
    row.appendChild(ck);
    wrap.appendChild(row);

    // top interests + channels
    const row2 = h('div', { class: 'grid g-2 reveal', style: 'margin-top:16px;animation-delay:.18s' });
    const ti = h('div', { class: 'card' });
    ti.appendChild(h('div', { class: 'card-head' }, `<h3>Interest mix</h3><span class="sub">top 8 of ${p.interests.cats.length}</span>`));
    ti.appendChild(C.barRows(p.interests.cats.slice(0, 8).map(c => ({ name: c.label, count: c.count, color: c.color })), { suffix: '' }));
    ti.appendChild(h('div', { class: 'hint', style: 'margin-top:14px' },
      `${p.interests.coverage}% of watches classified. The rest is one-off long tail.`));
    row2.appendChild(ti);

    const tc = h('div', { class: 'card' });
    tc.appendChild(h('div', { class: 'card-head' }, `<h3>Most-watched channels</h3><span class="sub">all time</span>`));
    const listEl = h('div', { class: 'list' });
    p.top.channels.slice(0, 9).forEach((c, i) => {
      listEl.appendChild(h('div', { class: 'row' },
        `<span class="idx">${String(i + 1).padStart(2, '0')}</span><span class="ttl">${esc(c.name)}</span><span class="meta">${fmt(c.count)}</span>`));
    });
    tc.appendChild(listEl);
    row2.appendChild(tc);
    wrap.appendChild(row2);

    // headline insight
    if (insights && insights.sections.length) {
      const ins = h('div', { class: 'card reveal', style: 'margin-top:16px;animation-delay:.24s' });
      ins.appendChild(h('div', { class: 'card-head' },
        `<h3>The short version</h3><a class="sub link" href="#portrait" style="text-decoration:none">full portrait →</a>`));
      const narr = h('div', { class: 'narr' });
      narr.innerHTML = insights.sections.slice(0, 2).map(s => `<p>${md(s.body)}</p>`).join('');
      ins.appendChild(narr);
      wrap.appendChild(ins);
    }
  }

  /* ── INTERESTS ── */
  function viewInterests(m, p) {
    const C = window.YSCharts;
    m.innerHTML = topbar(
      p.taxonomySource === 'ai-taxonomy' ? 'What you actually care about' : 'What you actually care about',
      p.taxonomySource === 'ai-taxonomy' ? 'YouScope · your own taxonomy' : 'YouScope · interests', [
      { text: p.interests.coverage + '% classified', cls: p.interests.coverage > 80 ? 'good' : 'warn' },
      { text: p.interests.cats.length + (p.taxonomySource === 'ai-taxonomy' ? ' groups' : ' categories') },
      ...(p.taxonomySource === 'ai-taxonomy' ? [{ text: 'named by the model', cls: 'good' }] : []),
    ]);
    const wrap = h('div', { class: 'reveal' });
    m.appendChild(wrap);

    // donut-ish stacked bar of all categories
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-head' }, `<h3>Your attention, ranked</h3><span class="sub">share of ${fmt(p.counts.watchEvents)} watches</span>`));
    const bars = h('div', { class: 'bars' });
    p.interests.cats.forEach((c) => {
      const row = h('div', { class: 'brow' });
      const track = h('div', { class: 'track' });
      const fill = h('div', { class: 'fill' });
      fill.style.width = Math.max(1.2, (c.share / p.interests.cats[0].share) * 100) + '%';
      fill.style.background = `linear-gradient(90deg, ${c.color}66, ${c.color}1f)`;
      track.appendChild(fill);
      track.appendChild(h('div', { class: 'nm', style: 'padding-left:10px' }, esc(c.label)));
      row.appendChild(track);
      row.appendChild(h('div', { class: 'ct', style: 'color:' + c.color }, c.share + '%'));
      bars.appendChild(row);
    });
    card.appendChild(bars);
    wrap.appendChild(card);

    // per-category detail grid
    const grid = h('div', { class: 'grid g-3', style: 'margin-top:16px' });
    p.interests.cats.slice(0, 9).forEach(c => {
      const cc = h('div', { class: 'card', style: 'border-color:' + c.color + '33' });
      cc.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:10px">
          <span style="width:7px;height:7px;border-radius:50%;background:${c.color};box-shadow:0 0 9px ${c.color};flex:0 0 7px"></span>
          <h3 style="font-size:.95rem;color:var(--text)">${esc(c.label)}</h3>
          <span class="mono" style="margin-left:auto;font-size:.78rem;color:${c.color}">${c.share}%</span>
        </div>
        <div class="dim mono" style="font-size:.7rem;margin-bottom:9px">${fmt(c.count)} watches</div>
        <div class="list">${c.topChannels.map((ch, i) => `<div class="row" style="padding:5px 0"><span class="idx">${i + 1}</span><span class="ttl" style="font-size:.79rem">${esc(ch.name)}</span><span class="meta">${fmt(ch.n)}</span></div>`).join('')}</div>`;
      grid.appendChild(cc);
    });
    wrap.appendChild(grid);
  }

  /* ── EVOLUTION ── */
  function viewEvolution(m, p) {
    const C = window.YSCharts;
    m.innerHTML = topbar('How you changed',
      p.taxonomySource === 'ai-taxonomy' ? 'YouScope · your own taxonomy' : 'YouScope · evolution', [
      { text: p.evolution.quarters.length + ' quarters' },
      ...(p.taxonomySource === 'ai-taxonomy' ? [{ text: 'your groups', cls: 'good' }] : []),
      rangeChip(p),
    ]);
    const wrap = h('div', { class: 'reveal' });
    m.appendChild(wrap);

    // stream graph
    const sc = h('div', { class: 'card' });
    sc.appendChild(h('div', { class: 'card-head' }, `<h3>Interest composition over time</h3><span class="sub">share of quarterly watches · top 9 categories</span>`));
    sc.appendChild(C.streamChart(p.evolution.quarters, p.evolution.trajectories, { h: 300, layers: 9 }));
    const legend = h('div', { class: 'tags', style: 'margin-top:16px' });
    p.evolution.trajectories.slice(0, 9).forEach(t => {
      const tag = h('span', { class: 'tag' });
      tag.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${t.color};margin-right:6px"></span>${esc(t.label)}`;
      legend.appendChild(tag);
    });
    sc.appendChild(legend);
    wrap.appendChild(sc);

    // trajectories
    const nQ = p.evolution.quarters.length;
    const shortSpan = nQ < 5;
    const groups = [
      shortSpan
        ? { id: 'steady', title: 'Steady core', cls: 'hot', blurb: `Present throughout, with no strong trend inside this ${nQ}-quarter window. A longer export would separate the truly persistent from the merely current.` }
        : { id: 'persistent', title: 'Persistent — never left', cls: 'hot', blurb: 'Present in every single quarter, and materially so. This is the load-bearing part of your identity.' },
      { id: 'rising', title: 'Rising', cls: 'cool', blurb: 'Grew sharply toward the end of the window.' },
      { id: 'fading', title: 'Fading', cls: 'warm', blurb: 'Peaked earlier and has been declining since.' },
      { id: 'faded', title: 'Gone quiet', cls: '', blurb: 'Dropped to zero after a real presence.' },
    ];
    const g2 = h('div', { class: 'grid g-2', style: 'margin-top:16px' });
    groups.forEach(g => {
      const items = p.evolution.trajectories.filter(t => t.trajectory === g.id && t.total >= 20);
      if (!items.length) return;
      const card = h('div', { class: 'card' });
      card.appendChild(h('div', { class: 'card-head' },
        `<h3>${g.title}</h3><span class="sub">${items.length}</span>`));
      card.appendChild(h('div', { class: 'hint', style: 'margin-bottom:13px' }, g.blurb));
      const tags = h('div', { class: 'tags' });
      items.forEach(t => {
        const tag = h('span', { class: 'tag ' + g.cls });
        tag.innerHTML = `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${t.color};margin-right:6px"></span>${esc(t.label)} <span style="opacity:.6">${fmt(t.total)}</span>`;
        tags.appendChild(tag);
      });
      card.appendChild(tags);
      g2.appendChild(card);
    });
    wrap.appendChild(g2);

    // quarter table
    const qt = h('div', { class: 'card', style: 'margin-top:16px' });
    qt.appendChild(h('div', { class: 'card-head' }, `<h3>Quarter by quarter</h3><span class="sub">top 3 interests each quarter</span>`));
    const tbl = h('div', { class: 'list' });
    [...p.evolution.quarters].reverse().forEach(q => {
      const top = q.cats.slice(0, 3).map(c => {
        const meta = window.YSTaxonomy.getCategory(c.id);
        return `<span style="color:${meta ? meta.color : '#888'}">${esc(meta ? meta.label : c.id)}</span> <span class="dim">${c.share}%</span>`;
      }).join(' · ');
      tbl.appendChild(h('div', { class: 'row', style: 'grid-template-columns:80px 1fr auto' },
        `<span class="mono dim" style="font-size:.74rem">${esc(q.quarter)}</span><span class="ttl" style="white-space:normal;font-size:.82rem">${top}</span><span class="meta">${fmt(q.total)}</span>`));
    });
    qt.appendChild(tbl);
    wrap.appendChild(qt);
  }

  /* ── RHYTHM ── */
  function viewRhythm(m, p) {
    const C = window.YSCharts;
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    m.innerHTML = topbar('Your daily rhythm', 'YouScope · rhythm', [
      { text: 'peak ' + String(p.clock.peakHour).padStart(2, '0') + ':00', cls: 'good' },
      { text: (p.clock.nightOwlScore * 100).toFixed(0) + '% after midnight' },
    ]);
    const wrap = h('div', { class: 'reveal' });
    m.appendChild(wrap);

    const row = h('div', { class: 'grid g-2' });
    const clock = h('div', { class: 'card' });
    clock.appendChild(h('div', { class: 'card-head' }, `<h3>Clock of attention</h3><span class="sub">all watches by hour</span>`));
    clock.appendChild(C.clockRing(p.clock.hours, { centerTop: String(p.clock.peakHour).padStart(2, '0'), centerBottom: 'PEAK HOUR' }));
    row.appendChild(clock);

    const wk = h('div', { class: 'card' });
    wk.appendChild(h('div', { class: 'card-head' }, `<h3>Weekday distribution</h3>`));
    wk.appendChild(C.barRows(days.map((d, i) => ({ name: d, count: p.clock.weekdays[i] }))
      .sort((a, b) => b.count - a.count), {}));
    row.appendChild(wk);
    wrap.appendChild(row);

    // hour heat grid (weekday × hour)
    const hg = h('div', { class: 'card', style: 'margin-top:16px' });
    hg.appendChild(h('div', { class: 'card-head' }, `<h3>Weekday × hour</h3><span class="sub">where your attention concentrates</span>`));
    const maxV = Math.max(...p.clock.hourWeekday.flat(), 1);
    const grid = h('div', { style: 'display:grid;grid-template-columns:42px repeat(24,1fr);gap:3px;align-items:center' });
    grid.appendChild(h('div'));
    for (let hr = 0; hr < 24; hr++) {
      grid.appendChild(h('div', { class: 'mono dim', style: 'font-size:8.5px;text-align:center' }, hr % 3 === 0 ? String(hr) : ''));
    }
    for (let d = 0; d < 7; d++) {
      grid.appendChild(h('div', { class: 'mono dim', style: 'font-size:9.5px' }, days[d]));
      for (let hr = 0; hr < 24; hr++) {
        const v = p.clock.hourWeekday[d][hr];
        const t = Math.pow(v / maxV, 0.55);
        const cell = h('div', {
          style: `height:20px;border-radius:2px;background:rgba(125,255,179,${(v ? 0.1 + t * 0.9 : 0.04).toFixed(3)})`,
          'data-v': v, 'data-d': days[d] + ' ' + hr + ':00',
        });
        cell.addEventListener('mousemove', (e) => C.showTip(e, `${cell.dataset.d} · <b>${v}</b>`));
        cell.addEventListener('mouseleave', C.hideTip);
        grid.appendChild(cell);
      }
    }
    hg.appendChild(grid);
    wrap.appendChild(hg);

    // sessions + binges
    const row2 = h('div', { class: 'grid g-2', style: 'margin-top:16px' });
    const sess = h('div', { class: 'card' });
    sess.appendChild(h('div', { class: 'card-head' }, `<h3>Longest sessions</h3><span class="sub">consecutive watches under 30 min apart</span>`));
    const sl = h('div', { class: 'list' });
    p.sessions.longest.slice(0, 8).forEach((s, i) => {
      const when = new Date(s.start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      sl.appendChild(h('div', { class: 'row' },
        `<span class="idx">${i + 1}</span><span class="ttl">${s.durationMin} min · ${esc(s.topChannel || 'mixed')}<span class="dim"> — ${when}</span></span><span class="meta">${s.n} vids</span>`));
    });
    sess.appendChild(sl);
    row2.appendChild(sess);

    const binge = h('div', { class: 'card' });
    binge.appendChild(h('div', { class: 'card-head' }, `<h3>Binges</h3><span class="sub">4+ of one channel in 24h</span>`));
    const bl = h('div', { class: 'list' });
    p.binges.slice(0, 8).forEach((b, i) => {
      const when = new Date(b.start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
      bl.appendChild(h('div', { class: 'row' },
        `<span class="idx">${i + 1}</span><span class="ttl">${esc(b.channel)}<span class="dim"> — ${when}</span></span><span class="meta">${b.n}</span>`));
    });
    binge.appendChild(bl);
    row2.appendChild(binge);
    wrap.appendChild(row2);
  }

  /* ── CHANNELS ── */
  function viewChannels(m, p) {
    m.innerHTML = topbar('Who you keep coming back to', 'YouScope · channels', [
      { text: fmt(p.counts.uniqueChannels) + ' distinct' },
      { text: p.counts.subscriptions + ' subscribed' },
    ]);
    const wrap = h('div', { class: 'reveal' });
    m.appendChild(wrap);

    const row = h('div', { class: 'grid g-2-1' });
    const top = h('div', { class: 'card' });
    top.appendChild(h('div', { class: 'card-head' }, `<h3>Top 25 channels</h3><span class="sub">every watch counts</span>`));
    top.appendChild(window.YSCharts.barRows(p.top.channels.slice(0, 25).map(c => ({ name: c.name, count: c.count }))));
    row.appendChild(top);

    const dd = h('div', { class: 'card' });
    dd.appendChild(h('div', { class: 'card-head' }, `<h3>Deep dives</h3><span class="sub">loyalty, not one-offs</span>`));
    dd.appendChild(h('div', { class: 'hint', style: 'margin-bottom:12px' }, 'Channels you returned to across many different days — the real relationships.'));
    const ddl = h('div', { class: 'list' });
    p.deepDives.slice(0, 12).forEach((d, i) => {
      ddl.appendChild(h('div', { class: 'row' },
        `<span class="idx">${i + 1}</span><span class="ttl">${esc(d.channel)}</span><span class="meta">${d.watches}w / ${d.days}d</span>`));
    });
    dd.appendChild(ddl);
    row.appendChild(dd);
    wrap.appendChild(row);

    // top videos
    const tv = h('div', { class: 'card', style: 'margin-top:16px' });
    tv.appendChild(h('div', { class: 'card-head' }, `<h3>Most-rewatched videos</h3><span class="sub">same video, again and again</span>`));
    const tvl = h('div', { class: 'list' });
    p.top.videos.slice(0, 14).forEach((v, i) => {
      tvl.appendChild(h('div', { class: 'row' },
        `<span class="idx">${i + 1}</span><a class="ttl" href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title)}</a><span class="meta">${v.count}× · ${esc(v.channel)}</span>`));
    });
    tv.appendChild(tvl);
    wrap.appendChild(tv);

    // subscriptions
    if (S.data && S.data.subscriptions.length) {
      const subs = h('div', { class: 'card', style: 'margin-top:16px' });
      subs.appendChild(h('div', { class: 'card-head' }, `<h3>Subscriptions</h3><span class="sub">${S.data.subscriptions.length} channels</span>`));
      const tags = h('div', { class: 'tags' });
      S.data.subscriptions.slice(0, 80).forEach(s => tags.appendChild(h('span', { class: 'tag' }, esc(s.title))));
      subs.appendChild(tags);
      wrap.appendChild(subs);
    }
  }

  /* ── MUSIC ── */
  function viewMusic(m, p) {
    m.innerHTML = topbar('Your listening', 'YouScope · music', [
      { text: fmt(p.counts.musicPlays) + ' plays' },
      { text: (100 * p.counts.musicPlays / p.counts.watchEvents).toFixed(0) + '% of all watching' },
    ]);
    const wrap = h('div', { class: 'reveal' });
    m.appendChild(wrap);

    if (!p.counts.musicPlays) {
      wrap.appendChild(h('div', { class: 'state' }, `<h3>No YouTube Music history</h3><p class="muted">This export didn't include any music plays.</p>`));
      return;
    }

    const row = h('div', { class: 'grid g-2' });
    const art = h('div', { class: 'card' });
    art.appendChild(h('div', { class: 'card-head' }, `<h3>Top artists</h3><span class="sub">by plays</span>`));
    art.appendChild(window.YSCharts.barRows(p.top.musicArtists.slice(0, 15).map(a => ({ name: a.name, count: a.count })), { alt: true }));
    row.appendChild(art);

    const tr = h('div', { class: 'card' });
    tr.appendChild(h('div', { class: 'card-head' }, `<h3>Most-played tracks</h3><span class="sub">top 20</span>`));
    const tl = h('div', { class: 'list' });
    p.top.musicTracks.slice(0, 20).forEach((t, i) => {
      tl.appendChild(h('div', { class: 'row' },
        `<span class="idx">${i + 1}</span><a class="ttl" href="${esc(t.url)}" target="_blank" rel="noopener">${esc(t.title)}</a><span class="meta">${t.count}×</span>`));
    });
    tr.appendChild(tl);
    row.appendChild(tr);
    wrap.appendChild(row);

    if (p.extra.musicLibraryArtists.length) {
      const lib = h('div', { class: 'card', style: 'margin-top:16px' });
      lib.appendChild(h('div', { class: 'card-head' }, `<h3>Saved library</h3><span class="sub">${p.extra.musicLibraryArtists.length} artists with saved songs</span>`));
      const tags = h('div', { class: 'tags' });
      p.extra.musicLibraryArtists.forEach(a => tags.appendChild(h('span', { class: 'tag cool' }, `${esc(a.name)} · ${a.songs}`)));
      lib.appendChild(tags);
      wrap.appendChild(lib);
    }
  }

  /* ── SEARCH ── */
  function viewSearch(m, p) {
    m.innerHTML = topbar('What you went looking for', 'YouScope · searches', [
      { text: fmt(p.counts.searches) + ' searches' },
    ]);
    const wrap = h('div', { class: 'reveal' });
    m.appendChild(wrap);

    const row = h('div', { class: 'grid g-2' });
    const th = h('div', { class: 'card' });
    th.appendChild(h('div', { class: 'card-head' }, `<h3>Search themes</h3><span class="sub">intent behind the query</span>`));
    th.appendChild(window.YSCharts.barRows(p.searchThemes.themes.map(t => ({ name: t.label, count: t.n })), {}));
    row.appendChild(th);

    const rep = h('div', { class: 'card' });
    rep.appendChild(h('div', { class: 'card-head' }, `<h3>Most repeated</h3><span class="sub">you searched this more than once</span>`));
    const rl = h('div', { class: 'list' });
    p.top.searchTerms.slice(0, 16).forEach((s, i) => {
      rl.appendChild(h('div', { class: 'row' },
        `<span class="idx">${i + 1}</span><span class="ttl">${esc(s.name)}</span><span class="meta">${s.count}×</span>`));
    });
    rep.appendChild(rl);
    row.appendChild(rep);
    wrap.appendChild(row);

    // samples per theme
    const grid = h('div', { class: 'grid g-2', style: 'margin-top:16px' });
    p.searchThemes.themes.slice(0, 6).forEach(t => {
      const card = h('div', { class: 'card' });
      card.appendChild(h('div', { class: 'card-head' }, `<h3>${esc(t.label)}</h3><span class="sub">${t.n}</span>`));
      const tags = h('div', { class: 'tags' });
      t.samples.slice(0, 10).forEach(q => tags.appendChild(h('span', { class: 'tag' }, esc(q))));
      card.appendChild(tags);
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  /* Called when the personalised run finishes: rebuild every statistic against
   * the model's grouping and repaint whichever view is open. */
  function adoptTaxonomy(personalized) {
    if (!personalized || !personalized.taxonomy || !S.data) return false;
    try {
      const tz = (S.profile.timezone && S.profile.timezone.offsetMin) || 0;
      const r = window.YSRetax.build(S.data, S.profile, personalized.taxonomy, { tzOffsetMin: tz });
      const base = S.profile;
      S.aiProfile = {
        ...base,
        interests: r.interests,
        evolution: r.evolution,
        taxonomySource: 'ai-taxonomy',
        taxonomyNames: personalized.taxonomy.map((t) => t.name),
      };
      S.personalized = personalized;
      // Rebuild navigation immediately: the model's sections become pages.
      const nav = $('#nav');
      if (nav) {
        const current = (location.hash || '#overview').slice(1) || 'overview';
        nav.innerHTML = navHTML(current);
        $$('#nav a').forEach((a) => a.addEventListener('click', (e) => {
          e.preventDefault();
          if (!S.profile && a.dataset.view !== 'settings') return;
          location.hash = a.dataset.view;
        }));
      }
      try {
        sessionStorage.setItem('youscope.aiProfile', JSON.stringify({
          aiProfile: S.aiProfile,
          taxonomyNames: S.aiProfile.taxonomyNames,
        }));
      } catch (e) { /* quota */ }
      return true;
    } catch (e) {
      console.warn('could not adopt taxonomy:', e.message);
      return false;
    }
  }

  /* Which profile should the charts use right now? */
  function activeProfile() {
    const id = (location.hash || '#overview').slice(1) || 'overview';
    const aiAware = ['overview', 'interests', 'evolution'];
    return (S.aiProfile && aiAware.includes(id)) ? S.aiProfile : S.profile;
  }

  /* Nudge the user that the numbers just changed underneath them. */
  function flashTaxonomyNotice() {
    const bar = h('div', {
      id: 'tax-notice',
      style: 'position:fixed;left:50%;transform:translateX(-50%);bottom:26px;z-index:9998;' +
        'background:rgba(6,10,8,.97);border:1px solid rgba(125,255,179,.45);border-radius:12px;' +
        'padding:13px 18px;display:flex;gap:14px;align-items:center;box-shadow:0 16px 48px rgba(0,0,0,.6)',
    });
    bar.innerHTML = `<span style="width:7px;height:7px;border-radius:50%;background:var(--accent);
        box-shadow:0 0 10px var(--accent);flex:0 0 7px"></span>
      <span style="font-size:.86rem">Your interest groups are now the model's, not the presets.
        Charts updated.</span>
      <button class="btn ghost sm" style="padding:5px 10px">See overview</button>
      <button class="btn ghost sm" style="padding:5px 10px;opacity:.7">dismiss</button>`;
    document.body.appendChild(bar);
    const [seeBtn, closeBtn] = bar.querySelectorAll('button');
    seeBtn.addEventListener('click', () => { location.hash = '#overview'; bar.remove(); });
    closeBtn.addEventListener('click', () => bar.remove());
    setTimeout(() => { if (bar.parentNode) bar.remove(); }, 14000);
  }

  /* A small inline note for views that are showing AI-derived numbers. */
  function taxonomyBadge(p) {
    if (!p || p.taxonomySource !== 'ai-taxonomy') return '';
    return `<span class="chip good" title="These numbers use the interest groups the model named for you, not the built-in categories.">your taxonomy</span>`;
  }

  /* ── PORTRAIT (tiered: built-in / digest / full) ── */
  function viewPortrait(m, p, opts) {
    m.innerHTML = topbar('The portrait', 'YouScope · what the data concludes', [
      { text: S.ai && S.ai.source === 'ai-full' ? 'full analysis' : '4 depths', cls: 'good' },
    ]);
    const host = h('div', { class: 'reveal' });
    m.appendChild(host);
    window.YSportrait.render(host, {
      profile: p, data: S.data, insights: S.insights, aiCfg: S.aiCfg,
      facts: S.facts, clusters: S.clusters, autorun: opts && opts.autorun,
      onPersonalized: (result) => {
        if (adoptTaxonomy(result)) {
          flashTaxonomyNotice();
        }
      },
    });
  }

  /* ── STORY (one of the model's own sections, as a full page) ── */
  function viewStory(m, section, idx) {
    if (!section) {
      m.innerHTML = topbar('Not available', 'YouScope', []);
      m.appendChild(h('div', { class: 'card' }, '<p class="narr">This section is no longer in memory. Re-run the personalised analysis.</p>'));
      return;
    }
    m.innerHTML = topbar(section.title, 'YouScope · ' + (S.mode === 'ai' ? 'your report' : 'report'), [
      { text: 'section ' + (idx + 1) + ' of ' + ((S.personalized.sections || []).length), cls: 'good' },
      ...(section.cites && section.cites.length ? [{ text: section.cites.slice(0, 2).join(', ') }] : []),
    ]);

    const card = h('div', { class: 'card' });
    const ctx = {
      profile: S.aiProfile || S.profile,
      facts: S.facts,
      taxonomyGroups: (S.personalized && S.personalized.taxonomy) || [],
      body: section.body,
    };
    if (window.YSBlocks) {
      card.appendChild(window.YSBlocks.renderSection(section, ctx));
    } else {
      card.appendChild(h('p', { class: 'narr' }, esc(section.body)));
    }
    m.appendChild(card);

    if (section.cites && section.cites.length) {
      m.appendChild(h('div', { class: 'hint', style: 'margin-top:12px' },
        'This section rests on: ' + esc(section.cites.join(', '))));
    }

    // prev / next between the model's sections
    const nav = h('div', { style: 'display:flex;gap:10px;margin-top:18px;flex-wrap:wrap' });
    const total = (S.personalized.sections || []).length;
    if (idx > 0) {
      nav.appendChild(h('button', {
        class: 'btn ghost sm',
        onclick: () => { location.hash = '#story' + (idx - 1); },
      }, '← ' + shortLabel(S.personalized.sections[idx - 1].title)));
    }
    if (idx < total - 1) {
      nav.appendChild(h('button', {
        class: 'btn sm',
        onclick: () => { location.hash = '#story' + (idx + 1); },
      }, shortLabel(S.personalized.sections[idx + 1].title) + ' →'));
    }
    if (nav.children.length) m.appendChild(nav);

    // a way back to the whole portrait
    m.appendChild(h('div', { style: 'margin-top:16px' },
      '<a class="link" href="#portrait" style="font-size:.85rem">See the full portrait →</a>'));
  }

  /* ── SETTINGS ── */
  function viewSettings(m, p) {
    window.YSsettings.render(m, () => {});
  }

  /* ─────────────────────────── boot ─────────────────────────── */
  function resetAll() {
    try { sessionStorage.removeItem('youscope.profile'); } catch (e) {}
    S.profile = null; S.data = null; S.insights = null; S.ai = null;
    location.hash = '';
    renderLanding();
  }

  function boot() {
    S.aiCfg = window.YSAI.loadConfig();

    // restore session (no raw watch events stored — only aggregates)
    let restored = false;
    try {
      const raw = sessionStorage.getItem('youscope.profile');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.profile && saved.profile.range && saved.profile.range.first) {
          S.profile = saved.profile;
          S.insights = saved.insights;
          S.facts = saved.facts || null;
          S.mode = saved.mode || null;
          try {
            const aiRaw = sessionStorage.getItem('youscope.aiProfile');
            if (aiRaw) S.aiProfile = JSON.parse(aiRaw).aiProfile || null;
          } catch (e) { /* ignore */ }
          S.data = saved.dataLight || { watch: [], search: [], subscriptions: [], comments: [], playlists: [], musicLibrary: [] };
          S.fileName = saved.fileName || '';
          restored = true;
        }
      }
    } catch (e) { /* ignore */ }

    if (restored) {
      const id = (location.hash || '#overview').slice(1);
      renderView(VIEWS.some(v => v.id === id) ? id : 'overview');
    } else {
      renderLanding();
    }

    window.addEventListener('hashchange', () => {
      const id = location.hash.slice(1) || 'overview';
      if (!S.profile) {
        if (id === 'settings') return renderView('settings');
        return;
      }
      if (currentViews().some(v => v.id === id)) renderView(id);
    });

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (!S.profile) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= VIEWS.length && !e.metaKey && !e.ctrlKey) {
        location.hash = VIEWS[n - 1].id;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  /* Test/debug hook — lets an automated harness inject a precomputed profile
     without going through the file picker. Harmless in production. */
  window.YouScope = {
    inject(profile, insights, dataLight) {
      S.profile = profile;
      S.insights = insights || window.YSInsights.build(profile);
      S.data = dataLight || { watch: [], search: [], subscriptions: [], comments: [], playlists: [], musicLibrary: [] };
      const id = (location.hash || '#overview').slice(1) || 'overview';
      renderView(VIEWS.some(v => v.id === id) ? id : 'overview');
      return true;
    },
    views: VIEWS.map(v => v.id),
    state: () => S,
  };
})();
