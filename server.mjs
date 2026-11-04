#!/usr/bin/env node
/* YouScope server — serves the app AND proxies model requests.
 *
 * Why a server is needed:
 *   A browser page opened from file:// (double-click) cannot call an API.
 *   Even over http, providers like OpenAI send no CORS headers, so the page
 *   could never talk to them directly. Proxying through this local server
 *   removes both problems: the browser only ever talks to 127.0.0.1.
 *
 * The key is read from config.json on this machine and is never exposed to
 * the page — the browser sends only the messages, the server adds the key.
 *
 *   node server.mjs [port]
 *   node server.mjs --no-open     (don't launch a browser)
 */
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(ROOT, 'config.json');

const argv = process.argv.slice(2);
const NO_OPEN = argv.includes('--no-open');
const portArg = argv.find((a) => /^\d+$/.test(a));
const PORT = Number(portArg) || Number(process.env.PORT) || 7777;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ─── config on disk ──────────────────────────────────────────── */
const DEFAULT_CONFIG = {
  baseUrl: '',
  model: '',
  apiKey: '',
  maxTokens: 12000,
  temperature: 1,
  requestDelayMs: 1200,
  timeoutMs: 180000,
  extraHeaders: {},
};

async function readConfig() {
  try {
    const raw = JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_CONFIG, ...raw };
  } catch {
    // Seed from .env if it exists and config.json does not.
    try {
      const envRaw = await readFile(join(ROOT, '.env'), 'utf8');
      const env = {};
      for (const line of envRaw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq < 0) continue;
        env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
      }
      if (env.BASE_URL || env.MODEL || env.API_KEY) {
        const seeded = {
          ...DEFAULT_CONFIG,
          baseUrl: env.BASE_URL || '',
          model: env.MODEL || '',
          apiKey: env.API_KEY || '',
          maxTokens: Number(env.MAX_TOKENS) || DEFAULT_CONFIG.maxTokens,
          temperature: env.TEMPERATURE !== undefined ? Number(env.TEMPERATURE) : DEFAULT_CONFIG.temperature,
        };
        await writeConfig(seeded);
        return seeded;
      }
    } catch { /* no .env either */ }
    return { ...DEFAULT_CONFIG };
  }
}

async function writeConfig(cfg) {
  const merged = { ...DEFAULT_CONFIG, ...cfg };
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), { mode: 0o600 });
  return merged;
}

/* ─── provider quirks (mirrors engine/ai.js) ──────────────────── */
function detectProvider(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (/api\.z\.ai/.test(u)) return 'zai';
  if (/openrouter\.ai/.test(u)) return 'openrouter';
  if (/api\.openai\.com/.test(u)) return 'openai';
  if (/generativelanguage\.googleapis\.com/.test(u)) return 'gemini';
  if (/api\.groq\.com/.test(u)) return 'groq';
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u)) return 'local';
  return 'custom';
}

const QUIRKS = {
  // z.ai: temperature range is exclusive 0..1; thinking always on for 5.3-flash
  zai: { minTemp: 0.01, temp: 1, tokenFloor: 8000 },
  openrouter: { tokenFloor: 0 },
  openai: { minTemp: 0, temp: 0.6, tokenFloor: 0 },
  gemini: { minTemp: 0, temp: 0.6, tokenFloor: 0 },
  groq: { minTemp: 0, temp: 0.6, tokenFloor: 0 },
  local: { minTemp: 0, temp: 0.6, tokenFloor: 0 },
  custom: { minTemp: 0, temp: 0.6, tokenFloor: 0 },
};

function buildBody(cfg, provider, { messages, maxTokens, temperature, json }) {
  const q = QUIRKS[provider] || QUIRKS.custom;
  let maxT = Number(maxTokens) || Number(cfg.maxTokens) || 4000;
  if (q.tokenFloor) maxT = Math.max(maxT, q.tokenFloor);

  let temp = temperature !== undefined && temperature !== null
    ? Number(temperature)
    : (cfg.temperature !== undefined ? Number(cfg.temperature) : q.temp);
  if (Number.isNaN(temp)) temp = q.temp;
  if (temp < q.minTemp) temp = q.minTemp;

  const body = {
    model: cfg.model,
    messages,
    temperature: temp,
    max_tokens: maxT,
  };
  if (json) body.response_format = { type: 'json_object' };
  return body;
}

