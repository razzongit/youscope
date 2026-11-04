/* YouScope — ai.js
 * BYO-key AI analyzer. OpenAI-compatible protocol, so it works with:
 *   - OpenRouter (free models available)      https://openrouter.ai/api/v1
 *   - OpenAI                                   https://api.openai.com/v1
 *   - Groq / Together / DeepInfra / Fireworks / Mistral / local Ollama / LM Studio
 * The key lives in localStorage only; requests go browser → provider directly.
 * Only the computed aggregate digest is ever sent — never raw watch history.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSAI = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PRESETS = {
    openrouter: {
      label: 'OpenRouter',
      base: 'https://openrouter.ai/api/v1',
      // Auto-router: never 404s when a specific free model is retired.
      model: 'openrouter/free',
      freeModels: [
        'openrouter/free',
        'google/gemma-4-31b-it:free',
        'dots-studio/dots-3-note-preview:free',
        'xingchen-agi/xing4.0-29b-a4b:free',
        'recursive/flint-v1.0:free',
        'google/gemma-4-26b-a4b-it:free',
        'nvidia/nemotron-3.5-super-vl:free',
        'liquid/lfm-2.5-2.6b:free',
      ],
      keysUrl: 'https://openrouter.ai/keys',
      note: 'Free models cost $0. The list of free models changes often — "openrouter/free" always works because it routes automatically.',
    },
    openai: {
      label: 'OpenAI',
      base: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
      freeModels: [],
      keysUrl: 'https://platform.openai.com/api-keys',
      note: 'Paid. gpt-4o-mini is the cheapest option that works well here.',
    },
    gemini: {
      label: 'Google Gemini',
      base: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.0-flash',
      freeModels: ['gemini-2.0-flash', 'gemini-1.5-flash'],
      keysUrl: 'https://aistudio.google.com/apikey',
      note: 'Generous free tier via the OpenAI-compatible endpoint.',
    },
    groq: {
      label: 'Groq',
      base: 'https://api.groq.com/openai/v1',
      model: 'llama-3.3-70b-versatile',
      freeModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
      keysUrl: 'https://console.groq.com/keys',
      note: 'Free tier, extremely fast.',
    },
    zai: {
      label: 'Z.AI (GLM / Coding Plan)',
      base: 'https://api.z.ai/api/paas/v4',
      model: 'glm-5.3-flash',
      freeModels: ['glm-5.3-flash', 'glm-5.3-flashx', 'glm-5.3', 'glm-5.2', 'glm-4.6'],
      keysUrl: 'https://z.ai/manage-apikey/apikey-list',
      note: 'GLM Coding Plan. thinking.type is always enabled on 5.3-Flash, so it spends reasoning tokens before answering — keep MAX_TOKENS generous.',
      // z.ai rejects temperature 0 (valid range is exclusive 0..1) and
      // recommends temperature 1 for GLM-5.3-Flash.
      temperature: 1,
      minTemperature: 0.01,
      // Thinking cannot be disabled, so every call needs output headroom.
      tokenFloor: 20000,   // glm-5.3-flash cannot disable thinking; 8000 was fully consumed and returned nothing
      reasoningContent: true,
    },
    ollama: {
      label: 'Ollama (local)',
      base: 'http://localhost:11434/v1',
      model: 'llama3.2',
      freeModels: [],
      keysUrl: 'https://ollama.com/download',
      note: 'Fully local and free — nothing leaves your machine. Start with `ollama serve`.',
      noKey: true,
    },
    custom: {
      label: 'Custom endpoint',
      base: '',
      model: '',
      freeModels: [],
      keysUrl: '',
      note: 'Any OpenAI-compatible base URL.',
    },
  };

  const SYSTEM = `You are an insightful personal-data analyst. You are given an AGGREGATE digest of one person's YouTube viewing history — categories, trajectories, rhythms, top channels and searches. You never see individual video titles beyond the top lists.

Write a portrait of this person from their attention patterns. Be specific, concrete and human. Use the actual numbers. Avoid horoscope language ("you are a curious soul") — instead make claims tied to evidence ("your fitness viewing spikes in Januaries, which reads as resolution-driven").

Rules:
- Ground every claim in a number or named channel/category from the digest.
- Be honest about limits: watch history measures attention, not enjoyment or belief.
- No moralising, no lecture about screen time unless the data is genuinely extreme.
- Write in second person ("you").
- Do not invent categories, channels, or numbers that are not in the digest.

Reply with JSON only, matching this shape:
{
  "tagline": "one sentence, under 18 words, that captures this person",
  "archetype": "a 2-4 word label, e.g. 'The Systems Builder'",
  "sections": [
    { "title": "Who you are when nobody is watching", "body": "2-4 sentences, markdown bold allowed" },
    { "title": "Your load-bearing interests", "body": "..." },
    { "title": "How you changed", "body": "..." },
    { "title": "The patterns you probably don't notice", "body": "..." },
    { "title": "What this doesn't tell us", "body": "..." }
  ],
  "keywords": ["5-8 short interest tags"]
}`;

  function cfgKey() { return 'youscope.ai'; }

  function loadConfig() {
    try { return JSON.parse(localStorage.getItem(cfgKey()) || '{}'); } catch (e) { return {}; }
  }
  function saveConfig(c) {
    try { localStorage.setItem(cfgKey(), JSON.stringify(c)); } catch (e) { /* private mode */ }
  }

  /* Normalise whatever the user pasted into a usable chat-completions base.
     Handles: trailing slashes, a full /chat/completions URL, missing /v1,
     and provider-specific quirks. */
  function normalizeBase(raw, provider) {
    let base = String(raw || '').trim();
    if (!base) return '';
    // strip a pasted endpoint down to its base
    base = base.replace(/\/chat\/completions\/*$/i, '');
    base = base.replace(/\/completions\/*$/i, '');
    base = base.replace(/\/+$/, '');
    // add scheme if the user typed host only
    if (!/^https?:\/\//i.test(base) && !/^localhost|^127\.|^0\.0\.0\.0/i.test(base)) {
      base = 'https://' + base;
    }
    if (!/^https?:\/\//i.test(base)) base = 'http://' + base;
    // Google's OpenAI-compat endpoint sometimes gets pasted without /v1
    if (/generativelanguage\.googleapis\.com/i.test(base) && !/\/v1\w*$/.test(base)) {
      base = base.replace(/\/+$/, '') + '/v1beta/openai';
    }
    // Most OpenAI-compatible servers expect /v1. Add it when clearly missing,
    // except for known roots that don't use it.
    if (/^https?:\/\/[^/]+$/.test(base) && !/openrouter\.ai|api\.openai\.com|api\.groq\.com/i.test(base)) {
      // let the server decide: try as-is first (many local servers are root-level)
    }
    return base;
  }

  function resolveModel(cfg, preset) {
    const typed = String(cfg.model || '').trim();
    if (typed) return typed;
    const fallback = String(preset.model || '').trim();
    if (fallback) return fallback;
    throw new Error('No model specified. Type a model id (for a custom endpoint, check your provider\'s docs — e.g. "gpt-4o-mini", "llama-3.3-70b-versatile", or your local model name).');
  }

  /* Resolve the real global location object at call time. UMD modules can be
     loaded into a window where `location` is only reachable via `self`/`window`,
     and a captured reference would go stale. */
  function getLocation() {
    try {
      if (typeof location !== 'undefined' && location && location.protocol) return location;
      if (typeof self !== 'undefined' && self.location && self.location.protocol) return self.location;
      if (typeof window !== 'undefined' && window.location && window.location.protocol) return window.location;
    } catch (e) { /* opaque origin */ }
    return null;
  }

  /* When the page is served by server.mjs, route every model call through its
   * proxy. The key lives on disk and never reaches the browser, which also
   * removes the CORS and file:// restrictions entirely. */
  function proxyAvailable() {
    try {
      const loc = getLocation();
      if (!loc) return false;
      const p = String(loc.protocol || '');
      if (p !== 'http:' && p !== 'https:') return false;
      const h = String(loc.hostname || '');
      return h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0';
    } catch (e) { return false; }
  }

  async function viaProxy(payload, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 180000);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const json = await res.json().catch(() => ({ error: 'Proxy returned a non-JSON response.' }));
      if (!res.ok) {
        const err = new Error((json.hint ? json.hint + ' ' : '') + (json.error || 'Request failed'));
        err.status = res.status;
        if (res.status === 429) err.isRateLimit = true;
        throw err;
      }
      if (json.content === null || json.content === undefined) {
        const err = new Error(json.emptyReason || 'The model returned no content.');
        err.isEmptyResponse = true;
        throw err;
      }
      return { content: json.content, usage: json.usage || null, model: json.model, reasoningTokens: json.reasoningTokens || 0 };
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('Request timed out. Try a faster model or raise the timeout in Settings.');
      throw e;
    }
  }

  /* Is this page running from file:// ? That changes what the network allows. */
  function isFileProtocol() {
    const loc = getLocation();
    if (!loc) return false;
    return String(loc.protocol || '') === 'file:' || String(loc.href || '').startsWith('file:');
  }

  async function chat(cfg, messages, opts) {
    opts = opts || {};
    const preset = PRESETS[cfg.provider] || PRESETS.openrouter;
    const base = normalizeBase(cfg.baseUrl || preset.base, cfg.provider);
    if (!base) throw new Error('No API base URL configured. Pick a provider, or paste your endpoint\'s base URL (it usually ends in /v1).');
    const model = resolveModel(cfg, preset);

    // Preferred path: local proxy. Handles auth, provider quirks and timeouts
    // server-side, so nothing secret lives in the page.
    if (proxyAvailable() && opts.direct !== true) {
      return viaProxy({
        messages,
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        json: !!opts.json,
      }, Number(cfg.timeoutMs) || 180000);
    }

    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
    if (/openrouter\.ai/.test(base)) {
      // On file://, location.origin is the string "null", which some providers reject.
      const loc = getLocation();
      const rawOrigin = loc && loc.origin;
      const origin = (rawOrigin && rawOrigin !== 'null' && !String(loc.href || '').startsWith('file:'))
        ? rawOrigin : 'https://youscope.app';
      headers['HTTP-Referer'] = origin;
      headers['X-Title'] = 'YouScope';
    }
    const orMod = (typeof self !== 'undefined' && self.YSOR) || (typeof window !== 'undefined' && window.YSOR) || null;
    // Provider-based, not URL-based: a proxied or self-hosted OpenRouter
    // endpoint should behave identically. URL match is kept as a fallback.
    const orMode = opts.openrouter !== undefined
      ? opts.openrouter
      : (cfg.provider === 'openrouter' || /openrouter\.ai/.test(base));
    const isOpenRouter = !!orMode;
    const wantsJson = !!opts.json;
    let allowResponseFormat = wantsJson;
    if (isOpenRouter && orMod) {
      allowResponseFormat = orMod.modelSupportsJson(model);
    }

    // Live testing: a 600-token budget was entirely consumed by hidden
    // reasoning (600/600 on reasoning, content:null). 3000 worked — the model
    // spent 877 reasoning then answered. So reasoning models need real headroom,
    // and the auto-router can hand us one at any time.
    let maxTokens = opts.maxTokens || 1600;
    // OpenRouter: per-model floors measured against the live API (the auto
    // router may land on a model needing thousands of reasoning tokens).
    if (isOpenRouter && orMod && orMod.reasoningFloor) {
      const floor = orMod.reasoningFloor(model);
      if (floor > 0) maxTokens = Math.max(maxTokens, floor);
    }
    // Every provider: honour a declared floor. This was previously gated on
    // isOpenRouter, so z.ai silently used 8000 and returned empty content with
    // finish_reason=length 100% of the time on prompts above ~2k tokens.
    if (preset.tokenFloor) maxTokens = Math.max(maxTokens, preset.tokenFloor);

    // Some providers reject temperature 0 outright (z.ai: range is exclusive
    // 0..1). Clamp rather than send a value that returns HTTP 400.
    let temperature = opts.temperature !== undefined ? opts.temperature : 0.65;
    if (preset.temperature !== undefined && opts.temperature === undefined) {
      temperature = preset.temperature;
    }
    if (preset.minTemperature !== undefined && temperature < preset.minTemperature) {
      temperature = preset.minTemperature;
    }
    if (preset.maxTemperature !== undefined && temperature > preset.maxTemperature) {
      temperature = preset.maxTemperature;
    }

    const body = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    // Only some models accept structured output. Sending it where it is
    // unsupported is a hard error on OpenRouter, so gate it by capability.
    if (allowResponseFormat) body.response_format = { type: 'json_object' };

    // Let OpenRouter fall back automatically if the chosen free model is
    // retired or rate-limited. Only sent when the caller did not pick a
    // specific model explicitly.
    if (isOpenRouter && opts.fallback !== false) {
      const chain = (orMod && orMod.FALLBACK_CHAIN) || [];
      const extras = chain.filter(m => m !== model);
      // OpenRouter rejects more than 3 entries in models[] (verified live: HTTP 400).
      const fallbackList = [model, ...extras].slice(0, 3);
      if (fallbackList.length > 1) body.models = fallbackList;
    }

    // Prefer an explicit option, then the configured timeout, then a default.
    const timeoutMs = opts.timeoutMs || Number(cfg.timeoutMs) || 120000;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('Request timed out after ' + Math.round(timeoutMs / 1000) + 's. Raise TIMEOUT_MS in .env, or use a faster model.');
      if (isFileProtocol()) {
        throw new Error('Blocked by the browser because this page was opened from a file (file://). ' +
          'Security rules stop file:// pages from calling APIs, regardless of your key. ' +
          'Fix: serve the folder over http — run "npx serve ." or "python3 -m http.server" in the app folder, ' +
          'then open http://localhost:8000. (' + e.message + ')');
      }
      throw new Error('Network error reaching ' + base + '. The endpoint may be down, the path may be wrong, or the provider may not allow browser calls. (' + e.message + ')');
    }
    clearTimeout(timer);

    if (!res.ok) {
      let detail = '';
      try { const j = await res.json(); detail = j.error?.message || j.message || JSON.stringify(j).slice(0, 300); }
      catch (e) { detail = (await res.text().catch(() => '')).slice(0, 300); }
      if (res.status === 401) throw new Error('401 Unauthorized — the API key was rejected. ' + detail);
      if (res.status === 402) throw new Error('402 Payment required — this model is not free on your account. ' + detail);
      if (res.status === 429) {
        let waitMs = null;
        try { waitMs = orMod ? orMod.retryAfterMs(res.headers) : null; } catch (e) { waitMs = null; }
        const waitTxt = waitMs ? ' Retry in ~' + Math.ceil(waitMs / 1000) + 's.' : '';
        const err = new Error('429 Rate limited by OpenRouter.' + waitTxt +
          ' Free models are capped per minute and per day — switch to "openrouter/free" or wait. ' + detail);
        err.retryAfterMs = waitMs;
        err.isRateLimit = true;
        throw err;
      }
      if (res.status === 503 || res.status === 502) {
        throw new Error('The upstream provider for this model is unavailable right now. Pick "openrouter/free" (it routes around outages) or try again shortly. ' + detail);
      }
      if (res.status === 404) throw new Error('404 Model not found — check the model id. ' + detail);
      throw new Error('HTTP ' + res.status + ': ' + detail);
    }
    const json = await res.json();
    const choice = json.choices?.[0] || {};
    const content = choice.message?.content;
    const reasoningTok = json.usage?.completion_tokens_details?.reasoning_tokens || 0;

    if (!content) {
      // The most common real cause: a reasoning model spent the entire token
      // budget thinking and emitted nothing. Verified against live OpenRouter.
      if (reasoningTok > 0 || choice.finish_reason === 'length') {
        const err = new Error(
          'The model ran out of tokens before writing an answer' +
          (reasoningTok ? ' (' + reasoningTok + ' spent on internal reasoning)' : '') +
          '. ' + (json.model ? 'Served: ' + json.model + '. ' : '') +
          'Try "openrouter/free" again (it usually routes to a non-reasoning model) or pick Gemma 4 31B.');
        err.isEmptyResponse = true;
        throw err;
      }
      throw new Error('The provider returned an empty response' +
        (json.model ? ' from ' + json.model : '') + '. Try a different model.');
    }
    return { content, usage: json.usage || null, model: json.model || body.model, reasoningTokens: reasoningTok };
  }

  function extractJson(text) {
    // tolerate ```json fences and leading prose
    let t = String(text).trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start >= 0 && end > start) t = t.slice(start, end + 1);
    try { return JSON.parse(t); } catch (e) { return null; }
  }

  async function analyze(digest, cfg, onStage) {
    onStage && onStage('Preparing digest');
    const userMsg =
      'Here is the aggregate digest of my YouTube history as JSON.\n\n' +
      JSON.stringify(digest) +
      '\n\nWrite the portrait now. Return JSON only.';

    onStage && onStage('Calling ' + ((PRESETS[cfg.provider] || {}).label || cfg.provider || 'model'));
    const budget = Math.max(2000, Number(cfg.maxTokens) || 0);
    const { content, usage, model } = await chat(cfg, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ], { json: true, maxTokens: budget });

    onStage && onStage('Parsing response');
    const parsed = extractJson(content);
    if (!parsed) {
      // Retry once as plain prose → then wrap
      const retry = await chat(cfg, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg + '\n\nReturn valid JSON. No markdown fences.' },
      ], { json: true, maxTokens: budget });
      const p2 = extractJson(retry.content);
      if (!p2) throw new Error('The model did not return valid JSON. Try a stronger model (e.g. a 70B or Gemini Flash).');
      p2.source = 'ai'; p2.model = retry.model;
      return p2;
    }
    parsed.source = 'ai';
    parsed.model = model;
    parsed.usage = usage;
    return parsed;
  }

  /* Best-effort: read this key's limits so the UI can warn before a run. */
  async function checkOpenRouterKey(apiKey) {
    const orMod = (typeof self !== 'undefined' && self.YSOR) || (typeof window !== 'undefined' && window.YSOR) || null;
    if (!orMod) return null;
    return await orMod.checkKey(apiKey);
  }

  function renderMarkdown(md) {
    // tiny, safe subset: **bold**, *italic*, `code`, line breaks
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(md)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code style="font-family:var(--mono);font-size:.9em;opacity:.9">$1</code>');
  }

  return { PRESETS, loadConfig, saveConfig, chat, analyze, extractJson, renderMarkdown, normalizeBase, isFileProtocol, getLocation, proxyAvailable, checkOpenRouterKey, FREE_FALLBACKS: (typeof self !== "undefined" && self.YSOR && self.YSOR.FALLBACK_CHAIN) || [] };
});
