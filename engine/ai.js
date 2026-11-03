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
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      freeModels: [
        'meta-llama/llama-3.3-70b-instruct:free',
        'deepseek/deepseek-r1:free',
        'deepseek/deepseek-chat-v3-0324:free',
        'google/gemini-2.0-flash-exp:free',
        'qwen/qwen-2.5-72b-instruct:free',
        'mistralai/mistral-small-3.2-24b-instruct:free',
        'nvidia/llama-3.1-nemotron-70b-instruct:free',
        'microsoft/phi-4-reasoning:free',
        'moonshotai/kimi-k2:free',
        'z-ai/glm-4.5-air:free',
      ],
      keysUrl: 'https://openrouter.ai/keys',
      note: 'Free models cost $0. You still need a free OpenRouter account and key.',
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
    const body = {
      model,
      messages,
      temperature: opts.temperature !== undefined ? opts.temperature : 0.65,
      max_tokens: opts.maxTokens || 1600,
    };
    if (opts.json) body.response_format = { type: 'json_object' };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs || 120000);
    let res;
    try {
      res = await fetch(base + '/chat/completions', {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('Request timed out after ' + Math.round((opts.timeoutMs || 120000) / 1000) + 's. Try a smaller or faster model.');
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
      if (res.status === 429) throw new Error('429 Rate limited — free models are busy. Wait a moment or pick a different model. ' + detail);
      if (res.status === 404) throw new Error('404 Model not found — check the model id. ' + detail);
      throw new Error('HTTP ' + res.status + ': ' + detail);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error('The provider returned an empty response.');
    return { content, usage: json.usage || null, model: json.model || body.model };
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
    const { content, usage, model } = await chat(cfg, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ], { json: true, maxTokens: 2000 });

    onStage && onStage('Parsing response');
    const parsed = extractJson(content);
    if (!parsed) {
      // Retry once as plain prose → then wrap
      const retry = await chat(cfg, [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userMsg + '\n\nReturn valid JSON. No markdown fences.' },
      ], { json: true, maxTokens: 2000 });
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

  function renderMarkdown(md) {
    // tiny, safe subset: **bold**, *italic*, `code`, line breaks
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(md)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code style="font-family:var(--mono);font-size:.9em;opacity:.9">$1</code>');
  }

  return { PRESETS, loadConfig, saveConfig, chat, analyze, extractJson, renderMarkdown, normalizeBase, isFileProtocol, getLocation };
});
