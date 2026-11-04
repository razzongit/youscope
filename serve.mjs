#!/usr/bin/env node
/* YouScope local helper — serves the app over http so API keys work.
 *
 * Browsers block API calls from file:// pages. Running this gives you
 * http://localhost:8000 where everything, including BYO-key AI, works.
 *
 * Usage:  node serve.mjs          (default port 8000)
 *         node serve.mjs 3000
 *
 * Zero dependencies.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2]) || 8000;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let rel = normalize(url).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\') rel = '/index.html';
    const file = join(root, rel);

    // never serve outside the app folder
    if (!file.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + rel);
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    }).end(body);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Server error: ' + e.message);
  }
});

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log('\n  YouScope is running at  ' + url + '\n');
  console.log('  Open that link, then drop your Takeout zip.');
  console.log('  API keys work from here — they do not work from file://.\n');
  console.log('  Press Ctrl+C to stop.\n');
});
