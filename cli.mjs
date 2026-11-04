#!/usr/bin/env node
/* YouScope CLI — analyse a Google Takeout export locally.
 *
 *   node cli.mjs <takeout.zip | watch-history.html> [options]
 *
 * Reads configuration from .env (see .env.example). No build step, no
 * dependencies, nothing leaves your machine except the requests you configure.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, basename, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = dirname(new URL(import.meta.url).pathname);

/* ─── tiny .env loader (no dependency) ─────────────────────────── */
async function loadEnv(file) {
  const out = {};
  let raw = '';
  try { raw = await readFile(file, 'utf8'); } catch { return out; }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

/* ─── arg parsing ──────────────────────────────────────────────── */
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--help' || t === '-h') a.help = true;
    else if (t === '--no-ai') a.noAi = true;
    else if (t === '--digest') a.digest = true;
    else if (t === '--full') a.full = true;
    else if (t === '--personal') a.personal = true;
    else if (t === '--dry-run') a.dryRun = true;
    else if (t === '--json') a.json = true;
    else if (t === '--quiet' || t === '-q') a.quiet = true;
    else if (t === '--out') a.out = argv[++i];
    else if (t === '--model') a.model = argv[++i];
    else if (t === '--base-url') a.baseUrl = argv[++i];
    else if (t === '--test-connection') a.test = true;
    else if (t.startsWith('-')) { console.error('Unknown option: ' + t); process.exit(2); }
    else a._.push(t);
  }
  return a;
}

const HELP = `
YouScope — what your watch history actually says about you

USAGE
  node cli.mjs <takeout.zip | watch-history.html> [options]

OPTIONS
  --no-ai              Analysis only. No network, no key needed. (default)
  --digest             One AI call over the aggregate statistics.
  --full               One AI call per interest, then a synthesis pass (~13 calls).
  --personal           Let the model name your interest groups and design the
                       report. No hardcoded categories or section titles. (~5 calls)
  --dry-run            Print what would be sent to the model, then exit.
  --test-connection    Check the configured endpoint, then exit.

  --out <dir>          Output directory (default: OUTPUT_DIR from .env, ./reports)
  --model <id>         Override MODEL from .env
  --base-url <url>     Override BASE_URL from .env
  --json               Print the profile as JSON instead of writing files.
  --quiet, -q          Less output.
  --help, -h           This.

CONFIGURATION
  Reads .env next to this script. Copy .env.example and fill in:
    BASE_URL, MODEL, API_KEY
  Works with any OpenAI-compatible endpoint (OpenRouter, OpenAI, Gemini, Groq,
  Together, Ollama, LM Studio, vLLM...).

PRIVACY
  --no-ai reads your zip entirely on this machine.
  AI modes send only what is documented in the README, and only to the
  endpoint you configured. Use --dry-run to see it first.

EXAMPLES
  node cli.mjs ~/Downloads/takeout.zip                    # free, offline
  node cli.mjs ~/Downloads/takeout.zip --digest           # 1 AI call
  node cli.mjs ~/Downloads/takeout.zip --full --out ./rep
  node cli.mjs ~/Downloads/takeout.zip --dry-run          # inspect payload
  node cli.mjs --test-connection                          # verify .env
`;

/* ─── engine loaders (browser-style globals) ───────────────────── */
function loadEngine() {
  const self = globalThis;
  const files = ['takeout', 'taxonomy', 'analytics', 'correlations', 'insights', 'openrouter', 'ai', 'deep', 'cluster', 'facts', 'personalize'];
  for (const f of files) {
    const code = require('node:fs').readFileSync(join(ROOT, 'engine', f + '.js'), 'utf8');
    // strip the CommonJS branch so the UMD wrapper attaches to globalThis
    const patched = code.replace(
      /if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /,
      ''
    );
    new Function(patched).call(self);
  }
  return {
    T: self.YSTakeout, X: self.YSTaxonomy, A: self.YSAnalytics,
    C: self.YSCorrelations, I: self.YSInsights, AI: self.YSAI,
    D: self.YSDeep, OR: self.YSOR, CL: self.YSCluster,
    F: self.YSFacts, P: self.YSPersonalize,
  };
}

