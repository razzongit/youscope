/* Drives the real portrait.js UI against a mock OpenAI-compatible server. */
const { window } = require('./domtest.js');
const fs = require('fs');
const APP = process.cwd() + '/';

function load(p) {
  const code = fs.readFileSync(APP + p, 'utf8')
    .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
  new window.Function(code).call(window);
}
// takeout etc. already loaded via domtest; load the profile fixture
const prof = JSON.parse(fs.readFileSync('/tmp/tier-profile.json', 'utf8'));

const host = window.document.getElementById('host');
window.YSportrait.render(host, {
  profile: prof.p,
  insights: prof.insights,
  data: { watch: [], search: [], subscriptions: [], comments: [], playlists: [], musicLibrary: [] },
  aiCfg: {},
});

const $ = (sel) => host.querySelector(sel);
const $$ = (sel) => [...host.querySelectorAll(sel)];

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail ? ' — ' + detail : ''));
}

(async () => {
  console.log('\n1. TIER UI RENDERS');
  check('three tiers present', $$('.tier').length === 3);
  check('built-in selected by default', $('.tier[data-tier="builtin"]').classList.contains('on'));

  console.log('\n2. SWITCH TO DIGEST');
  $('.tier[data-tier="digest"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  check('digest panel rendered', !!$('[data-f="provider"]'));
  check('has Test connection button', !!$('[data-f="test"]'));
  check('has run button', !!$('[data-f="run"]'));

  console.log('\n3. CUSTOM PROVIDER VALIDATION');
  const prov = $('[data-f="provider"]');
  prov.value = 'custom';
  prov.dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  check('base URL field visible for custom', $('[data-f="base-wrap"]').style.display !== 'none');

  // click run with nothing filled in → should show a helpful error, not silently fail
  $('[data-f="run"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 60));
  const progText = $('[data-f="prog"]').textContent;
  check('empty custom form gives a clear error', /base URL/i.test(progText), progText.slice(0, 80));

  console.log('\n4. FILL IN A WORKING CUSTOM ENDPOINT');
  $('[data-f="base"]').value = 'http://127.0.0.1:8899/v1';
  $('[data-f="model"]').value = 'mock-model';
  $('[data-f="key"]').value = 'sk-test-123';
  const before = await fetch('http://127.0.0.1:8899/__log').then(r => r.json());
  const countBefore = before.length;

  // click Test connection
  $('[data-f="test"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
  const testText = $('[data-f="prog"]').textContent;
  check('test connection succeeds', /CONNECTED/i.test(testText), testText.slice(0, 90));
  if (/CONNECTED/i.test(testText)) {
    const after = await fetch('http://127.0.0.1:8899/__log').then(r => r.json());
    check('server actually received the call', after.length > countBefore, after.length + ' requests');
    const last = after[after.length - 1];
    let sentModel = null;
    try { sentModel = JSON.parse(last.body).model; } catch (e) { sentModel = /"model":"([^"]+)"/.exec(last.body)?.[1] || null; }
    check('model sent correctly', sentModel === 'mock-model', String(sentModel));
    check('auth header present', !!last.headers.authorization);
    check('base URL normalised (no double path)', last.path === '/v1/chat/completions', last.path);
  }

  console.log('\n5. RUN THE ACTUAL DIGEST PORTRAIT');
  $('[data-f="run"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 2000));
  const out = window.document.querySelector('#portrait-out');
  const hasPortrait = /Mock Subject|through-line/i.test(out ? out.textContent : '');
  check('digest portrait rendered from mock response', hasPortrait, (out ? out.textContent.slice(0, 70) : 'no output'));

  console.log('\n6. BAD KEY PATH');
  $('[data-f="model"]').value = 'unauthorized';
  $('[data-f="test"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 1200));
  const errText = $('[data-f="prog"]').textContent;
  check('401 surfaces a readable message', /401|rejected/i.test(errText), errText.slice(0, 80));

  const passed = results.filter(r => r.ok).length;
  console.log('\n─────────────────────────');
  console.log(passed + '/' + results.length + ' passed');
  process.exit(passed === results.length ? 0 : 1);
})();
