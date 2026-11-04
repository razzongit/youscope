# YouScope

**What your watch history actually says about you.**

Drop in your Google Takeout zip. YouScope reads every watch, search and music play, then shows you your real interests, how they shifted year over year, and writes a portrait of the person behind the timeline — in a visual dashboard, not a spreadsheet.

It runs **on your own computer**. Nothing is uploaded. No account.

---

## Two ways to use it

### The app (recommended)

For anyone who wants to *see* their history rather than read a terminal.

```bash
git clone https://github.com/razzongit/youscope
cd youscope
node server.mjs
```

Your browser opens at `http://localhost:7777`. Then:

1. Drop your zip on the page
2. Look at your dashboard — no key needed
3. Want the written portrait? Click **Settings**, pick a provider, paste a key once
4. Press **Save and test**

That's the whole thing. The settings screen has presets for Z.AI, OpenRouter, Gemini, OpenAI, Groq and local Ollama, so you don't need to know what a base URL is.

> **Why a server and not just a file?** A page opened by double-clicking is forbidden by browsers from calling an API, and most providers refuse cross-origin browser requests anyway. The local server solves both, and keeps your key on disk instead of in a browser tab. It listens on `127.0.0.1` only — nothing on your network can reach it.

### The CLI (for scripting)

```bash
node cli.mjs ~/Downloads/takeout.zip
```

Writes `.md`, `.html` and `.json` to `./reports`. Same engine, same analysis, no browser. Useful for cron jobs or comparing exports over time.

---

## What it gives you

Three files per run, in `./reports`:

- **`.md`** — a readable report you can drop into any editor
- **`.html`** — a standalone dark-mode dashboard, opens in any browser
- **`.json`** — the full computed profile, for your own analysis

And the analysis itself:

| | |
|---|---|
| **Interests** | 22 categories, ranked by real watch share |
| **Evolution** | quarter-by-quarter trajectories: persistent / rising / fading / gone quiet |
| **Correlations** | what moves together and what trades off (Pearson over quarterly share) |
| **Tensions** | contradictions the data exposes ("fitness is 4% of your viewing but 30% happens after midnight") |
| **Rhythm** | hour clock, weekday × hour grid, night-owl and early-bird scores |
| **Sessions** | longest marathons, 24-hour binges, deep-dive channels |
| **Music / search / comments** | artists, intent themes, comment style |
| **Portrait** | five written sections, grounded in your numbers |

Everything except the AI portrait works with **no key, no network, no config**.

---

## Getting your data