/* ─── reading input ────────────────────────────────────────────── */
async function readInput(path) {
  const info = await stat(path).catch(() => null);
  if (!info) throw new Error(`Cannot read "${path}" — no such file.`);

  if (/\.zip$/i.test(path)) {
    const { readTakeoutZip } = loadZip();
    const buf = await readFile(path);
    const files = await readTakeoutZip(buf);
    if (!files.length) throw new Error('The zip contained no readable history files.');
    return { files, source: basename(path), bytes: info.size };
  }

  // loose .html/.csv file
  const name = basename(path);
  const text = await readFile(path, 'utf8');
  return { files: [{ name, text }], source: name, bytes: info.size };
}

function loadZip() {
  const code = require('node:fs').readFileSync(join(ROOT, 'engine', 'zip.js'), 'utf8')
    .replace(/if \(typeof module === 'object' && module\.exports\) module\.exports = factory\(\);\s*else /, '');
  new Function(code).call(globalThis);
  return globalThis.YSZip;
}

/* ─── AI config from env ───────────────────────────────────────── */
/* Detect which known provider a BASE_URL belongs to, so provider-specific
 * quirks (temperature range, thinking modes, token floors) apply automatically.
 * Falls back to 'custom', which imposes nothing. */
function detectProvider(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (/api\.z\.ai/.test(u)) return 'zai';
  if (/openrouter\.ai/.test(u)) return 'openrouter';
  if (/api\.openai\.com/.test(u)) return 'openai';
  if (/generativelanguage\.googleapis\.com/.test(u)) return 'gemini';
  if (/api\.groq\.com/.test(u)) return 'groq';
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u)) return 'ollama';
  return 'custom';
}

function aiConfig(env, args) {
  const baseUrl = args.baseUrl || env.BASE_URL || '';
  const model = args.model || env.MODEL || '';
  const apiKey = env.API_KEY || '';
  const provider = env.PROVIDER || detectProvider(baseUrl);
  let extraHeaders = {};
  if (env.EXTRA_HEADERS) {
    try { extraHeaders = JSON.parse(env.EXTRA_HEADERS); }
    catch { console.warn('  ! EXTRA_HEADERS is not valid JSON — ignoring'); }
  }
  return {
    provider,
    baseUrl,
    model,
    apiKey,
    maxTokens: Number(env.MAX_TOKENS) || 4000,
    temperature: env.TEMPERATURE !== undefined ? Number(env.TEMPERATURE) : 0.6,
    delayMs: env.REQUEST_DELAY_MS !== undefined ? Number(env.REQUEST_DELAY_MS) : 1200,
    timeoutMs: Number(env.TIMEOUT_MS) || 120000,
    extraHeaders,
  };
}

