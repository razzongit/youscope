# YouScope

**What your watch history actually says about you.**

YouScope is a private, client-side analyzer for your Google Takeout YouTube export. Drop your `takeout-*.zip`, and it reads every watch, search, music play and comment — then maps your interests, tracks how they shifted quarter by quarter, and writes a portrait of the person behind the timeline.

Nothing is uploaded. No account, no server, no tracking. Your zip is unzipped in the tab and forgotten when you close it.

---

## Why this exists

Your YouTube history is the most honest behavioural dataset you own. It records what you actually reached for, not what you say you're interested in. Most people never look at it — and when they do, Google gives them an endless scroll of rows.

YouScope answers the questions that data can actually answer:

- **What are my core interests?** — ranked, with the channels that constitute each one.
- **Which of them are permanent, and which were a phase?** — trajectory labels computed per quarter: *persistent*, *rising*, *steady*, *fading*, *gone quiet*.
- **How did I change?** — a stream graph of interest composition across the whole window, plus the single largest shift.
- **When does my attention actually happen?** — hour-of-day clock, weekday × hour grid, night-owl and early-bird scores.
- **What do I binge?** — sessions, longest marathons, and 24-hour channel binges.
- **What was I looking for?** — 7,400 searches clustered into intent themes.
- **What does it conclude about me?** — a written portrait, honest about what the data can't tell you.

---

## Quick start

### Use it

**If you only want the analysis (no API key):** double-click `index.html`. Everything works offline.

**If you want to use an AI key:** you must serve the folder over http. Browsers block `fetch` from `file://` pages — that is a security rule, not a bug in your key, and no provider can work around it.

```bash
cd youscope
node serve.mjs          # then open http://localhost:8000
```

Or with no helper: `python3 -m http.server 8000` / `npx serve .`

The app detects `file://` and says so in the UI rather than failing with a generic network error.

