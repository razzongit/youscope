/* YouScope — settings.js
 * First-run and settings panel. Talks to server.mjs so the key never lives
 * in the page. Designed for someone who has never configured an API before:
 * pick a provider from a list, paste a key, press Test.
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

  /* Providers a non-technical person might plausibly have. Each entry is
   * pre-filled with a working base URL and model so the form is three fields
   * at most: choice, key, save. */
  const PROVIDERS = [
    {
      id: 'zai', name: 'Z.AI — GLM Coding Plan',
      base: 'https://api.z.ai/api/paas/v4',
      model: 'glm-5.3-flash',
      alt: ['glm-5.3', 'glm-5.2'],
      keyUrl: 'https://z.ai/manage-apikey/apikey-list',
      note: 'Recommended if you have a Coding Plan. glm-5.3-flash is fast and has a large context.',
      maxTokens: 12000,
      temperature: 1,
    },
    {
      id: 'openrouter', name: 'OpenRouter — free models',
      base: 'https://openrouter.ai/api/v1',
      model: 'cohere/north-mini-code:free',
      alt: ['openrouter/free', 'google/gemma-4-26b-a4b-it:free', 'dots-studio/dots-3-note-preview:free'],
      keyUrl: 'https://openrouter.ai/keys',
      note: 'Has genuinely free models. "openrouter/free" always works but can be slow; a named model is usually quicker.',
      maxTokens: 8000,
      temperature: 0.6,
    },
    {
      id: 'gemini', name: 'Google Gemini',
      base: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.0-flash',
      alt: ['gemini-1.5-flash'],
      keyUrl: 'https://aistudio.google.com/apikey',
      note: 'Free tier available. Very good at long structured output.',
      maxTokens: 8000,
      temperature: 0.6,
    },
    {
      id: 'openai', name: 'OpenAI',
      base: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      alt: ['gpt-4o'],
      keyUrl: 'https://platform.openai.com/api-keys',
      note: 'Paid. gpt-4o-mini is cheap and reliable for this task.',
      maxTokens: 6000,
      temperature: 0.6,
    },
    {
      id: 'groq', name: 'Groq',
      base: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      alt: ['llama-3.1-8b-instant'],
      keyUrl: 'https://console.groq.com/keys',
      note: 'Free tier, extremely fast.',
      maxTokens: 6000,
      temperature: 0.6,
    },
    {
      id: 'local', name: 'Local model (Ollama / LM Studio)',
      base: 'http://localhost:11434/v1',
      model: 'llama3.2',
      alt: ['llama3.1:8b', 'qwen2.5:14b'],
      keyUrl: 'https://ollama.com/download',
      note: 'Nothing leaves your machine. No key needed. Needs Ollama installed and running.',
      maxTokens: 6000,
      temperature: 0.6,
      noKey: true,
    },
    {
      id: 'custom', name: 'Something else (any OpenAI-compatible URL)',
      base: '', model: '', alt: [], keyUrl: '', note: 'Any endpoint that speaks the OpenAI chat-completions protocol.',
      maxTokens: 8000, temperature: 0.6,
    },
  ];

  async function getConfig() {
    try {
      const r = await fetch('/api/config');
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function saveConfig(patch) {
    const r = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return await r.json();
  }

  async function testConnection() {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        maxTokens: 1200,
        temperature: null,
      }),
    });
    const j = await r.json().catch(() => ({ error: 'Bad response from server' }));
    return { ok: r.ok && j.content !== null, ...j, httpStatus: r.status };
  }

  /* Is this page running under server.mjs, or opened as a bare file? */
  function proxyMode() {
    // Resolve location defensively: UMD modules may be loaded into a window
    // where the bare `location` binding is not in scope.
    let loc = null;
    try {
      if (typeof location !== 'undefined' && location) loc = location;
      else if (typeof self !== 'undefined' && self.location) loc = self.location;
      else if (typeof window !== 'undefined' && window.location) loc = window.location;
    } catch (e) { return false; }
    if (!loc) return false;
    const p = String(loc.protocol || '');
    const hst = String(loc.hostname || '');
    return (p === 'http:' || p === 'https:') &&
      (hst === 'localhost' || hst === '127.0.0.1' || hst === '0.0.0.0');
  }

  /* ─── render ────────────────────────────────────────────────── */
  function render(container, onSaved) {
    const wrap = h('div', { class: 'reveal' });

    if (!proxyMode()) {
      // Opened by double-click: no key is possible, explain the simple fix.
      wrap.appendChild(h('div', {
        class: 'card',
        style: 'border-color:rgba(255,196,107,.4);background:rgba(255,196,107,.05)',
      }, `
        <div style="display:flex;gap:14px;align-items:flex-start">
          <span style="font-size:1.4rem;line-height:1;color:var(--amber)">!</span>
          <div>
            <div style="font-family:var(--serif);font-size:1.25rem;margin-bottom:8px">
              You opened the file directly
            </div>
            <div class="hint" style="color:var(--text-mid);line-height:1.7">
              Analysis works like this, but a page opened from a file is not allowed to call
              an AI service. To use the portrait features, start the little local app instead:
            </div>
            <pre style="margin:12px 0 0;padding:12px 14px;background:rgba(0,0,0,.45);border:1px solid var(--line);
              border-radius:8px;font-family:var(--mono);font-size:.8rem;color:var(--accent);overflow-x:auto">node server.mjs</pre>
            <div class="hint" style="margin-top:10px">
              Then open <b>http://localhost:7777</b>. It launches your browser for you.
            </div>
          </div>
        </div>`));
      container.appendChild(wrap);
      return;
    }

    const card = h('div', { class: 'card' });
    card.appendChild(h('div', { class: 'card-head' },
      '<h3>Connect a model</h3><span class="sub">stored on this computer only</span>'));

    card.appendChild(h('div', { class: 'hint', style: 'margin-bottom:18px;line-height:1.7' },
      `Your key is saved to a file on this machine and used by the local app.
       It is never sent anywhere except the provider you choose below.
       You only need to do this once.`));

    const grid = h('div', { class: 'grid g-2', style: 'gap:14px' });
    const left = h('div', { class: 'field' });
    left.innerHTML = `<label>Provider</label>
      <select class="input" id="s-provider">
        ${PROVIDERS.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
      </select>`;

    const right = h('div', { class: 'field' });
    right.innerHTML = `<label>API key</label>
      <input class="input" id="s-key" type="password" placeholder="paste your key">`;

    grid.appendChild(left);
    grid.appendChild(right);
    card.appendChild(grid);

    const note = h('div', { class: 'hint', id: 's-note', style: 'margin-top:12px;line-height:1.7' });
    card.appendChild(note);

    // advanced (collapsed)
    const adv = h('details', { style: 'margin-top:16px' });
    adv.appendChild(h('summary', {
      style: 'cursor:pointer;font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-dim)',
    }, 'Advanced'));
    const advBody = h('div', { style: 'margin-top:12px' });
    advBody.innerHTML = `
      <div class="grid g-2" style="gap:12px">
        <div class="field"><label>Base URL</label><input class="input" id="s-base"></div>
        <div class="field"><label>Model</label><input class="input" id="s-model" list="s-models"></div>
      </div>
      <datalist id="s-models"></datalist>
      <div class="grid g-2" style="gap:12px;margin-top:12px">
        <div class="field"><label>Max output tokens</label><input class="input" id="s-max" type="number"></div>
        <div class="field"><label>Temperature</label><input class="input" id="s-temp" type="number" step="0.1"></div>
      </div>`;
    adv.appendChild(advBody);
    card.appendChild(adv);

    const actions = h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:20px' });
    const saveBtn = h('button', { class: 'btn', id: 's-save' }, 'Save and test');
    const statusEl = h('div', { style: 'flex:1 1 100%;margin-top:4px' });
    actions.appendChild(saveBtn);
    card.appendChild(actions);
    card.appendChild(statusEl);
    wrap.appendChild(card);

    // info card about what gets sent
    wrap.appendChild(h('div', { class: 'card', style: 'margin-top:14px' },
      `<div class="card-head"><h3>What leaves this computer</h3></div>
       <div class="hint" style="line-height:1.8;color:var(--text-mid)">
         <b style="color:var(--accent)">Nothing,</b> until you run an AI mode.<br>
         <b>Digest</b> sends only summary statistics — category shares, hourly counts, top channel names.<br>
         <b>Full personal</b> additionally sends around 24 real video titles per interest.<br>
         Local analysis, all charts and the whole dashboard never touch the network.
       </div>`));

    // ── wiring ──
    const sel = card.querySelector('#s-provider');
    const keyIn = card.querySelector('#s-key');
    const baseIn = card.querySelector('#s-base');
    const modelIn = card.querySelector('#s-model');
    const maxIn = card.querySelector('#s-max');
    const tempIn = card.querySelector('#s-temp');
    const dl = card.querySelector('#s-models');

    function applyProvider(id, cfg) {
      const p = PROVIDERS.find(x => x.id === id) || PROVIDERS[0];
      if (!cfg) {
        baseIn.value = p.base;
        modelIn.value = p.model;
        maxIn.value = p.maxTokens;
        tempIn.value = p.temperature;
      }
      dl.innerHTML = [p.model, ...p.alt].filter(Boolean).map(m => `<option value="${esc(m)}">`).join('');
      keyIn.placeholder = p.noKey ? 'not needed for local models' : 'paste your key';
      note.innerHTML = esc(p.note) +
        (p.keyUrl ? ` &nbsp;·&nbsp; <a class="link" href="${esc(p.keyUrl)}" target="_blank" rel="noopener">where to get a key</a>` : '');
    }

    sel.addEventListener('change', () => applyProvider(sel.value, null));

    saveBtn.addEventListener('click', async () => {
      const p = PROVIDERS.find(x => x.id === sel.value) || PROVIDERS[0];
      const payload = {
        baseUrl: baseIn.value.trim() || p.base,
        model: modelIn.value.trim() || p.model,
        maxTokens: Number(maxIn.value) || p.maxTokens,
        temperature: Number(tempIn.value),
        provider: p.id,
      };
      if (keyIn.value.trim()) payload.apiKey = keyIn.value.trim();

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="spin"></span> saving';
      statusEl.innerHTML = '';
      try {
        const saved = await saveConfig(payload);
        if (saved.error) throw new Error(saved.error);
        if (!saved.hasKey && !p.noKey && sel.value !== 'custom') {
          statusEl.innerHTML = `<div class="hint" style="color:var(--amber)">Saved, but no key is stored yet — paste one to use AI features.</div>`;
        }
        saveBtn.innerHTML = '<span class="spin"></span> testing';
        const t = await testConnection();
        if (t.ok) {
          statusEl.innerHTML = `<div style="padding:12px 14px;border-radius:8px;border:1px solid rgba(125,255,179,.4);
            background:rgba(125,255,179,.07)">
            <div style="color:var(--accent);font-family:var(--mono);font-size:.74rem;letter-spacing:.06em">
              CONNECTED${t.ms ? ' · ' + t.ms + 'ms' : ''}</div>
            <div class="hint" style="margin-top:6px">Model replied <b>${esc(String(t.content).slice(0, 40))}</b>
            · served by <code style="font-family:var(--mono)">${esc(t.model || payload.model)}</code></div>
          </div>`;
          if (onSaved) onSaved(saved);
        } else {
          throw new Error((t.hint ? t.hint + ' ' : '') + (t.error || t.emptyReason || 'Connection failed'));
        }
      } catch (e) {
        statusEl.innerHTML = `<div class="state err" style="padding:14px">
          <div style="color:var(--coral);font-family:var(--mono);font-size:.72rem;letter-spacing:.06em;margin-bottom:8px">
            NOT CONNECTED</div>
          <p class="muted" style="font-size:.84rem;line-height:1.65">${esc(e.message)}</p>
        </div>`;
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save and test';
      }
    });

    // hydrate from server
    getConfig().then(cfg => {
      if (!cfg) return;
      const match = PROVIDERS.find(p => p.base && cfg.baseUrl &&
        cfg.baseUrl.replace(/\/+$/, '') === p.base.replace(/\/+$/, ''));
      sel.value = match ? match.id : 'custom';
      applyProvider(sel.value, true);
      baseIn.value = cfg.baseUrl || '';
      modelIn.value = cfg.model || '';
      maxIn.value = cfg.maxTokens || 8000;
      tempIn.value = cfg.temperature !== undefined ? cfg.temperature : 0.6;
      keyIn.value = '';
      keyIn.placeholder = cfg.hasKey ? 'a key is already saved — leave blank to keep it' : (match?.noKey ? 'not needed' : 'paste your key');
    });

    applyProvider('zai', null);
    container.appendChild(wrap);
  }

  root.YSsettings = { render, proxyMode, getConfig };
})(typeof self !== 'undefined' ? self : this);
