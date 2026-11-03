/* YouScope — openrouter.js
 * OpenRouter-specific optimisation layer.
 *
 * Facts this is built on (verified against GET https://openrouter.ai/api/v1/models
 * and https://openrouter.ai/docs/api-reference/limits):
 *
 *  - Free variants end in ":free". Only ~17 exist at any time and the roster
 *    changes without notice, so a hardcoded "best free model" goes stale.
 *  - "openrouter/free" is an auto-router that picks among available free
 *    models. It cannot go stale, which makes it the correct default.
 *  - Several free models do NOT support response_format (structured output).
 *    Sending it to them is an error, so we only send it when supported.
 *  - Free models are gated per-minute AND per-day. 429 carries Retry-After.
 *  - Fallback models can be supplied as a `models: []` array.
 *  - GET /api/v1/key returns credits + rate-limit state for the current key,
 *    which lets the UI show limits before a run instead of failing mid-way.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSOR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const BASE = 'https://openrouter.ai/api/v1';

  /* Curated preference order. All verified zero-cost at build time.
   * openrouter/free is first: it never 404s because it routes dynamically. */
  const FREE_MODELS = [
    { id: 'openrouter/free', label: 'Auto (any free model)', json: true, note: 'Never goes stale — routes to whatever free model is live.' },
    { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', json: true, note: 'Strong general reasoning, 262k context.' },
    { id: 'dots-studio/dots-3-note-preview:free', label: 'Dots3 Note', json: true, note: 'Very large context (512k).' },
    { id: 'xingchen-agi/xing4.0-29b-a4b:free', label: 'Xing 4.0 29B', json: true, note: 'Structured outputs supported.' },
    { id: 'recursive/flint-v1.0:free', label: 'Flint', json: true, note: 'Text-only, 262k context.' },
    { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B', json: true, note: 'Faster, lighter Gemma.' },
    { id: 'nvidia/nemotron-3.5-super-vl:free', label: 'Nemotron 3.5 Super', json: true, note: '1M context.' },
    { id: 'liquid/lfm-2.5-2.6b:free', label: 'LFM 2.5 2.6B', json: true, note: 'Small and fast; weaker at synthesis.' },
    { id: 'cohere/north-mini-code:free', label: 'North Mini Code', json: false, note: 'No structured output — JSON via prompting only.' },
  ];

  /* Sensible fallback chain: if the chosen model 429s or is retired mid-run,
   * OpenRouter will try the next one automatically when passed as `models`. */
  const FALLBACK_CHAIN = [
    'openrouter/free',
    'google/gemma-4-31b-it:free',
    'xingchen-agi/xing4.0-29b-a4b:free',
  ];

  function modelSupportsJson(id) {
    const hit = FREE_MODELS.find(m => m.id === id);
    if (hit) return hit.json;
    // Unknown ids: assume modern models accept it, but never send it to the
    // auto-router's delegates on our behalf (handled by caller).
    return true;
  }

  function buildHeaders(apiKey) {
    const h = { 'Content-Type': 'application/json' };
    if (apiKey) h['Authorization'] = 'Bearer ' + apiKey;
    // OpenRouter uses these for attribution/rankings; a real URL helps.
    let origin = 'https://youscope.netlify.app';
    try {
      const loc = (typeof location !== 'undefined' && location)
        || (typeof self !== 'undefined' && self.location) || null;
      if (loc && loc.protocol && loc.protocol !== 'file:' && loc.hostname) {
        origin = loc.origin && loc.origin !== 'null' ? loc.origin : origin;
      }
    } catch (e) { /* opaque origin */ }
    h['HTTP-Referer'] = origin;
    h['X-Title'] = 'YouScope';
    return h;
  }

  /* Ask OpenRouter what this key is allowed to do, before spending a run. */
  async function checkKey(apiKey, baseOverride) {
    if (!apiKey) throw new Error('No API key set.');
    const base = (baseOverride || BASE).replace(/\/+$/, '');
    const res = await fetch(base + '/key', { headers: buildHeaders(apiKey) });
    if (!res.ok) {
      if (res.status === 401) throw new Error('That key was rejected by OpenRouter (401).');
      throw new Error('Could not read key status (HTTP ' + res.status + ').');
    }
    const j = await res.json();
    const d = j.data || {};
    return {
      label: d.label || '',
      isFreeTier: !!d.is_free_tier,
      limit: d.limit,                 // total credit cap, null if none
      limitRemaining: d.limit_remaining,
      usage: d.usage,
      usageDaily: d.usage_daily,
      rateLimit: d.rate_limit || null, // may include requests/interval
      freeModelDaily: d.free_model_daily_requests || null,
    };
  }

  /* Parse Retry-After (seconds or HTTP date) into milliseconds. */
  function retryAfterMs(headersLike) {
    try {
      const raw = headersLike && (headersLike.get ? headersLike.get('retry-after') : headersLike['retry-after']);
      if (!raw) return null;
      const n = Number(raw);
      if (Number.isFinite(n)) return Math.max(0, n * 1000);
      const t = Date.parse(raw);
      if (Number.isFinite(t)) return Math.max(0, t - Date.now());
    } catch (e) { /* ignore */ }
    return null;
  }

  return { BASE, FREE_MODELS, FALLBACK_CHAIN, modelSupportsJson, buildHeaders, checkKey, retryAfterMs };
});