/* ─── http helpers ────────────────────────────────────────────── */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* ─── the proxy ───────────────────────────────────────────────── */
async function handleChat(req, res) {
  const cfg = await readConfig();
  if (!cfg.baseUrl) return sendJson(res, 400, { error: 'No endpoint configured. Open Settings in the app.' });
  if (!cfg.model) return sendJson(res, 400, { error: 'No model configured. Open Settings in the app.' });

  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { return sendJson(res, 400, { error: 'Malformed request body.' }); }

  const provider = cfg.provider || detectProvider(cfg.baseUrl);
  const base = String(cfg.baseUrl).replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  const url = base + '/chat/completions';

  const headers = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers['Authorization'] = 'Bearer ' + cfg.apiKey;
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'http://localhost:' + PORT;
    headers['X-Title'] = 'YouScope';
  }
  if (cfg.extraHeaders && typeof cfg.extraHeaders === 'object') {
    Object.assign(headers, cfg.extraHeaders);
  }

  const body = buildBody(cfg, provider, payload);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(cfg.timeoutMs) || 180000);

  const t0 = Date.now();
  try {
    const upstream = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal,
    });
    clearTimeout(timer);
    const text = await upstream.text();

    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* non-JSON */ }

    if (!upstream.ok) {
      const detail = parsed?.error?.message || parsed?.message || text.slice(0, 400);
      let hint = '';
      if (upstream.status === 401) hint = 'The API key was rejected.';
      else if (upstream.status === 402) hint = 'Payment required — this model is not on your plan.';
      else if (upstream.status === 429) hint = 'Rate limited. Wait, or raise REQUEST_DELAY_MS.';
      else if (upstream.status === 404) hint = 'Model not found — check the model id in Settings.';
      else if (upstream.status === 400 && /temperature/i.test(String(detail))) {
        hint = 'This provider rejects that temperature value (z.ai requires > 0).';
      }
      return sendJson(res, upstream.status, {
        error: detail, hint, status: upstream.status, sentModel: body.model, sentTemp: body.temperature,
      });
    }

    const choice = parsed?.choices?.[0] || {};
    const content = choice.message?.content ?? null;
    const reasoning = parsed?.usage?.completion_tokens_details?.reasoning_tokens || 0;

    if (content === null || content === undefined) {
      const exhausted = reasoning > 0 || choice.finish_reason === 'length';
      return sendJson(res, 200, {
        content: null,
        model: parsed?.model || body.model,
        reasoningTokens: reasoning,
        usage: parsed?.usage || null,
        ms: Date.now() - t0,
        emptyReason: exhausted
          ? `The model spent its whole ${body.max_tokens}-token budget on internal reasoning (${reasoning}) and produced no answer. Raise MAX_TOKENS or pick a non-reasoning model.`
          : 'The provider returned an empty response.',
      });
    }

    sendJson(res, 200, {
      content,
      model: parsed?.model || body.model,
      reasoningTokens: reasoning,
      usage: parsed?.usage || null,
      ms: Date.now() - t0,
      sentModel: body.model,
      sentTemp: body.temperature,
      sentMaxTokens: body.max_tokens,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      return sendJson(res, 504, { error: `Request timed out after ${Math.round((Number(cfg.timeoutMs) || 180000) / 1000)}s.`, hint: 'Raise TIMEOUT_MS or use a faster model.' });
    }
    sendJson(res, 502, {
      error: 'Could not reach ' + base + ' — ' + e.message,
      hint: 'Check the base URL. It should look like https://api.z.ai/api/paas/v4 (no /chat/completions).',
    });
  }
}

/* ─── routing ─────────────────────────────────────────────────── */
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // API surface
  if (url.pathname === '/api/config') {
    if (req.method === 'GET') {
      const cfg = await readConfig();
      // Never hand the key back to the page. Report only whether one exists.
      const { apiKey, extraHeaders, ...safe } = cfg;
      return sendJson(res, 200, { ...safe, hasKey: !!apiKey, provider: detectProvider(cfg.baseUrl) });
    }
    if (req.method === 'POST') {
      try {
        const incoming = JSON.parse(await readBody(req));
        const current = await readConfig();
        // Empty apiKey in the payload means "leave it alone" — the page never
        // receives the key, so it can never echo it back.
        const next = { ...current, ...incoming };
        if (!incoming.apiKey) next.apiKey = current.apiKey;
        const saved = await writeConfig(next);
        const { apiKey, extraHeaders, ...safe } = saved;
        return sendJson(res, 200, { ok: true, ...safe, hasKey: !!apiKey, provider: detectProvider(saved.baseUrl) });
      } catch (e) {
        return sendJson(res, 400, { error: e.message });
      }
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') return handleChat(req, res);

  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, version: '2', port: PORT });
  }

  // static files
  try {
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (rel === '/' || rel === '\\') rel = '/index.html';
    const file = join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

    const info = await stat(file).catch(() => null);
    if (!info || !info.isFile()) {
      // SPA fallback so refreshes work
      const idx = await readFile(join(ROOT, 'index.html')).catch(() => null);
      if (idx) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(idx);
      }
      res.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(500).end('Server error: ' + e.message);
  }
});

/* ─── open a browser ──────────────────────────────────────────── */
function openBrowser(target) {
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'cmd'
    : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', target] : [target];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.unref();
  } catch { /* no browser available; the URL is printed below */ }
}

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`;
  const cfg = await readConfig();
  const provider = detectProvider(cfg.baseUrl);

  console.log('');
  console.log('  ┌────────────────────────────────────────────┐');
  console.log('  │  YouScope is running                       │');
  console.log('  └────────────────────────────────────────────┘');
  console.log('');
  console.log('  Open:  ' + url);
  console.log('');
  if (!cfg.baseUrl) {
    console.log('  No model configured yet — open Settings in the app.');
  } else {
    console.log('  Endpoint: ' + cfg.baseUrl);
    console.log('  Model:    ' + cfg.model + (cfg.apiKey ? '  (key set)' : '  (no key)'));
    console.log('  Provider: ' + provider);
  }
  console.log('');
  console.log('  Everything runs on this machine. Press Ctrl+C to stop.');
  console.log('');

  if (!NO_OPEN) openBrowser(url);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Either YouScope is already running, or try:  node server.mjs ${PORT + 1}\n`);
  } else {
    console.error('  Server error: ' + e.message);
  }
  process.exit(1);
});