/* ─── report writers ───────────────────────────────────────────── */
function mdReport(profile, insights, ai, meta, personalized) {
  const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M'
    : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(n));
  const pct = (n) => n.toFixed(1).replace(/\.0$/, '') + '%';
  const d = (ms) => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const p = profile;
  const L = [];

  L.push('# YouScope report', '');
  L.push(`Source: \`${meta.source}\` · generated ${new Date().toISOString().slice(0, 10)}`, '');
  if (p.range.first) {
    L.push(`**Coverage:** ${d(p.range.first)} → ${d(p.range.last)} (${p.range.days} days)  `);
    L.push(`**Events:** ${fmt(p.counts.watchEvents)} watches · ${fmt(p.counts.musicPlays)} music · ${fmt(p.counts.searches)} searches`, '');
  }
  L.push('---', '');

  if (personalized) {
    if (personalized.headline) {
      L.push('> ' + personalized.headline, '');
    }
    if (personalized.noticed) {
      L.push('_' + personalized.noticed + '_', '');
    }
    L.push('## Your interests, in your own terms', '');
    L.push('The groups below were named from your own vocabulary — not from a preset list.', '');
    for (const t of personalized.taxonomy) {
      L.push(`**${t.name}** — ${t.share}% of your viewing (${t.videos.toLocaleString()} videos)`);
      L.push(t.definition || '');
      if (t.channels.length) L.push('_Channels:_ ' + t.channels.slice(0, 5).join(', '));
      L.push('');
    }
    L.push('---', '');
    for (const s of personalized.sections) {
      L.push('## ' + s.title, '', s.body, '');
    }
    if (personalized.failedSections.length) {
      L.push(`_(${personalized.failedSections.length} section(s) could not be written.)_`, '');
    }
    if (personalized.skipped) {
      L.push('### What this report chose not to say', '', personalized.skipped, '');
    }
    L.push('---', '');
  }

  L.push('## What the data says', '');
  for (const s of insights.sections) {
    L.push('### ' + s.title, '', s.body, '');
  }

  if (ai) {
    L.push('---', '');
    L.push('## AI portrait', '');
    if (ai.archetype) L.push(`**${ai.archetype}**`, '');
    if (ai.tagline) L.push(`*${ai.tagline}*`, '');
    if (ai.keywords?.length) L.push(ai.keywords.map(k => '`' + k + '`').join(' '), '');
    for (const s of (ai.sections || [])) L.push('### ' + s.title, '', s.body, '');
    if (ai.confidence) L.push(`_Confidence: ${ai.confidence}_`, '');
    if (ai.stats) L.push(`_${ai.stats.categoriesAnalysed}/${ai.stats.categoriesTotal} interests · ${ai.stats.titlesSent} titles · ${ai.model || ''}_`, '');
  }

  L.push('---', '', '## Interests', '');
  L.push('| # | Interest | Share | Watches | Top channels |', '|---|---|---|---|---|');
  p.interests.cats.forEach((c, i) => {
    L.push(`| ${i + 1} | ${c.label} | ${pct(c.share)} | ${fmt(c.count)} | ${c.topChannels.slice(0, 3).map(x => x.name).join(', ')} |`);
  });
  L.push('');

  L.push('## Top channels', '');
  p.top.channels.slice(0, 20).forEach((c, i) => L.push(`${i + 1}. **${c.name}** — ${c.count}`));
  L.push('');

  L.push('## Rhythm', '');
  const peak = p.clock.hours.indexOf(Math.max(...p.clock.hours));
  L.push(`- Peak hour: ${String(peak).padStart(2, '0')}:00`);
  L.push(`- Midnight–6am: ${pct(p.clock.nightOwlScore * 100)}`);
  L.push(`- Median session: ${p.sessions.medianLength} videos`);
  L.push(`- Longest streak: ${p.activity.longestStreak} days`);
  L.push('');

  if (p.top.musicArtists.length) {
    L.push('## Music', '');
    p.top.musicArtists.slice(0, 15).forEach((a, i) => L.push(`${i + 1}. **${a.name}** — ${a.count} plays`));
    L.push('');
  }

  return L.join('\n');
}

