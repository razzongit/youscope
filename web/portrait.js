/* YouScope — portrait.js
 * The Portrait view: tiered analysis (built-in / digest / full personal).
 * Extracted from app.js because the consent + progress UI is substantial.
 */
(function (root) {
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
  const md = (s) => window.YSAI.renderMarkdown(String(s || ''));

  let MODE = 'personal';        // builtin | digest | full
  let LAST = null;             // last AI result
  let FULL = null;             // last full analysis (kept in memory)

  function render(container, ctx) {
    const { profile: p, data, insights, aiCfg } = ctx;
    MODE = 'personal';
    LAST = null;

    container.innerHTML = '';
    const wrap = h('div', { class: 'reveal' });

    // ── tier selector ──
    const picker = h('div', { class: 'card' });
    picker.appendChild(h('div', { class: 'card-head' },
      `<h3>How deep</h3><span class="sub">pick your level</span>`));
    const tiers = h('div', { class: 'tier-grid' });

    const T = [
      {
        id: 'builtin', name: 'Built-in', cost: 'free · no key', icon: '◐',
        desc: 'Written from the numbers on your device. Nothing leaves the browser.',
        detail: '5 sections · fixed categories, hours, trajectories',
      },
      {
        id: 'personal', name: 'Personalised', cost: '≈5 API calls', icon: '●',
        desc: 'The model names your interest groups from your own vocabulary and decides what is worth reporting.',
        detail: 'No preset categories · no template sections · every fact cited',
        badge: 'recommended',
      },
      {
        id: 'digest', name: 'Digest', cost: '1 API call', icon: '◑',
        desc: 'A model reads the summary statistics and writes the portrait.',
        detail: '5 fixed sections · aggregates only',
      },
      {
        id: 'full', name: 'Deep dive', cost: '≈13 API calls', icon: '◎',
        desc: 'Each of your fixed categories is analysed from the videos you watched, then synthesised.',
        detail: 'Per-category subthemes · correlations · slower',
      },
    ];
    T.forEach(t => {
      const el = h('button', {
        class: 'tier' + (t.id === MODE ? ' on' : ''), 'data-tier': t.id,
        onclick: () => selectTier(t.id, container, ctx),
      });
      el.innerHTML = `
        <div class="tier-top">
          <span class="tier-icon">${t.icon}</span>
          <span class="tier-name">${esc(t.name)}</span>
          ${t.badge ? `<span class="tier-badge">${t.badge}</span>` : ''}
        </div>
        <div class="tier-cost">${esc(t.cost)}</div>
        <div class="tier-desc">${esc(t.desc)}</div>
        <div class="tier-detail">${esc(t.detail)}</div>`;
      tiers.appendChild(el);
    });
    picker.appendChild(tiers);
    wrap.appendChild(picker);

    // ── panel where mode-specific UI lives ──
    const panel = h('div', { id: 'tier-panel', style: 'margin-top:16px' });
    wrap.appendChild(panel);

    // ── output ──
    const out = h('div', { id: 'portrait-out', style: 'margin-top:16px' });
    wrap.appendChild(out);

    container.appendChild(wrap);

    // built-in shows immediately
    renderBuiltin(out, insights);
    selectTier('personal', container, ctx, true);
  }

  function selectTier(id, container, ctx, silent) {
    MODE = id;
    container.querySelectorAll('.tier').forEach(el => {
      el.classList.toggle('on', el.dataset.tier === id);
    });
    const panel = container.querySelector('#tier-panel');
    const out = container.querySelector('#portrait-out');
    panel.innerHTML = '';

    if (id === 'builtin') {
      if (!silent) { out.innerHTML = ''; renderBuiltin(out, ctx.insights); }
      return;
    }
    if (id === 'personal') { out.innerHTML = ''; renderPersonalPanel(panel, out, ctx); return; }
    if (id === 'digest') { out.innerHTML = ''; renderDigestPanel(panel, out, ctx); return; }
    if (id === 'full') { out.innerHTML = ''; renderFullPanel(panel, out, ctx); return; }
  }

  /* ───────────────── built-in ───────────────── */
  function renderBuiltin(container, insights) {
    if (!insights) return;
    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-head' },
      `<h3>Built-in reading</h3><span class="sub">computed on your device</span>`));
    const narr = h('div', { class: 'narr' });
    insights.sections.forEach(s => {
      narr.appendChild(h('div', { style: 'margin-bottom:22px' },
        `<div class="eyebrow" style="margin-bottom:8px">${esc(s.title)}</div><p>${md(s.body)}</p>`));
    });
    card.appendChild(narr);
    container.appendChild(card);
  }

  /* ───────────────── key form (shared) ───────────────── */
  function keyForm(ctx, onSubmit, label) {
    const cfg = ctx.aiCfg || {};
    const presetId = cfg.provider || 'openrouter';
    const preset = window.YSAI.PRESETS[presetId] || window.YSAI.PRESETS.openrouter;

    const card = h('div', { class: 'card' });
    card.innerHTML = `
      <div class="grid g-3" style="gap:12px">
        <div class="field">
          <label>Provider</label>
          <select class="input" data-f="provider">
            ${Object.entries(window.YSAI.PRESETS).map(([id, pr]) =>
              `<option value="${id}" ${id === presetId ? 'selected' : ''}>${esc(pr.label)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>Model</label>
          <input class="input" data-f="model" list="m-${presetId}" placeholder="${esc(preset.model)}" value="${esc(cfg.model || '')}">
          <datalist id="m-${presetId}">${(preset.freeModels || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist>
        </div>
        <div class="field">
          <label>API key</label>
          <input class="input" data-f="key" type="password" placeholder="${preset.noKey ? 'not needed' : 'paste key'}" value="${esc(cfg.apiKey || '')}">
        </div>
      </div>
      <div class="field" data-f="base-wrap" style="margin-top:10px;${presetId === 'custom' ? '' : 'display:none'}">
        <label>Base URL</label>
        <input class="input" data-f="base" value="${esc(cfg.baseUrl || '')}" placeholder="https://…/v1">
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px">
        <button class="btn" data-f="run">${esc(label)}</button>
        <button class="btn ghost" data-f="test">Test connection</button>
        <span class="hint" data-f="hint">${esc(preset.note)}${preset.keysUrl ? ` · <a class="link" href="${esc(preset.keysUrl)}" target="_blank" rel="noopener">get a key</a>` : ''}</span>
      </div>
      <div data-f="roster"></div>
      <div data-f="prog"></div>
      ${window.YSAI.isFileProtocol() ? `<div class="hint" style="margin-top:12px;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,196,107,.32);background:rgba(255,196,107,.06);color:var(--amber);line-height:1.6">
        <b>You opened this from a file.</b> Browsers block API calls from <code style="font-family:var(--mono)">file://</code> pages — that is a security rule, not a bug in your key.
        To use a key, serve the folder: run <code style="font-family:var(--mono)">python3 -m http.server 8000</code> in the app folder and open <code style="font-family:var(--mono)">http://localhost:8000</code>.
        Everything else works fine as-is.
      </div>` : ''}`;

    const q = (sel) => card.querySelector(sel);
    q('[data-f="provider"]').addEventListener('change', (e) => {
      const pr = window.YSAI.PRESETS[e.target.value];
      q('[data-f="model"]').placeholder = pr.model;
      q('[data-f="model"]').value = '';
      q('[data-f="model"]').setAttribute('list', '');
      q('[data-f="hint"]').innerHTML = esc(pr.note) +
        (pr.keysUrl ? ` · <a class="link" href="${esc(pr.keysUrl)}" target="_blank" rel="noopener">get a key</a>` : '');
      q('[data-f="key"]').placeholder = pr.noKey ? 'not needed' : 'paste key';
      q('[data-f="base-wrap"]').style.display = (e.target.value === 'custom') ? '' : 'none';
      renderRoster(e.target.value);
    });

    // Show what the free roster actually is, straight from the shipped data.
    function renderRoster(provider) {
      const host = q('[data-f="roster"]');
      if (!host) return;
      if (provider !== 'openrouter' || !window.YSOR) { host.innerHTML = ''; return; }
      const models = window.YSOR.FREE_MODELS || [];
      host.innerHTML = `
        <div style="margin-top:12px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.015)">
          <div class="mono" style="font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim);margin-bottom:9px">
            Free models that exist right now
          </div>
          <div class="list">
            ${models.map(m => `
              <div class="row" style="grid-template-columns:1fr auto;padding:5px 0;font-size:.78rem">
                <span><code style="font-family:var(--mono);font-size:.72rem;color:var(--accent)">${esc(m.id)}</code>
                  <span class="dim" style="margin-left:6px">${esc(m.note || '')}</span></span>
                <span class="meta">${m.json ? 'JSON' : 'no JSON'}</span>
              </div>`).join('')}
          </div>
          <div class="hint" style="margin-top:10px;line-height:1.6">
            The free roster changes without notice — that is why the default is
            <code style="font-family:var(--mono)">openrouter/free</code>, an auto-router that picks
            from whatever is live. Leave the model field blank to use it.
          </div>
        </div>`;
    }
    renderRoster(presetId);

    // Read + validate the form. Returns {ok, cfg, error}.
    function readForm() {
      const provider = q('[data-f="provider"]').value;
      const presetNow = window.YSAI.PRESETS[provider];
      const cfgOut = {
        provider,
        model: q('[data-f="model"]').value.trim(),
        apiKey: q('[data-f="key"]').value.trim(),
        baseUrl: q('[data-f="base"]').value.trim(),
      };
      const isCustom = provider === 'custom';
      if (isCustom) {
        if (!cfgOut.baseUrl) {
          return { ok: false, error: 'Custom endpoint needs a base URL — for example https://api.together.xyz/v1 or http://localhost:11434/v1' };
        }
        if (!/^https?:\/\//i.test(cfgOut.baseUrl) && !/^[\w.-]+(:\d+)?(\/|$)/.test(cfgOut.baseUrl)) {
          return { ok: false, error: 'That base URL does not look valid. It should start with https:// (or http:// for a local server).' };
        }
      }
      if (!cfgOut.model && !presetNow.model && !isCustom) {
        return { ok: false, error: 'Pick a model — the provider needs to know which one.' };
      }
      if (isCustom && !cfgOut.model) {
        return { ok: false, error: 'Type the model id your endpoint expects. A custom server cannot guess it — for a local Ollama that might be "llama3.2"; for Together it looks like "meta-llama/Llama-3.3-70B-Instruct-Turbo".' };
      }
      if (!cfgOut.apiKey && !presetNow.noKey && !isCustom) {
        return { ok: false, error: 'Add an API key — or switch to Ollama to run it locally with no key.' };
      }
      return { ok: true, cfg: cfgOut };
    }

    function showFormError(msg) {
      q('[data-f="prog"]').innerHTML = `<div class="state err" style="padding:12px;margin-top:12px">
        <p class="muted" style="font-size:.85rem;line-height:1.6">${esc(msg)}</p></div>`;
    }

    q('[data-f="run"]').addEventListener('click', () => {
      const v = readForm();
      if (!v.ok) return showFormError(v.error);
      window.YSAI.saveConfig(v.cfg);
      ctx.aiCfg = v.cfg;
      onSubmit(v.cfg, q('[data-f="run"]'), q('[data-f="prog"]'));
    });

    // Test connection: one tiny call, reports exactly what came back.
    q('[data-f="test"]').addEventListener('click', async () => {
      const v = readForm();
      if (!v.ok) return showFormError(v.error);
      const btn = q('[data-f="test"]');
      const prog = q('[data-f="prog"]');
      btn.disabled = true; btn.innerHTML = '<span class="spin"></span> testing';
      prog.innerHTML = '';
      const t0 = performance.now();
      try {
        const r = await window.YSAI.chat(v.cfg, [
          { role: 'user', content: 'Reply with exactly: OK' },
        ], { maxTokens: 12, temperature: 0, json: false, timeoutMs: 45000 });
        const ms = Math.round(performance.now() - t0);
        prog.innerHTML = `<div style="padding:12px 14px;margin-top:12px;border-radius:8px;
            border:1px solid rgba(125,255,179,.4);background:rgba(125,255,179,.07)">
          <div style="color:var(--accent);font-family:var(--mono);font-size:.78rem;letter-spacing:.06em">CONNECTED · ${ms}ms</div>
          <div class="hint" style="margin-top:6px">Model replied: <b>${esc(String(r.content).slice(0, 80))}</b>
          · resolved model <code style="font-family:var(--mono)">${esc(r.model || v.cfg.model)}</code></div>
        </div>`;
        window.YSAI.saveConfig(v.cfg);
        // On OpenRouter, also report the key's real limits so a long run is safe.
        if (v.cfg.provider === 'openrouter' && window.YSAI.checkOpenRouterKey) {
          try {
            const info = await window.YSAI.checkOpenRouterKey(v.cfg.apiKey, v.cfg.baseUrl);
            if (info) {
              const daily = info.freeModelDaily
                ? `${info.freeModelDaily.remaining}/${info.freeModelDaily.limit} free requests left today`
                : 'no free-model counter reported';
              const tier = info.isFreeTier ? 'free tier' : 'credited account';
              prog.innerHTML += `<div class="hint" style="margin-top:8px;padding:8px 12px;border-radius:8px;
                  background:rgba(255,255,255,.03);border:1px solid var(--line)">
                ${esc(tier)} · ${esc(daily)}${info.limitRemaining !== null && info.limitRemaining !== undefined
                  ? ' · $' + Number(info.limitRemaining).toFixed(2) + ' credit left' : ''}
              </div>`;
            }
          } catch (e2) { /* non-fatal */ }
        }
      } catch (e) {
        prog.innerHTML = `<div class="state err" style="padding:14px;margin-top:12px">
          <div style="color:var(--coral);font-family:var(--mono);font-size:.76rem;letter-spacing:.06em;margin-bottom:8px">CONNECTION FAILED</div>
          <p class="muted" style="font-size:.82rem;line-height:1.65">${esc(e.message)}</p>
          <p class="hint" style="margin-top:10px">Things to check: is the base URL right (it usually ends in <code>/v1</code>)? Is the model id exact? Does this provider allow browser calls?</p>
        </div>`;
      } finally {
        btn.disabled = false; btn.textContent = 'Test connection';
      }
    });

    return card;
  }

  function setBusy(btn, prog, text) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span> ' + esc(text || 'working…');
    prog.innerHTML = '';
  }
  function setDone(btn, label) { btn.disabled = false; btn.textContent = label; }
  function showError(prog, msg) {
    prog.innerHTML = `<div class="state err" style="padding:14px;margin-top:12px">
      <h3 style="font-size:.95rem">${esc(String(msg).split('—')[0] || 'Failed')}</h3>
      <p class="muted" style="font-size:.8rem">${esc(msg)}</p></div>`;
  }

  /* ───────────────── personalised (no hardcoded categories) ───────────────── */
  function renderPersonalPanel(panel, out, ctx) {
    const data = ctx.data;
    const hasEvents = !!data && Array.isArray(data.watch) && data.watch.length > 0;

    if (!hasEvents) {
      panel.appendChild(h('div', {
        class: 'card', style: 'border-color:rgba(255,196,107,.34);background:rgba(255,196,107,.05)',
      }, `<div style="display:flex;gap:12px;align-items:flex-start">
        <span style="font-size:1.3rem;line-height:1;color:var(--amber)">!</span>
        <div>
          <div style="font-family:var(--serif);font-size:1.2rem;margin-bottom:6px">Drop your zip again</div>
          <div class="hint" style="color:var(--text-mid);line-height:1.65">
            This mode clusters your individual videos, and those are deliberately not kept
            between page loads. Re-open your zip and the analysis will already be here.
          </div>
        </div></div>`));
      return;
    }

    // local preview of the clusters — free, instant, before any API call
    let clustered = null, facts = null;
    try {
      const tz = ctx.profile.timezone && ctx.profile.timezone.offsetMin || 0;
      facts = window.YSFacts.build(data, { tzOffsetMin: tz });
      if (facts) facts.eras = window.YSFacts.eras(facts, data.watch);
      clustered = window.YSCluster.build(data.watch, { maxClusters: 18 });
    } catch (e) { /* surfaced below */ }

    if (!clustered || !clustered.clusters.length) {
      panel.appendChild(h('div', { class: 'card' },
        `<div class="hint">Could not cluster this history — it may be too small. Try Digest instead.</div>`));
      return;
    }

    const info = h('div', { class: 'card', style: 'border-color:rgba(125,255,179,.2)' });
    info.innerHTML = `
      <div class="card-head"><h3>What it will do</h3><span class="sub">free until you press the button</span></div>
      <div class="hint" style="line-height:1.75;color:var(--text-mid)">
        Your viewing was grouped into <b>${clustered.clusters.length} clusters</b> by shared vocabulary —
        no preset categories, nothing named yet. The model will name these in <em>your</em> words,
        then choose what is worth saying and write it.
        <br><br>
        <b style="color:var(--accent)">Sends:</b> cluster vocabulary, example titles, and the computed fact sheet.
        Roughly 5 calls.
      </div>`;

    const list = h('div', { class: 'list', style: 'margin-top:14px' });
    clustered.clusters.slice(0, 10).forEach((c) => {
      list.appendChild(h('div', {
        class: 'row', style: 'grid-template-columns:1fr auto;gap:12px;padding:7px 0',
      }, `<span style="font-size:.82rem"><b>${esc(c.terms.slice(0, 5).join(', '))}</b>
            <span class="dim" style="margin-left:6px">${esc(c.channels.slice(0, 3).join(', '))}</span></span>
          <span class="meta">${c.count}</span>`));
    });
    info.appendChild(list);
    if (clustered.clusters.length > 10) {
      info.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' },
        `…and ${clustered.clusters.length - 10} more clusters.`));
    }
    if (facts) {
      info.appendChild(h('div', { class: 'hint', style: 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line);line-height:1.7' },
        `${facts.totalWatched.toLocaleString()} watches · ${facts.channels.toLocaleString()} channels · ` +
        `${facts.eras.length} eras detected · ${facts.longReturns.length} channels returned after long gaps · ` +
        `${facts.abandoned.length} went quiet`));
    }
    panel.appendChild(info);

    const form = keyForm(ctx, async (cfg, btn, prog) => {
      setBusy(btn, prog, 'starting');
      out.innerHTML = '';

      const live = h('div', { class: 'card', style: 'margin-top:16px' });
      live.innerHTML = `
        <div class="card-head"><h3>Working</h3><span class="sub" id="p-stage">starting…</span></div>
        <div class="bar" style="margin-bottom:14px"><i id="p-bar" style="width:3%"></i></div>
        <div class="list" id="p-list"></div>`;
      out.appendChild(live);
      const stageEl = live.querySelector('#p-stage');
      const barEl = live.querySelector('#p-bar');
      const listEl = live.querySelector('#p-list');

      try {
        const result = await window.YSPersonalize.run(facts, clustered.clusters, cfg, {
          delayMs: 300,
          onStage: (s) => {
            stageEl.textContent = s;
            listEl.appendChild(h('div', { class: 'hint', style: 'padding:3px 0' }, '→ ' + esc(s)));
            barEl.style.width = Math.min(95, 10 + listEl.children.length * 18) + '%';
          },
        });
        barEl.style.width = '100%';
        stageEl.textContent = 'done';
        const done = h('div', { style: 'margin-top:16px' });
        renderPersonalResult(done, result);
        out.appendChild(done);
      } catch (e) {
        showError(prog, e.message);
        if (!listEl.children.length) live.remove();
      } finally {
        setDone(btn, 'Run personalised analysis');
      }
    }, 'Run personalised analysis');
    panel.appendChild(form);
  }

  function renderPersonalResult(container, res) {
    if (res.headline) {
      container.appendChild(h('div', { class: 'card' },
        `<div style="font-family:var(--serif);font-size:1.5rem;line-height:1.3;letter-spacing:-.01em">
          ${esc(res.headline)}</div>
         ${res.noticed ? `<div class="hint" style="margin-top:12px">${esc(res.noticed)}</div>` : ''}`));
    }

    const tax = h('div', { class: 'card', style: 'margin-top:14px' });
    tax.appendChild(h('div', { class: 'card-head' },
      `<h3>Your interests, in your own terms</h3><span class="sub">named from your vocabulary</span>`));
    res.taxonomy.forEach((t) => {
      const row = h('div', { style: 'padding:11px 0;border-bottom:1px solid var(--line)' });
      row.innerHTML = `
        <div style="display:flex;align-items:baseline;gap:10px">
          <strong style="font-size:.95rem">${esc(t.name)}</strong>
          <span class="mono" style="margin-left:auto;font-size:.75rem;color:var(--accent)">${t.share}%</span>
        </div>
        <div class="hint" style="margin-top:5px;line-height:1.6">${esc(t.definition || '')}</div>
        ${t.channels.length ? `<div class="tags" style="margin-top:7px">${t.channels.slice(0, 4)
          .map(c => `<span class="tag">${esc(c)}</span>`).join('')}</div>` : ''}`;
      tax.appendChild(row);
    });
    container.appendChild(tax);

    res.sections.forEach((s) => {
      container.appendChild(h('div', { class: 'card', style: 'margin-top:14px' },
        `<div class="eyebrow" style="margin-bottom:8px">${esc(s.title)}</div>
         <p class="narr">${esc(s.body)}</p>
         ${s.cites && s.cites.length ? `<div class="hint" style="margin-top:10px;opacity:.6">evidence: ${esc(s.cites.join(', '))}</div>` : ''}`));
    });

    if (res.failedSections && res.failedSections.length) {
      container.appendChild(h('div', { class: 'hint', style: 'margin-top:12px;color:var(--amber)' },
        `${res.failedSections.length} section(s) could not be written: ` +
        res.failedSections.map(f => esc(f.title)).join(', ')));
    }
    if (res.skipped) {
      container.appendChild(h('div', { class: 'card', style: 'margin-top:14px' },
        `<div class="card-head"><h3>What this report chose not to say</h3></div>
         <p class="narr">${esc(res.skipped)}</p>`));
    }
  }

  /* ───────────────── digest ───────────────── */
  function renderDigestPanel(panel, out, ctx) {
    panel.appendChild(h('div', {
      class: 'card', style: 'border-color:rgba(125,255,179,.2)',
    }, `<div class="hint" style="color:var(--text-mid)">
      <b style="color:var(--accent)">Sends:</b> category shares, hourly counts, quarter trajectories and top channel names.
      <b>Not sent:</b> any video titles, your searches, or your identity.
    </div>`));

    const form = keyForm(ctx, async (cfg, btn, prog) => {
      setBusy(btn, prog, 'thinking');
      try {
        const digest = window.YSInsights.buildDigest(ctx.profile);
        const res = await window.YSAI.analyze(digest, cfg, (stage) => {
          prog.innerHTML = `<div class="step" style="margin-top:10px">${esc(stage)}…</div>`;
        });
        prog.innerHTML = '';
        out.innerHTML = '';
        LAST = res;
        renderAiPortrait(out, res);
      } catch (e) {
        showError(prog, e.message);
      } finally {
        setDone(btn, 'Generate portrait');
      }
    }, 'Generate portrait');
    panel.appendChild(form);
  }

  /* ───────────────── full personal ───────────────── */
  function renderFullPanel(panel, out, ctx) {
    const p = ctx.profile;
    const data = ctx.data;
    const X = window.YSTaxonomy;
    const C = window.YSCorrelations;

    // Raw events are intentionally not persisted (sessionStorage holds aggregates
    // only). After a refresh, Full mode has nothing to sample from — say so
    // instead of silently producing an empty analysis.
    const hasEvents = !!data && Array.isArray(data.watch) && data.watch.length > 0;
    if (!hasEvents) {
      const card = h('div', { class: 'card', style: 'border-color:rgba(255,196,107,.34);background:rgba(255,196,107,.05)' });
      card.innerHTML = `
        <div style="display:flex;gap:12px;align-items:flex-start">
          <span style="font-size:1.3rem;line-height:1;color:var(--amber)">⚠</span>
          <div>
            <div style="font-family:var(--serif);font-size:1.15rem;margin-bottom:6px">Your videos are not in memory any more</div>
            <div class="hint" style="color:var(--text-mid);line-height:1.65">
              Full personal needs your individual video titles to analyse. Those are deliberately
              <b>not</b> saved between page loads — only the statistics are kept, so a refresh
              (or reopening the tab) discards them.
              <br><br>Drop your zip again to use this mode. <b>Digest</b> still works right now,
              because it only needs the statistics.
            </div>
          </div>
        </div>`;
      panel.appendChild(card);

      // Still offer digest here rather than a dead end
      const form = keyForm(ctx, async (cfg, btn, prog) => {
        setBusy(btn, prog, 'thinking');
        try {
          const digest = window.YSInsights.buildDigest(ctx.profile);
          const res = await window.YSAI.analyze(digest, cfg, (stage) => {
            prog.innerHTML = `<div class="step" style="margin-top:10px">${esc(stage)}…</div>`;
          });
          prog.innerHTML = '';
          out.innerHTML = '';
          LAST = res;
          renderAiPortrait(out, res);
        } catch (e) {
          showError(prog, e.message);
        } finally {
          setDone(btn, 'Generate portrait');
        }
      }, 'Run digest instead');
      panel.appendChild(form);
      return;
    }

    // ── what will be sent: exact preview ──
    let preview = null;
    try {
      preview = window.YSDeep.previewPayload(data, p, X, { perCategory: 24, maxCategories: 12 });
    } catch (e) { /* no raw data (restored session) */ }

    const warn = h('div', { class: 'card', style: 'border-color:rgba(255,196,107,.34);background:rgba(255,196,107,.05)' });
    warn.innerHTML = `
      <div style="display:flex;gap:12px;align-items:flex-start">
        <span style="font-size:1.3rem;line-height:1;color:var(--amber)">⚠</span>
        <div>
          <div style="font-family:var(--serif);font-size:1.15rem;margin-bottom:6px">This mode sends your actual video titles</div>
          <div class="hint" style="color:var(--text-mid);line-height:1.6">
            Every other mode sends only statistics. This one sends <b>what you watched</b> — the real titles — because that is what makes the analysis specific instead of generic.
            It goes only to the provider you choose below, never to us. There is no server.
            <br><br>If you would rather not, use <b>Digest</b> instead: same structure, no titles.
          </div>
        </div>
      </div>`;

    if (preview) {
      const details = h('details', { style: 'margin-top:14px' });
      details.appendChild(h('summary', {
        style: 'cursor:pointer;font-family:var(--mono);font-size:.72rem;letter-spacing:.1em;text-transform:uppercase;color:var(--amber)',
      }, `See exactly what will be sent — ${preview.totals.titles} titles across ${preview.totals.categories} interests`));

      const inner = h('div', { style: 'margin-top:12px' });
      preview.categories.forEach(c => {
        const block = h('div', { style: 'margin-bottom:12px' });
        block.innerHTML = `<div class="mono" style="font-size:.72rem;color:var(--accent);margin-bottom:4px">${esc(c.label)} — ${c.total} titles</div>
          <div class="hint" style="font-size:.76rem;line-height:1.65">${c.titles.map(t => '· ' + esc(t)).join('<br>')}
          ${c.total > c.titles.length ? `<span class="dim">…and ${c.total - c.titles.length} more</span>` : ''}</div>`;
        inner.appendChild(block);
      });
      inner.appendChild(h('div', { class: 'hint', style: 'margin-top:10px;border-top:1px solid var(--line);padding-top:10px' },
        `Plus: ${preview.totals.calls} model calls total (${preview.totals.categories} per-interest + 1 synthesis).`));
      details.appendChild(inner);
      warn.appendChild(details);
    }
    panel.appendChild(warn);

    // ── cost note ──
    panel.appendChild(h('div', {
      class: 'card', style: 'margin-top:12px;border-color:rgba(125,255,179,.16)',
    }, `<div class="hint" style="color:var(--text-mid)">
      <b style="color:var(--accent)">Cost:</b> ${preview ? preview.totals.calls : '~13'} calls.
      On OpenRouter's free models that is <b>$0</b>, but free tiers rate-limit — if a call fails with 429 the run stops rather than burning your quota, and any interests already analysed are kept.
      For the best result use a 70B-class model or Gemini Flash.
    </div>`));

    // ── correlation preview (local, free) ──
    const corr = C.build(p, X);
    if (corr.pairs.length) {
      const cc = h('div', { class: 'card', style: 'margin-top:12px' });
      cc.appendChild(h('div', { class: 'card-head' },
        `<h3>Cross-interest findings</h3><span class="sub">computed locally, included in the analysis</span>`));
      const list = h('div', { class: 'list' });
      corr.pairs.slice(0, 5).forEach(pr => {
        list.appendChild(h('div', {
          class: 'row', style: 'grid-template-columns:1fr auto;gap:14px',
        }, `<span style="font-size:.84rem"><b>${esc(pr.aLabel)}</b> ${pr.direction} <b>${esc(pr.bLabel)}</b></span>
            <span class="meta" style="color:${pr.r > 0 ? 'var(--accent)' : 'var(--amber)'}">r=${pr.r}</span>`));
      });
      cc.appendChild(list);
      const tens = C.tensions(p);
      if (tens.length) {
        cc.appendChild(h('div', { class: 'hint', style: 'margin-top:14px;padding-top:12px;border-top:1px solid var(--line);line-height:1.7' },
          tens.slice(0, 3).map(t => '· ' + esc(t)).join('<br>')));
      }
      panel.appendChild(cc);
    }

    // ── run ──
    const form = keyForm(ctx, async (cfg, btn, prog) => {
      setBusy(btn, prog, 'starting');
      out.innerHTML = '';

      // live progress card
      const live = h('div', { class: 'card', style: 'margin-top:16px' });
      live.innerHTML = `
        <div class="card-head"><h3>Analysing</h3><span class="sub" id="deep-stage">starting…</span></div>
        <div class="bar" style="margin-bottom:14px"><i id="deep-bar" style="width:2%"></i></div>
        <div class="list" id="deep-list"></div>`;
      out.appendChild(live);
      const stageEl = live.querySelector('#deep-stage');
      const barEl = live.querySelector('#deep-bar');
      const listEl = live.querySelector('#deep-list');

      const rows = new Map();
      const markRow = (label, state, note) => {
        if (!rows.has(label)) {
          const r = h('div', { class: 'row', style: 'grid-template-columns:20px 1fr auto;font-size:.83rem' });
          rows.set(label, r); listEl.appendChild(r);
        }
        const r = rows.get(label);
        const icon = state === 'done' ? '✓' : state === 'run' ? '◌' : state === 'fail' ? '✕' : '·';
        const color = state === 'done' ? 'var(--accent)' : state === 'fail' ? 'var(--coral)' : state === 'run' ? 'var(--amber)' : 'var(--text-dim)';
        r.innerHTML = `<span style="color:${color}">${icon}</span>
          <span class="ttl" style="font-size:.83rem">${esc(label)}</span>
          <span class="meta">${esc(note || '')}</span>`;
      };

      try {
        const result = await window.YSDeep.analyzeFull(data, p, X, corr, cfg, {
          onStage: (s) => { stageEl.textContent = s; },
          onCategory: (i, total, label) => {
            stageEl.textContent = `interest ${i} of ${total}`;
            barEl.style.width = Math.round(4 + (i / total) * 88) + '%';
            markRow(label, 'run', '');
            // mark previous done lazily: recolored on next tick by result pass
            setTimeout(() => { if (rows.has(label)) markRow(label, 'run', 'analysing'); }, 0);
          },
        });

        // finalize rows from what actually came back
        listEl.innerHTML = '';
        rows.clear();
        (result.categories || []).forEach(c => {
          markRow(c.label, c.analysis ? 'done' : 'fail',
            c.analysis ? (c.analysis.subthemes || []).length + ' subthemes' : 'failed');
        });
        barEl.style.width = '100%';
        stageEl.textContent = 'done';
        FULL = result;

        const done = h('div', { style: 'margin-top:16px' });
        renderFullResult(done, result);
        out.appendChild(done);
      } catch (e) {
        showError(prog, e.message);
        if (!listEl.children.length) live.remove();
      } finally {
        setDone(btn, 'Run full analysis');
      }
    }, 'Run full analysis');
    panel.appendChild(form);
  }

  /* ───────────────── renderers ───────────────── */
  function renderAiPortrait(container, res) {
    const card = h('div', { class: 'card' });
    if (res.archetype || res.tagline) {
      card.appendChild(h('div', {
        style: 'border-left:2px solid var(--accent);padding:4px 0 4px 16px;margin-bottom:20px',
      }, `${res.archetype ? `<div class="eyebrow" style="margin-bottom:7px;color:var(--accent)">${esc(res.archetype)}</div>` : ''}
          ${res.tagline ? `<div style="font-family:var(--serif);font-size:1.5rem;line-height:1.25">${esc(res.tagline)}</div>` : ''}`));
    }
    if (Array.isArray(res.keywords) && res.keywords.length) {
      const tags = h('div', { class: 'tags', style: 'margin-bottom:20px' });
      res.keywords.forEach(k => tags.appendChild(h('span', { class: 'tag hot' }, esc(k))));
      card.appendChild(tags);
    }
    (res.sections || []).forEach(s => {
      card.appendChild(h('div', { style: 'margin-bottom:20px' },
        `<div class="eyebrow" style="margin-bottom:7px">${esc(s.title)}</div><p class="narr">${md(s.body)}</p>`));
    });
    if (res.model) {
      card.appendChild(h('div', { class: 'hint', style: 'margin-top:10px;opacity:.7' },
        `Model: ${esc(res.model)}${res.usage && res.usage.total_tokens ? ' · ' + res.usage.total_tokens + ' tokens' : ''}`));
    }
    container.appendChild(card);
  }

  function renderFullResult(container, res) {
    // headline
    const head = h('div', { class: 'card' });
    if (res.archetype || res.tagline) {
      head.appendChild(h('div', {
        style: 'border-left:2px solid var(--accent);padding:4px 0 4px 16px;margin-bottom:18px',
      }, `${res.archetype ? `<div class="eyebrow" style="margin-bottom:7px;color:var(--accent)">${esc(res.archetype)}</div>` : ''}
          ${res.tagline ? `<div style="font-family:var(--serif);font-size:1.6rem;line-height:1.22">${esc(res.tagline)}</div>` : ''}`));
    }
    if (Array.isArray(res.keywords) && res.keywords.length) {
      const tags = h('div', { class: 'tags' });
      res.keywords.forEach(k => tags.appendChild(h('span', { class: 'tag hot' }, esc(k))));
      head.appendChild(tags);
    }
    if (res.confidence) {
      head.appendChild(h('div', { class: 'hint', style: 'margin-top:14px' },
        `<b>Confidence:</b> ${esc(res.confidence)}`));
    }
    container.appendChild(head);

    // sections
    const body = h('div', { class: 'card', style: 'margin-top:14px' });
    (res.sections || []).forEach(s => {
      body.appendChild(h('div', { style: 'margin-bottom:22px' },
        `<div class="eyebrow" style="margin-bottom:7px">${esc(s.title)}</div><p class="narr">${md(s.body)}</p>`));
    });
    container.appendChild(body);

    // per-interest detail
    if (Array.isArray(res.categories) && res.categories.length) {
      const dc = h('div', { class: 'card', style: 'margin-top:14px' });
      dc.appendChild(h('div', { class: 'card-head' },
        `<h3>What each interest means to you</h3>
         <span class="sub">from ${res.stats ? res.stats.titlesSent : '?'} titles</span>`));
      const grid = h('div', { class: 'grid g-2', style: 'gap:14px' });
      res.categories.forEach(c => {
        if (!c.analysis) return;
        const a = c.analysis;
        const cc = h('div', {
          style: 'border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:rgba(255,255,255,.015)',
        });
        let sub = '';
        if (Array.isArray(a.subthemes)) {
          sub = `<div class="tags" style="margin-top:10px">${a.subthemes.slice(0, 5).map(s =>
            `<span class="tag" title="${esc(s.evidence || '')}">${esc(s.name)}</span>`).join('')}</div>`;
        }
        cc.innerHTML = `
          <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
            <h3 style="font-size:.9rem">${esc(c.label)}</h3>
            <span class="mono" style="margin-left:auto;font-size:.7rem;color:var(--text-dim)">${c.share}%</span>
          </div>
          <p style="font-size:.85rem;line-height:1.6;color:var(--text-mid)">${esc(a.essence || '')}</p>
          ${sub}
          ${a.gravitation ? `<div class="hint" style="margin-top:10px"><b>Pulls you back:</b> ${esc(a.gravitation)}</div>` : ''}
          ${a.tension ? `<div class="hint" style="margin-top:6px;color:var(--amber)"><b>Tension:</b> ${esc(a.tension)}</div>` : ''}
          ${a.changed ? `<div class="hint" style="margin-top:6px"><b>Shifted:</b> ${esc(a.changed)}</div>` : ''}`;
        grid.appendChild(cc);
      });
      dc.appendChild(grid);
      container.appendChild(dc);
    }

    if (res.stats) {
      container.appendChild(h('div', { class: 'hint', style: 'margin-top:12px;opacity:.7' },
        `${res.stats.categoriesAnalysed}/${res.stats.categoriesTotal} interests analysed · ${res.stats.titlesSent} titles · model ${esc(res.model || '')}
         ${res.usage && res.usage.total_tokens ? ' · ' + res.usage.total_tokens + ' tokens' : ''}`));
    }
  }

  root.YSportrait = { render };
})(typeof self !== 'undefined' ? self : this);
