/* Tests the OpenRouter optimisation layer against tests/or-mock.js */
const { ensureWindow } = require('./env.js');
const window = ensureWindow('http://localhost:8000/');
const AI = window.YSAI;
const OR = window.YSOR;

const M = 'http://127.0.0.1:8898';
const cfg = (model) => ({ provider: 'openrouter', baseUrl: M + '/api/v1', model, apiKey: 'sk-or-test' });

const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };
const post = (path, body) => fetch(M + path, { method: 'POST', body: String(body) });

(async () => {
  console.log('\n1. MODEL ROSTER IS LIVE, NOT HARDCODED');
  check('openrouter/free is the default', AI.PRESETS.openrouter.model === 'openrouter/free');
  check('no dead llama-3.3 models', !AI.PRESETS.openrouter.freeModels.some(m => /llama-3\.3/.test(m)));
  check('roster has 8 free entries', AI.PRESETS.openrouter.freeModels.length >= 8,
    AI.PRESETS.openrouter.freeModels.length + ' models');
  check('all entries are :free or the router',
    AI.PRESETS.openrouter.freeModels.every(m => m.endsWith(':free') || m === 'openrouter/free'));

  console.log('\n2. CAPABILITY GATING (response_format)');
  check('gemma supports JSON', OR.modelSupportsJson('google/gemma-4-31b-it:free') === true);
  check('north-mini-code does NOT', OR.modelSupportsJson('cohere/north-mini-code:free') === false);

  await post('/__reset', '');
  await post('/__mode', 'ok');
  let threw = null;
  try {
    await AI.chat(cfg('cohere/north-mini-code:free'), [{ role: 'user', content: 'x' }], { json: true });
  } catch (e) { threw = e.message; }
  const l1 = await (await fetch(M + '/__log')).json();
  const e1 = l1[l1.length - 1] || {};
  check('response_format withheld from unsupporting model',
    e1.response_format === false,
    'response_format sent: ' + e1.response_format);
  check('that model still called successfully', threw === null, threw || 'no error');

  await post('/__reset', '');
  await AI.chat(cfg('google/gemma-4-31b-it:free'), [{ role: 'user', content: 'x' }], { json: true });
  const l2 = await (await fetch(M + '/__log')).json();
  const e2 = l2[l2.length - 1] || {};
  check('response_format sent to supporting model', e2.response_format === true,
    'sent: ' + e2.response_format);

  console.log('\n3. FALLBACK CHAIN');
  await post('/__reset', '');
  await AI.chat(cfg('openrouter/free'), [{ role: 'user', content: 'x' }], { json: true });
  const l3 = await (await fetch(M + '/__log')).json();
  const e3 = l3[l3.length - 1] || {};
  check('models[] fallback array sent', Array.isArray(e3.models) && e3.models.length > 1,
    e3.models ? e3.models.length + ' models' : 'absent');
  check('chosen model is first in chain', e3.models && e3.models[0] === 'openrouter/free');

  console.log('\n4. RETRY-AFTER PARSING');
  check('seconds parsed', OR.retryAfterMs({ 'retry-after': '3' }) === 3000);
  check('absent returns null', OR.retryAfterMs({}) === null);
  const H = new window.Headers({ 'retry-after': '5' });
  check('Headers object parsed', OR.retryAfterMs(H) === 5000);

  await post('/__reset', ''); await post('/__mode', 'ratelimit');
  let rl = null;
  try { await AI.chat(cfg('openrouter/free'), [{ role: 'user', content: 'x' }], {}); }
  catch (e) { rl = e; }
  check('429 raises a rate-limit error', rl && rl.isRateLimit === true);
  check('429 carries retryAfterMs', rl && rl.retryAfterMs === 3000, String(rl && rl.retryAfterMs));
  check('429 message mentions the router', /openrouter\/free/.test(rl ? rl.message : ''),
    (rl ? rl.message : '').slice(0, 70));

  await post('/__reset', ''); await post('/__mode', 'upstream-503');
  let ue = null;
  try { await AI.chat(cfg('google/gemma-4-31b-it:free'), [{ role: 'user', content: 'x' }], {}); }
  catch (e) { ue = e.message; }
  check('503 explains upstream outage', /unavailable|outage/.test(ue || ''), (ue || '').slice(0, 60));

  console.log('\n5. KEY INTROSPECTION');
  const info = await OR.checkKey('sk-or-test', M + '/api/v1');
  check('reads is_free_tier', info.isFreeTier === true);
  check('reads free-model daily counter', info.freeModelDaily &&
    info.freeModelDaily.remaining === 47,
    JSON.stringify(info.freeModelDaily));

  console.log('\n6. ATTRIBUTION HEADERS');
  await post('/__reset', '');
  const mod = window.YSOR.buildHeaders('sk-or-test');
  check('HTTP-Referer set', !!mod['HTTP-Referer'], mod['HTTP-Referer']);
  check('X-Title set', mod['X-Title'] === 'YouScope');
  check('Authorization set', mod.Authorization === 'Bearer sk-or-test');
  check('never sends literal null origin', mod['HTTP-Referer'] !== 'null');

  const pass = results.filter(Boolean).length;
  console.log('\n─────────────────────────');
  console.log(pass + '/' + results.length + ' passed');
  process.exit(pass === results.length ? 0 : 1);
})();
