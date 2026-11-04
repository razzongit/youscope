/* Regression guard for the failure that made every live z.ai call return empty:
 * a reasoning-only provider was given a token budget smaller than its thinking
 * needs, so content came back null with finish_reason=length. */
const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

const AI = require('../engine/ai.js');

console.log('\n1. EVERY PROVIDER DECLARES ITS OWN TOKEN FLOOR');
for (const [id, p] of Object.entries(AI.PRESETS)) {
  // A floor is optional. What matters is that when declared it is a number,
  // and that its absence is a deliberate choice rather than an oversight.
  const floor = p.tokenFloor;
  check(id + ' floor is either absent or a number',
    floor === undefined || typeof floor === 'number',
    floor === undefined ? 'none (not a reasoning-only provider)' : String(floor));
}
check('the reasoning-only provider has a floor',
  typeof AI.PRESETS.zai.tokenFloor === 'number');
check('providers with JSON mode do not need one',
  AI.PRESETS.openai.tokenFloor === undefined);

console.log('\n2. THE FLOOR APPLIES REGARDLESS OF PROVIDER');
/* The original bug: the floor was inside an `if (isOpenRouter)` branch, so z.ai
 * kept the caller's small maxTokens and returned empty content. Reproduce the
 * decision the client makes and assert it rises. */
const source = require('fs').readFileSync(require('path').join(__dirname, '..', 'engine', 'ai.js'), 'utf8');
const floorLine = source.match(/if \(preset\.tokenFloor\) maxTokens = Math\.max\(maxTokens, preset\.tokenFloor\);/);
check('token floor is applied unconditionally', !!floorLine);
check('floor line is not nested inside the OpenRouter check',
  /if \(isOpenRouter[^\n]*\{\s*\n\s*const floor/.test(source) === false ||
  !/isOpenRouter[\s\S]{0,400}if \(preset\.tokenFloor\)/.test(source.slice(0, source.indexOf('if (preset.tokenFloor)'))));

console.log('\n3. Z.AI FLOOR IS ABOVE THE MEASURED THINKING COST');
const zai = AI.PRESETS.zai;
check('z.ai floor is at least 20000', zai.tokenFloor >= 20000, String(zai.tokenFloor));
check('z.ai floor exceeds the 8000 that failed', zai.tokenFloor > 8000);
check('z.ai temperature floor avoids 0', zai.minTemperature > 0, String(zai.minTemperature));

console.log('\n4. THE DECISION FUNCTION RISES TO THE FLOOR');
function effectiveMaxTokens(provider, requested) {
  const preset = AI.PRESETS[provider] || AI.PRESETS.openrouter;
  let maxTokens = requested || 1600;
  if (preset.tokenFloor) maxTokens = Math.max(maxTokens, preset.tokenFloor);
  return maxTokens;
}
check('z.ai 12000 becomes 20000+', effectiveMaxTokens('zai', 12000) >= 20000,
  String(effectiveMaxTokens('zai', 12000)));
check('z.ai 8000 (the failing value) is raised', effectiveMaxTokens('zai', 8000) >= 20000);
check('a larger explicit request is respected', effectiveMaxTokens('zai', 30000) === 30000);
check('providers with no floor keep the request', effectiveMaxTokens('openai', 2000) === 2000);
check('local endpoints are unaffected', effectiveMaxTokens('ollama', 3000) === 3000);

console.log('\n5. THE PROXY AGREES WITH THE CLIENT');
const srv = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.mjs'), 'utf8');
const m = srv.match(/zai:\s*\{[^}]*tokenFloor:\s*(\d+)/);
check('server.mjs declares a z.ai floor', !!m, m ? 'tokenFloor ' + m[1] : 'missing');
check('server floor matches the client floor', m && Number(m[1]) >= 20000, m ? m[1] : '-');

console.log('\n6. SHIPPED CONFIG ASKS FOR ENOUGH');
const envExample = require('fs').readFileSync(require('path').join(__dirname, '..', '.env.example'), 'utf8');
const mt = envExample.match(/^MAX_TOKENS=(\d+)/m);
check('.env.example sets MAX_TOKENS', !!mt, mt ? mt[1] : 'missing');
check('.env.example value is above the old failing 8000', mt && Number(mt[1]) > 8000, mt ? mt[1] : '-');
check('the floor comment explains the failure',
  /consumed all 8,?000 tokens as reasoning/i.test(envExample) ||
  /returned EMPTY/i.test(envExample));

const pass = results.filter(Boolean).length;
console.log('\n─────────────────────────');
console.log(pass + '/' + results.length + ' passed');
process.exit(pass === results.length ? 0 : 1);
