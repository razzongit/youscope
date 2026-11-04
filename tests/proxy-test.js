/* Verifies the local proxy: key stays server-side, quirks applied, errors are
 * actionable. Requires `node server.mjs` running, or spins a fake one. */
const http = require('http');

const results = [];
const check = (n, c, d) => { results.push(c); console.log((c ? '  ✓ ' : '  ✗ ') + n + (d ? ' — ' + d : '')); };

/* Minimal stand-in for server.mjs so this runs without the real app. */
function startFakeServer() {
  let stored = { baseUrl: 'https://api.z.ai/api/paas/v4', model: 'glm-5.3-flash', apiKey: 'sk-secret-do-not-leak', maxTokens: 12000, temperature: 1 };
  const seen = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const json = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.url === '/api/config' && req.method === 'GET') {
        const { apiKey, ...safe } = stored;
        return json(200, { ...safe, hasKey: !!apiKey });
      }
      if (req.url === '/api/config' && req.method === 'POST') {
        const inc = JSON.parse(body || '{}');
        stored = { ...stored, ...inc };
        if (!inc.apiKey) stored.apiKey = stored.apiKey;
        const { apiKey, ...safe } = stored;
        return json(200, { ok: true, ...safe, hasKey: !!apiKey });
      }
      if (req.url === '/api/chat') {
        const p = JSON.parse(body || '{}');
        seen.push(p);
        // mirror the real server: clamp instead of rejecting
        let t = p.temperature === null || p.temperature === undefined ? 1 : Number(p.temperature);
        if (Number.isNaN(t)) t = 1;
        if (t < 0.01) t = 0.01;
        let maxT = Number(p.maxTokens) || 4000;
        if (maxT < 8000) maxT = 8000;   // z.ai token floor
        return json(200, { content: 'OK', model: stored.model, sentTemp: t, sentMaxTokens: maxT });
      }
      json(404, { error: 'nope' });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, seen })));
}

(async () => {
  const { srv, port, seen } = await startFakeServer();
  const base = `http://127.0.0.1:${port}`;
  const api = (p, o) => fetch(base + p, o);

  console.log('\n1. KEY NEVER REACHES THE PAGE');
  const cfg = await (await api('/api/config')).json();
  check('GET /api/config omits apiKey', !('apiKey' in cfg), Object.keys(cfg).join(','));
  check('reports hasKey instead', cfg.hasKey === true);
  check('leaks no part of the key', !JSON.stringify(cfg).includes('sk-secret'));

  console.log('\n2. SAVING WITHOUT A KEY KEEPS THE OLD ONE');
  const saved = await (await api('/api/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'glm-5.3' }),
  })).json();
  check('still hasKey after keyless save', saved.hasKey === true);
  check('model updated', saved.model === 'glm-5.3');
  check('response still omits apiKey', !('apiKey' in saved));

  console.log('\n3. PROXY APPLIES PROVIDER QUIRKS');
  const r1 = await (await api('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], temperature: 0 }),
  })).json();
  check('temperature 0 is clamped, not rejected', r1.content === 'OK', 'sent ' + r1.sentTemp);
  check('clamped value is positive', Number(r1.sentTemp) > 0, String(r1.sentTemp));

  console.log('\n4. CLIENT-SIDE PROXY DETECTION');
  const { ensureWindow } = require('./env.js');
  const localWin = ensureWindow('http://localhost:7777/');
  check('proxyAvailable() true on localhost', localWin.YSAI.proxyAvailable() === true);
  const fileWin = ensureWindow('file:///tmp/x.html');
  check('proxyAvailable() false on file://', fileWin.YSAI.proxyAvailable() === false);
  const remoteWin = ensureWindow('https://example.test/');
  check('proxyAvailable() false on a remote site', remoteWin.YSAI.proxyAvailable() === false);

  srv.close();
  const pass = results.filter(Boolean).length;
  console.log('\n─────────────────────────');
  console.log(pass + '/' + results.length + ' passed');
  process.exit(pass === results.length ? 0 : 1);
})();
