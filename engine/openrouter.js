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
  /* Ordered by measured behaviour against the live API (2026-11), not by
   * vendor reputation. Notes record what was actually observed. */
  /* Ordered by LIVE measurements taken 2026-11 against
   * GET /api/v1/models plus direct chat calls. Availability varies by the hour,
   * so this is a preference order, not a guarantee:
   *   healthy at test time : north-mini-code, nemotron-3.5-lightning,
   *                          nemotron-3-ultra, gemma-4-26b, nemotron-3-nano,
   *                          nemotron-3.5-super-vl, dots-3-note
   *   429 upstream         : gemma-4-31b, xing4.0, lfm-2.5
   *   503 / 403            : flint, inkling, inkling-small
   */
  const FREE_MODELS = [
    {
      id: 'openrouter/free', label: 'Auto (any free model)', json: true, reasoning: null,
      note: 'Never goes stale. Routes around whichever model is rate-limited right now — the practical choice.',
    },
    {
      id: 'cohere/north-mini-code:free', label: 'North Mini Code', json: false, reasoning: false,
      note: 'Most reliable at test time. No response_format — prompted for JSON instead.',
    },
    {
      id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning', json: true, reasoning: true,
      note: 'Fast, but spent 3077 tokens reasoning on a real prompt. Needs a big budget.',
    },
    {
      id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B', json: true, reasoning: true,
      note: 'Largest Nemotron. ~1400 reasoning tokens on a real prompt.',
    },
    {
      id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B', json: true, reasoning: false,
      note: 'No reasoning overhead when available, but frequently 429 upstream.',
    },
    {
      id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron 3 Nano', json: true, reasoning: true,
      note: 'Light reasoning model; low token overhead.',
    },
    {
      id: 'nvidia/nemotron-3.5-super-vl:free', label: 'Nemotron 3.5 Super', json: true, reasoning: true,
      note: 'Healthy, 1M context. Moderate reasoning overhead.',
    },
    {
      id: 'dots-studio/dots-3-note-preview:free', label: 'Dots3 Note', json: true, reasoning: true,
      note: '512k context but slow (~5s on a trivial prompt).',
    },
    {
      id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B', json: true, reasoning: false,
      note: 'Clean output when it works, but was 429 for our whole test window.',
    },
    {
      id: 'xingchen-agi/xing4.0-29b-a4b:free', label: 'Xing 4.0 29B', json: true, reasoning: false,
      note: '429 upstream throughout testing.',
    },
    {
      id: 'liquid/lfm-2.5-2.6b:free', label: 'LFM 2.5 2.6B', json: true, reasoning: true,
      note: 'Tiny. Returned null content at low budgets; unreliable.',
    },
    {
      id: 'recursive/flint-v1.0:free', label: 'Flint', json: true, reasoning: false,
      note: '503 upstream during testing. Fallback only.',
    },
  ];

  /* Sensible fallback chain: if the chosen model 429s or is retired mid-run,
   * OpenRouter will try the next one automatically when passed as `models`. */
  /* Max 3: OpenRouter rejects a longer models[] array (HTTP 400, verified). */
  const FALLBACK_CHAIN = [
    'openrouter/free',
    'cohere/north-mini-code:free',
    'nvidia/nemotron-3-ultra-550b-a55b:free',
  ];

  /* Models that emit hidden reasoning tokens before answering. They need a
   * larger budget or the response comes back with content:null. Discovered by
   * testing each free model against the live endpoint. */
  const REASONING_MODELS = new Set([
    'nvidia/nemotron-3.5-super-vl:free',
    'nvidia/nemotron-3.5-lightning:free',          // 3077 reasoning tokens measured
    'nvidia/nemotron-3-ultra-550b-a55b:free',      // 1395 measured
    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    'dots-studio/dots-3-note-preview:free',
    'liquid/lfm-2.5-2.6b:free',
    'thinkingmachines/inkling:free',
    'thinkingmachines/inkling-small:free',
  ]);

  /* Measured reasoning overheads. Nemotron-3.5-lightning used 3077 tokens on a
   * real synthesis prompt, so a flat 3000 floor is not enough. */
  function reasoningFloor(id) {
    if (id === 'nvidia/nemotron-3.5-lightning:free') return 4500;
    if (REASONING_MODELS.has(id)) return 3500;
    if (id === 'openrouter/free') return 3500; // may route to any of the above
    return 0;
  }

  function needsReasoningHeadroom(id) {
    return REASONING_MODELS.has(id);
  }

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

  return { BASE, FREE_MODELS, FALLBACK_CHAIN, REASONING_MODELS, modelSupportsJson, needsReasoningHeadroom, reasoningFloor, buildHeaders, checkKey, retryAfterMs };
});