1. Go to [takeout.google.com](https://takeout.google.com)
2. Deselect all → tick **YouTube and YouTube Music**
3. Format: **HTML** (not JSON — the HTML export has the full history)
4. Export, wait for the email, download the zip

Don't unzip it. YouScope reads the `.zip` directly, including Google's ZIP64 format.

**Note on history length:** Takeout only exports what's still in your watch history. If history was paused or cleared, older years are simply absent. The report states the real coverage window rather than inventing one.

---

## Using your own model

**In the app:** Settings → pick a provider → paste your key → Save and test. Saved to `config.json` on this machine, readable only by you.

**For the CLI:** copy `.env.example` to `.env` and fill in three values — base URL, model id, and your key.

Either way, **any OpenAI-compatible endpoint works.** The tool never hardcodes a provider.

```bash
node cli.mjs --test-connection        # verify before spending anything
node cli.mjs takeout.zip --digest     # 1 call
node cli.mjs takeout.zip --full       # ~13 calls, much deeper
node cli.mjs takeout.zip --dry-run    # see the payload, send nothing
```

### Known-good endpoints

| Provider | `BASE_URL` | Example `MODEL` | Cost |
|---|---|---|---|
| **Z.AI (GLM)** | `https://api.z.ai/api/paas/v4` | `glm-5.3-flash` | Coding Plan |
| **OpenRouter** | `https://openrouter.ai/api/v1` | `cohere/north-mini-code:free` | free tier |
| **OpenRouter (auto)** | `https://openrouter.ai/api/v1` | `openrouter/free` | free, but slow |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o-mini` | paid |
| **Google Gemini** | `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.0-flash` | free tier |
| **Groq** | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile` | free tier |
| **Together** | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | paid |
| **Ollama (local)** | `http://localhost:11434/v1` | `llama3.2` | free, offline |
| **LM Studio** | `http://localhost:1234/v1` | whatever you loaded | free, offline |
| **vLLM** | `http://localhost:8000/v1` | your served model | free, offline |

### Z.AI / GLM Coding Plan

The config ships ready for z.ai. Two of its quirks are handled automatically but
are worth understanding:

- **`temperature` is exclusive 0–1.** Sending `0` returns HTTP 400. The app clamps
  it, and defaults to `1`, which z.ai recommends for glm-5.3-flash.
- **`thinking.type` only supports `enabled` on glm-5.3-flash** — thinking cannot be
  turned off. Every request spends reasoning tokens before writing anything, so
  `MAX_TOKENS` needs to be generous. The app enforces an 8000 floor for this
  provider; 12000 is a comfortable setting for the full analysis.

glm-5.3-flash has a 1M context and 128K max output, so neither is a constraint
here. `glm-5.3-flashx` is faster but is not included in the Coding Plan.

---

## Model requirements

This is the part worth reading carefully. The task is **not** trivial: it has to read structured JSON, hold a dozen data points at once, and write prose grounded in them.

### Minimum

- **≥ 8B parameters** instruction-tuned, or a 20B+ mixture-of-experts
- **≥ 32k context** (the digest is ~3.2k tokens; full mode sends ~1.5k per call)
- **JSON output** — either native JSON mode or reliable instruction-following
- **≥ 2,000 output tokens** free for the answer

Below this, expect either malformed JSON or generic horoscope prose that ignores your data.

### Recommended

- **70B-class dense**, or a frontier small model (Gemini Flash, GPT-4o-mini)
- **Native JSON mode** (`response_format: {"type":"json_object"}`) for reliability
- **Non-reasoning**, or a generous token budget if it is a reasoning model

### The reasoning-token trap

Measured on the live OpenRouter free tier: some models spend thousands of tokens on hidden reasoning *before* writing anything.

| Model | Reasoning tokens observed | Budget needed |
|---|---|---|
| nemotron-3.5-lightning | 3,077 | 4,500+ |
| nemotron-3-ultra-550b | 1,395 | 3,500+ |
| dots-3-note | 1,305 | 3,500+ |
| north-mini-code | 792 | 2,500+ |
| gemma-4-26b | 0 | 2,000 |

If a model returns an empty answer, **raise `MAX_TOKENS` first** — that is almost always the cause, and the error message will say so explicitly.

### Small local models

The full pipeline needs the model to emit parseable JSON. Models under ~7B frequently fail at the synthesis step. If you're running Ollama on a laptop:

- `llama3.2:3b` — will complete, output is shallow. Fine for testing the plumbing.
- `llama3.1:8b` — the realistic floor for useful prose.
- `qwen2.5:14b` / `llama3.3:70b` — noticeably better synthesis if you have the RAM.
- Non-reasoning models behave more predictably here than reasoning ones.

Use `--digest` (1 call) with small local models, not `--full` (13 calls), unless you have time to spare.

---

## What gets sent

Be clear-eyed about this, because "private" and "sends my data to an API" are in tension.

| Mode | Network | What leaves your machine |
|---|---|---|
| default (no flag) | **none** | **nothing** |
| `--digest` | 1 request | Category shares, hourly counts, quarter trajectories, top channel **names** |
| `--full` | ~13 requests | Everything above, **plus ~24 real video titles per interest** (~274 titles) |

`--full` sends titles because that's what makes the analysis specific instead of generic. If you'd rather not, use `--digest`, or point `BASE_URL` at a local Ollama and nothing leaves at all.

Always check first:

```bash
node cli.mjs takeout.zip --full --dry-run    # prints the exact payload, sends nothing
```

Your credentials live in `.env`, which is gitignored. They are read only by this script and sent only to the `BASE_URL` you specified.

---

## All options

```
node cli.mjs <takeout.zip | watch-history.html> [options]

  --no-ai              Analysis only, no network, no key. (default)
  --digest             One AI call over the aggregate statistics.
  --full               Per-interest analysis, then synthesis (~13 calls).
  --dry-run            Print the exact payload, then exit.
  --test-connection    Verify the configured endpoint, then exit.

  --out <dir>          Output directory (default: ./reports)
  --model <id>         Override MODEL
  --base-url <url>     Override BASE_URL
  --json               Print the profile as JSON, write no files
  --quiet, -q          Less output
```

Relevant `.env` keys: `BASE_URL`, `MODEL`, `API_KEY`, `MAX_TOKENS`, `TEMPERATURE`, `REQUEST_DELAY_MS`, `TIMEOUT_MS`, `OUTPUT_DIR`, `EXTRA_HEADERS`.

`REQUEST_DELAY_MS` matters on free tiers — they cap requests per minute. 1200ms is a sane default; raise it if you see 429s.

---

## Architecture

```
youscope/
├── cli.mjs               # the CLI — reads .env, writes reports
├── engine/               # pure JS, no dependencies, runs in Node or a browser
│   ├── takeout.js        # Takeout HTML/CSV parser
│   ├── zip.js            # ZIP + ZIP64 reader
│   ├── taxonomy.js       # 22-category classifier
│   ├── analytics.js      # all metrics
│   ├── correlations.js   # cross-interest Pearson + tensions
│   ├── insights.js       # deterministic portrait writer
│   ├── openrouter.js     # free-model roster, capability gating, Retry-After
│   ├── ai.js             # OpenAI-compatible client
│   └── deep.js           # map-reduce for --full
├── web/                  # the browser UI (optional; see below)
├── tests/                # jsdom integration tests
└── .env.example
```

The engine is deliberately environment-agnostic: the same files load in Node and in a browser.

### Performance

Measured on a real 35 MB export (34,425 events): **parse 0.35s, analyse 1.6s, total ~2s**. On a synthetic 200k-event export with 9,000 distinct channels: **12s**, ~250 MB RAM.

### The optional web UI

The repo still contains the original browser dashboard (`index.html`, `web/`). It's a single self-contained file:

```bash
node serve.mjs      # http://localhost:8000
```

It must be served over http, not opened as a file — browsers block API calls from `file://`. It has the same three analysis depths as the CLI. Treat it as a convenience; the CLI is the primary interface.

---

## Tests

```bash
npm install       # jsdom only, dev dependency
npm test          # 63 tests: engine, UI, file:// diagnostics, OpenRouter behaviour
```

Tests run offline against a local mock server.

---

## Troubleshooting

**"The model ran out of tokens before writing an answer"**
A reasoning model ate the budget. Raise `MAX_TOKENS` to 6000–8000, or pick a non-reasoning model.

**Empty or unparseable JSON**
The model is too small or lacks JSON mode. Try `--digest`, a 70B-class model, or one with native `response_format` support.

**HTTP 400 mentioning temperature**
Some providers reject `temperature: 0` (z.ai's range is exclusive 0–1). The app
clamps this automatically for recognised providers. If you're on a custom proxy,
set `PROVIDER=zai` in `.env` so the same rules apply.

**429 errors**
Free-tier per-minute cap. Raise `REQUEST_DELAY_MS`, or switch model.

**"No watch history found"**
Wrong export format (must be HTML), or "YouTube and YouTube Music" wasn't selected.

**Report says the data starts recently, but I've used YouTube for years**
Takeout only contains what's still in your watch history. Check `myaccount.google.com/activitycontrols` — history may have been paused.

---

## License

MIT — see [LICENSE](LICENSE).