function htmlReport(profile, insights, ai, meta, personalized) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const p = profile;
  const card = (title, body) => `<section class="card"><h2>${esc(title)}</h2><p>${md(body)}</p></section>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>YouScope — ${esc(meta.source)}</title>
<style>
 :root{--ink:#07090c;--line:rgba(255,255,255,.09);--text:#e8edf2;--mid:#a5b0bd;--dim:#6b7787;--acc:#7dffb3}
 *{box-sizing:border-box}
 body{margin:0;background:var(--ink);color:var(--text);font:15px/1.6 "IBM Plex Sans",system-ui,sans-serif;
   background-image:radial-gradient(900px 500px at 85% -10%,rgba(125,255,179,.07),transparent 60%)}
 .wrap{max-width:900px;margin:0 auto;padding:44px 24px 90px}
 h1{font:400 clamp(2rem,5vw,3rem)/1.05 Georgia,serif;letter-spacing:-.03em;margin:0 0 10px}
 .sub{color:var(--dim);font:12px/1.6 ui-monospace,monospace;letter-spacing:.08em;text-transform:uppercase}
 .card{border:1px solid var(--line);border-radius:14px;padding:22px 24px;margin:16px 0;
   background:linear-gradient(168deg,rgba(23,29,37,.9),rgba(10,13,17,.82))}
 h2{font:500 12px/1.4 ui-monospace,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--mid);margin:0 0 12px}
 p{color:var(--mid);margin:0}
 strong{color:var(--text)}
 table{width:100%;border-collapse:collapse;font-size:13px}
 td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}
 th{color:var(--dim);font:11px/1.4 ui-monospace,monospace;letter-spacing:.1em;text-transform:uppercase}
 .bar{height:3px;background:var(--acc);border-radius:2px;display:inline-block;vertical-align:middle}
 .tag{display:inline-block;border:1px solid rgba(125,255,179,.3);color:var(--acc);
   border-radius:99px;padding:3px 10px;font:11px ui-monospace,monospace;margin:2px 4px 2px 0}
</style></head><body><div class="wrap">
<h1>${esc(ai?.archetype || 'Your watch history')}</h1>
<div class="sub">${esc(meta.source)} · ${p.range.days} days · ${p.counts.watchEvents.toLocaleString()} watches</div>
${ai?.tagline ? `<p style="margin:18px 0 0;font-size:18px;color:var(--text)">${esc(ai.tagline)}</p>` : ''}
${ai?.keywords?.length ? `<div style="margin:16px 0">${ai.keywords.map(k => `<span class="tag">${esc(k)}</span>`).join('')}</div>` : ''}
${personalized ? `
<section class="card"><h2>Your interests, in your own terms</h2>
<p style="margin-bottom:16px">${esc('Named from your own vocabulary — not a preset list.')}</p>
${personalized.taxonomy.map(t => `<div style="padding:10px 0;border-bottom:1px solid var(--line)">
  <div style="display:flex;gap:10px;align-items:baseline">
    <strong>${esc(t.name)}</strong>
    <span style="margin-left:auto;font:12px ui-monospace,monospace;color:var(--acc)">${t.share}%</span>
  </div>
  <p style="font-size:13px">${esc(t.definition || '')}</p>
  ${t.channels.length ? `<div class="tag" style="margin-top:6px">${esc(t.channels.slice(0,4).join(' · '))}</div>` : ''}
</div>`).join('')}
</section>
${personalized.sections.map(s => `<section class="card"><h2>${esc(s.title)}</h2><p>${esc(s.body)}</p></section>`).join('')}
${personalized.skipped ? `<section class="card"><h2>What this report chose not to say</h2><p>${esc(personalized.skipped)}</p></section>` : ''}
` : insights.sections.map(s => card(s.title, s.body)).join('')}
${(ai?.sections || []).map(s => card(s.title, s.body)).join('')}
<section class="card"><h2>Interests</h2><table>
<tr><th>#</th><th>Interest</th><th>Share</th><th>Watches</th></tr>
${p.interests.cats.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.label)}</td>
<td><span class="bar" style="width:${Math.max(4, c.share * 4)}px"></span> ${c.share}%</td>
<td>${c.count.toLocaleString()}</td></tr>`).join('')}
</table></section>
<section class="card"><h2>Top channels</h2><table>
${p.top.channels.slice(0, 20).map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.name)}</td><td>${c.count}</td></tr>`).join('')}
</table></section>
</div></body></html>`;
}