1. **[Open `index.html`](index.html)** — double-click it, or host it anywhere static.
2. Get your data from [takeout.google.com](https://takeout.google.com):
   - Deselect all
   - Tick **YouTube and YouTube Music**
   - Format: **HTML** (not JSON — the HTML export is the one with full history)
   - Export, wait for the email, download the zip
3. Drop the zip into the page. That's it.

**Don't unzip it yourself.** YouScope reads the `.zip` directly, including Google's ZIP64 format.

### Three depths of portrait

The **Portrait** page lets you choose how much work to do — and how much to reveal.

| Depth | Cost | What it reads | What it sends |
|---|---|---|---|
| **Built-in** | free, no key | Your computed statistics | **Nothing** — runs entirely in the tab |
| **Digest** | 1 API call | The aggregate summary | Category shares, hourly counts, top channel names |
| **Full personal** | ~13 API calls | **The videos you actually watched** | 24 real titles per interest, sampled across years |

**Full personal** is the answer to "tell me something the numbers can't." It runs a map-reduce:

1. **Map** — for each of your top 12 interests, a model reads ~24 of your real video titles drawn evenly across your whole history, and reports what *that specific interest* consists of. Sub-themes, what pulls you back, internal tensions, how it shifted.
2. **Reduce** — a second model reads all 12 analyses plus your cross-interest correlations and writes the final portrait: the through-line connecting your most different interests, what moves together and what trades off, the shape of your days, what you're working toward, and the blind spot.

Because each call sees only one interest, prompts stay small (~1.5k tokens) and even free-tier models handle them well. The synthesis call is the only one that needs real reasoning capacity — use a 70B-class model or Gemini Flash there.

**Consent is explicit.** Full mode sends your actual video titles, which is materially more revealing than statistics. The UI says so plainly, shows you the exact titles it will send before you run it, and points you at Digest if you'd rather not.

**Failure is non-destructive.** If a call fails with 429 the run stops rather than burning your quota, keeping whatever was already analysed. If the final synthesis fails, you still get every per-interest analysis plus a locally-composed summary — never a blank page after 12 successful calls.

#### Providers

| Provider | Cost | Notes |
|---|---|---|
| **OpenRouter** | **Free** | Any `:free` model. Best default. [Get a key](https://openrouter.ai/keys) |
| **Google Gemini** | Free tier | Generous limits, OpenAI-compatible endpoint |
| **Groq** | Free tier | Very fast |
| **Ollama** | Free, local | Nothing leaves your machine, even in full mode |
| **OpenAI** | Paid | `gpt-4o-mini` handles digest fine |

The key lives in `localStorage` and requests go from your browser straight to the provider. There is no server, so there is nothing of ours to leak it.

### Cross-interest analysis (local, free)

Both Digest and Full modes benefit from correlations computed on your device:

> **Programming** and **AI & Machine Learning** move together (r=0.94)
> **Music** trades off against **Programming** (r=−0.61)

These are Pearson correlations over quarterly share, which catches things single-category trajectory labels cannot: what rises *because* something else falls. Also detects tensions — e.g. heavy fitness viewing alongside 30% of watching after midnight.

---

## What it computes

| Analysis | Method |
|---|---|
| **Interest classification** | 22-category taxonomy, matched by curated channel list first, then title keywords. ~73–75% coverage on real exports; the remainder is reported as long-tail rather than forced into a bucket. |
| **Trajectory labels** | Per-quarter share series → `persistent` (present every quarter), `rising` (>1.4× growth), `fading`, `gone quiet`, `steady`. Volume-gated so a category with 3 watches isn't called "core". Span-aware: with under 5 quarters it refuses to claim persistence. |
| **Sessions** | Consecutive watches under 30 minutes apart. |
| **Binges** | 4+ videos of one channel within 24 hours. |
| **Dead links** | Entries where the title is the URL itself — the video was deleted or made private. |
| **Ads** | `From Google Ads` entries excluded from all interest math, counted separately. |
| **Timezone** | Detected from the modal timezone label in the export (not assumed). |

### Honesty by construction

The tool is deliberately built to *not* overclaim:

- Watch history measures **attention, not enjoyment**. A video you hated but finished looks identical to one you loved.
- Auto-play inflates volume. Skips aren't recorded.
- Short exports (< 5 quarters) are told they're too short to establish persistence.
- The data gap problem is surfaced: if your history was off for months, the tool says so instead of drawing a fake trend through it.
- Deleted videos leave holes — reported as a count, not silently ignored.

---

## Architecture

```
youscope/
├── engine/               # pure JS, runs in browser and Node
│   ├── takeout.js        # Takeout HTML/CSV parser
│   ├── zip.js            # ZIP + ZIP64 reader (fflate / DecompressionStream)
│   ├── taxonomy.js       # 22-category interest classifier
│   ├── analytics.js      # all metrics
│   ├── correlations.js   # cross-interest Pearson correlations + tensions
│   ├── insights.js       # deterministic portrait writer + AI digest builder
│   ├── ai.js             # BYO-key OpenAI-compatible client
│   └── deep.js           # full-personal map-reduce (per-interest → synthesis)
├── web/
│   ├── index.html        # dev entry (loads modules separately)
│   ├── app.js            # views + orchestration
│   ├── portrait.js       # the 3-tier portrait UI + consent flow
│   ├── charts.js         # hand-rolled SVG charts, zero dependencies
│   ├── theme.css         # design system
│   └── vendor/fflate.js  # MIT, for inflate
├── build.mjs             # inlines everything → dist/index.html
├── serve.mjs             # tiny static server (needed for API keys)
├── tests/                # jsdom integration tests for the BYO-key flow
├── index.html            # the built single file (GitHub Pages entry)
└── dist/index.html       # same bundle
```

**No framework, no bundler runtime, no npm install to use it.** `build.mjs` is a 60-line inliner; the output is one ~185 KB HTML file that works from `file://`.

### Develop

```bash
git clone <repo> && cd youscope
node build.mjs          # rebuild dist/index.html + index.html
open web/index.html     # dev version, separate files (needs a static server for module paths)
```

### Validate the engine against real data

The engine runs headless — same code the browser uses:

```bash
node -e '
const Z = require("./engine/zip.js"),
      T = require("./engine/takeout.js"),
      X = require("./engine/taxonomy.js"),
      A = require("./engine/analytics.js"),
      I = require("./engine/insights.js"),
      fs = require("fs");
(async () => {
  const files = await Z.readTakeoutZip(fs.readFileSync(process.argv[1]));
  const data = T.parseTakeoutFiles(files);
  const p = A.buildProfile(data, X);
  console.log(p.counts, p.interests.coverage + "% classified");
  console.log(I.build(p).sections.map(s => "## " + s.title + "\n" + s.body).join("\n\n"));
})();
' ~/Downloads/takeout-*.zip
```

---

## Performance

Measured on a real 35 MB export containing ~34,000 watch events:

| Stage | Time |
|---|---|
| Unzip (ZIP64, 23 entries) | ~340 ms |
| Parse HTML (35 MB) + 6 CSVs | ~250 ms |
| Full analytics | ~2.4 s |
| **End to end** | **~3 s** |

Everything is synchronous-ish and single-pass; there's no worker thread, which keeps the code simple. If you have a 500 MB export, that's the point where a Web Worker would earn its place.

---

## Privacy

- **No network calls** except: Google Fonts (cosmetic) and, only if you add a key, your chosen AI provider.
- **No analytics, no telemetry, no logging.**
- **No storage of raw history.** A compact aggregate is kept in `sessionStorage` so a refresh doesn't lose your dashboard — never the watch events themselves.
- The AI key is stored in `localStorage` on your machine, never transmitted anywhere but the provider you selected.
- Open `dist/index.html` with your network off and everything except the AI panel still works.

---

## Troubleshooting

**"Network error reaching …" when you paste a key.**
You are almost certainly on `file://`. Run `node serve.mjs` and use `http://localhost:8000`. The app now says this explicitly instead of blaming your key.

**"Type the model id your endpoint expects."**
A custom server cannot guess its own model name. Type it exactly as the provider documents it — `llama3.2` for local Ollama, `meta-llama/Llama-3.3-70B-Instruct-Turbo` for Together, etc. Use **Test connection** to confirm before spending a run.

**Base URL confusion.**
Paste any of these and the app normalises them:
`https://api.x.com/v1` · `https://api.x.com/v1/` · `https://api.x.com/v1/chat/completions` · `api.x.com/v1`

**429 / rate limited on free models.**
Switch model rather than retrying — OpenRouter rotates which `:free` models are available. Full mode stops at the first 429 instead of burning your quota, and keeps whatever it already analysed.

**Nothing renders after choosing Full personal.**
Check the export has at least ~50 watched videos; the sampler needs enough per category to build a meaningful prompt.

**OpenAI rejects browser calls entirely.**
`api.openai.com` sends no CORS headers, so it cannot be called from any web page. Use OpenRouter, Gemini, Groq, or run Ollama locally — or put a tiny proxy in front of OpenAI.

## Contributing

The highest-leverage contribution is **taxonomy coverage**. The classifier recognises ~73% of a typical export; the long tail is where it loses. If you run it on your own data and see a channel that's obviously misclassified or unclassified:

1. Open the **Interests** page and note the weak categories.
2. Add the channel to the right category in `engine/taxonomy.js`.
3. Check it didn't move *other* categories (`node build.mjs` and re-run).

Guard rail: **never add a bare common word as a keyword.** Two real bugs found this way:

- `watch ` matched *"watch this"* and pulled cooking channels into Fashion.
- `react` matched *"REACTION"* and filed Kendrick Lamar videos under Programming.

Short tokens now match on word boundaries, but ambiguity still bites (`react` = React.js *or* a reaction video). Prefer multi-word phrases: `react js`, not `react`. Precision matters more than coverage here — a false positive in Full mode feeds a wrong sub-theme to the model, which then reasons confidently from it.

---

## License

MIT — see [LICENSE](LICENSE).

Built because the data was already there, and nobody was reading it properly.
