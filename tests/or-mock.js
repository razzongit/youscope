/* Mock OpenRouter: simulates 429 with Retry-After, 503, capability rejection,
 * and the /key endpoint. Lets us test the optimisation layer for real. */
const http = require('http');
const log = [];
let mode = 'ok';
let hits = 0;

const server = http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, HTTP-Referer, X-Title',
    'Access-Control-Expose-Headers': 'Retry-After',
  };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/__log') return res.writeHead(200, cors).end(JSON.stringify(log));
    if (req.url === '/__mode') {
      mode = String(body || 'ok').trim() || 'ok';
      hits = 0;
      return res.writeHead(200, cors).end('mode=' + mode);
    }
    if (req.url === '/__state') {
      return res.writeHead(200, cors).end(JSON.stringify({ mode, hits }));
    }
    if (req.url === '/__reset') { log.length = 0; hits = 0; return res.writeHead(200, cors).end('ok'); }

    // api/v1/key introspection
    if (req.url === '/api/v1/key') {
      return res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }).end(JSON.stringify({
        data: {
          label: 'test-key', is_free_tier: true, limit: null, limit_remaining: null,
          usage: 0, usage_daily: 0,
          free_model_daily_requests: { limit: 50, remaining: 47 },
        },
      }));
    }

    let p = {};
    try { p = JSON.parse(body); } catch (e) {}
    hits++;
    log.push({ path: req.url, model: p.model, models: p.models, response_format: !!p.response_format, auth: !!req.headers.authorization });

    const wantsJson = !!p.response_format;

    // A model that does not support structured output must reject it.
    if (wantsJson && /north-mini-code/.test(p.model || '')) {
      res.writeHead(400, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'response_format is not supported for this model', code: 400 } }));
    }

    if (mode === 'ratelimit') {
      res.writeHead(429, { ...cors, 'Content-Type': 'application/json', 'Retry-After': '3' });
      return res.end(JSON.stringify({ error: { message: 'Rate limit exceeded', code: 429 } }));
    }
    if (mode === 'upstream-503') {
      res.writeHead(503, { ...cors, 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'No available providers', code: 503 } }));
    }

    const content = JSON.stringify({ archetype: 'Mock', tagline: 't', sections: [], keywords: [] });
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: p.model || 'mock',
      choices: [{ message: { role: 'assistant', content } }],
      usage: { total_tokens: 100 },
    }));
  });
});
const PORT = Number(process.env.OR_MOCK_PORT) || 8898;
server.listen(PORT, () => console.log('or-mock on ' + PORT));
