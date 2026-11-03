/* Mock OpenAI-compatible endpoint for the tests. Port 8899.
 * Returns a valid portrait and records requests at GET /__log. */
const http = require('http');
const log = [];
http.createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, HTTP-Referer, X-Title',
  };
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url === '/__log') return res.writeHead(200, cors).end(JSON.stringify(log));
    if (req.url === '/__reset') { log.length = 0; return res.writeHead(200, cors).end('ok'); }
    log.push({ path: req.url, headers: req.headers, body: body.slice(0, 400) });
    let p = {}; try { p = JSON.parse(body); } catch (e) {}
    if (/unauthorized/.test(p.model || '')) {
      return res.writeHead(401, { ...cors, 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'No auth credentials found' } }));
    }
    const content = JSON.stringify({
      archetype: 'The Mock Subject', tagline: 'A test fixture pretending to be a person.',
      sections: ['The through-line', 'How the pieces fit', 'Shape of days', 'Working toward', 'Blind spot']
        .map((t, i) => ({ title: t, body: 'Mock section ' + (i + 1) + ' body.' })),
      keywords: ['systems', 'retention'], confidence: 'high — mock',
    });
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      model: p.model || 'mock',
      choices: [{ message: { role: 'assistant', content } }],
      usage: { total_tokens: 1600 },
    }));
  });
}).listen(8899, () => console.log('mock listening on 8899'));