/* ─── main ─────────────────────────────────────────────────────── */
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); return; }

  const env = await loadEnv(join(ROOT, '.env'));
  const cfg = aiConfig(env, args);
  const quiet = args.quiet || args.json;
  const log = (...a) => { if (!quiet) console.log(...a); };
  const err = (...a) => console.error(...a);

  // --test-connection
  if (args.test) {
    const { AI } = loadEngine();
    if (!cfg.baseUrl) { err('No BASE_URL set in .env'); process.exit(2); }
    if (!cfg.model) { err('No MODEL set in .env'); process.exit(2); }
    log(`Testing ${cfg.baseUrl} · model ${cfg.model}${cfg.apiKey ? ' (key set)' : ' (no key)'}`);
    const t0 = Date.now();
    try {
      const r = await AI.chat(cfg,
        [{ role: 'user', content: 'Reply with exactly: OK' }],
        // Reasoning models need headroom even to say "OK" — 16 tokens was
        // consumed entirely by hidden reasoning in testing.
        // temperature is left to the provider preset: z.ai rejects 0 outright.
        { maxTokens: Math.max(1200, Number(env.MAX_TOKENS) || 0), json: false, timeoutMs: cfg.timeoutMs });
      log(`✓ Connected in ${Date.now() - t0}ms`);
      log(`  model replied: ${JSON.stringify(String(r.content).slice(0, 60))}`);
      log(`  resolved model: ${r.model}${r.reasoningTokens ? ` (${r.reasoningTokens} reasoning tokens)` : ''}`);
      process.exit(0);
    } catch (e) {
      err(`✗ Failed after ${Date.now() - t0}ms`);
      err('  ' + e.message);
      process.exit(1);
    }
  }

  if (!args._.length) { console.log(HELP); process.exit(2); }
  const inputPath = resolve(args._[0]);
  const wantAi = args.digest || args.full || args.personal;
  if (wantAi && !args.dryRun) {
    if (!cfg.baseUrl) { err('AI mode needs BASE_URL in .env'); process.exit(2); }
    if (!cfg.model) { err('AI mode needs MODEL in .env'); process.exit(2); }
  }

  // 1. read
  log(`Reading ${basename(inputPath)}…`);
  const t0 = Date.now();
  const { files, source, bytes } = await readInput(inputPath);
  log(`  ${files.length} file${files.length === 1 ? '' : 's'}, ${(bytes / 1048576).toFixed(1)} MB`);

  // 2. parse
  const { T, X, A, C, I, AI, D, CL, F, P } = loadEngine();
  const data = T.parseTakeoutFiles(files);
  if (!data.watch.length) {
    err('No watch history found. Is this a YouTube Takeout export in HTML format?');
    process.exit(1);
  }
  const noDate = data.watch.filter(e => !e.ts).length;
  log(`  ${data.watch.length.toLocaleString()} watch events${noDate ? ` (${noDate} undated)` : ''}`);
  if (data.search.length) log(`  ${data.search.length.toLocaleString()} searches`);
  if (data.subscriptions.length) log(`  ${data.subscriptions.length} subscriptions`);

  // 3. analyse
  log('Analysing…');
  const profile = A.buildProfile(data, X, { now: Date.now() });
  const correlations = C.build(profile, X);
  correlations.tensions = C.tensions(profile);
  const insights = I.build(profile);
  log(`  ${profile.interests.cats.length} categories · ${profile.evolution.quarters.length} quarters · ${profile.interests.coverage.toFixed(1)}% classified`);

  // 4a. Personalised mode: code computes facts, the model names and structures.
  let personalized = null;
  let facts = null;
  if (args.personal) {
    const tz = profile.timezone && profile.timezone.offsetMin ? profile.timezone.offsetMin : 0;
    log('Computing facts…');
    facts = F.build(data, { tzOffsetMin: tz });
    facts.eras = F.eras(facts, data.watch);
    log(`  ${facts.totalWatched.toLocaleString()} watches · ${facts.channels.toLocaleString()} channels · ${facts.eras.length} eras detected`);

    log('Clustering your viewing by vocabulary (no preset categories)…');
    const clustered = CL.build(data.watch, { maxClusters: 18 });
    log(`  ${clustered.clusters.length} clusters · ${(100 * clustered.assigned / clustered.total).toFixed(0)}% of events grouped`);
    if (!quiet) {
      clustered.clusters.slice(0, 8).forEach((c) => log(`    · ${c.count} videos — ${c.terms.slice(0, 5).join(', ')}`));
    }

    if (args.dryRun) {
      console.log('\n── DRY RUN: clustering is local; these are the clusters the model would name ──\n');
      console.log(JSON.stringify(clustered.clusters.map(c => ({
        videos: c.count,
        channels: c.channels.slice(0, 5),
        words: c.terms.slice(0, 10),
        examples: c.samples.slice(0, 4),
      })), null, 1));
      console.log('\nNo request was made.');
      process.exit(0);
    }

    try {
      personalized = await P.run(facts, clustered.clusters, cfg, {
        delayMs: cfg.delayMs,
        onStage: (s) => log('  » ' + s),
      });
      log(`  ${personalized.taxonomy.length} groups named · ${personalized.sections.length} sections written`);
    } catch (e) {
      err('\nPersonalisation failed: ' + e.message);
      err('Falling back to the local analysis only.');
      personalized = null;
    }
  }

  // 4b. AI (optional, legacy fixed-taxonomy modes)
  let ai = null;
  if (wantAi && !args.personal) {
    const digest = I.buildDigest(profile);
    if (args.dryRun) {
      const payload = args.full
        ? D.previewPayload(data, profile, X, { perCategory: 24, maxCategories: 12 })
        : digest;
      console.log('\n── DRY RUN: this is exactly what would be sent ──\n');
      console.log(args.full
        ? `Full mode: ${payload.totals.categories} interests, ${payload.totals.titles} video titles, ${payload.totals.calls} calls`
        : `Digest mode: ${JSON.stringify(digest).length} chars (~${Math.round(JSON.stringify(digest).length / 4)} tokens)`);
      console.log(JSON.stringify(payload, null, 2));
      console.log('\nNo request was made.');
      process.exit(0);
    }
    try {
      if (args.full) {
        log(`Full personal mode: ${Math.min(12, profile.interests.cats.length)} interests, ~13 calls`);
        ai = await D.analyzeFull(data, profile, X, correlations,
          cfg,
          {
            delayMs: cfg.delayMs,
            onStage: (s) => log('  » ' + s),
            onCategory: (i, total, label) => log(`    [${i}/${total}] ${label}`),
          });
      } else {
        log('Digest mode: 1 call');
        ai = await AI.analyze(digest, cfg);
      }
      if (ai && ai.error) ai = null;
    } catch (e) {
      err('\nAI step failed: ' + e.message);
      err('Continuing with the local analysis only.');
      ai = null;
    }
  } else if (!personalized) {
    log('No AI mode requested — analysis is fully local.');
  }

  // 5. write
  const outDir = resolve(args.out || env.OUTPUT_DIR || './reports');
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `youscope-${stamp}`;

  if (args.json) {
    console.log(JSON.stringify({ profile, insights, ai }, null, 2));
    return;
  }

  await mkdir(outDir, { recursive: true });
  const meta = { source, bytes, generated: new Date().toISOString() };
  const mdPath = join(outDir, base + '.md');
  const htmlPath = join(outDir, base + '.html');
  const jsonPath = join(outDir, base + '.json');

  await writeFile(mdPath, mdReport(profile, insights, ai, meta, personalized), 'utf8');
  await writeFile(htmlPath, htmlReport(profile, insights, ai, meta, personalized), 'utf8');
  await writeFile(jsonPath, JSON.stringify({ meta, profile, insights, ai, personalized, facts }, null, 1), 'utf8');

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Done in ${secs}s${ai ? ' (with AI portrait)' : ' (local only)'}`);
  console.log(`  ${mdPath}`);
  console.log(`  ${htmlPath}`);
  console.log(`  ${jsonPath}`);

}

main().catch((e) => { console.error('Fatal: ' + e.message); process.exit(1); });
