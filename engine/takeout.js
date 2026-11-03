/* YouScope — takeout.js
 * Parses a Google Takeout (YouTube + YouTube Music) export.
 * Runs in browser and Node (no DOM needed for parsing).
 * Exported: parseWatchHistory, parseSearchHistory, parseSubscriptionsCsv,
 *           parseCommentsCsv, parsePlaylistsCsv, parseMusicLibraryCsv, parseTakeoutFiles
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YSTakeout = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const CELL_OPEN = '<div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">';
  const MONTHS = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7,
    sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
  };
  // Timezone offset table (minutes to add to local time to reach UTC) — covers Takeout common set.
  const TZ_OFFSETS = {
    IST: -330, UTC: 0, GMT: 0, CET: -60, CEST: -120, EST: 300, EDT: 240,
    EST5EDT: 300, PST: 480, PDT: 420, MST: 420, MDT: 360, CST: 360, CDT: 300,
    BST: -60, GST: -240, JST: -540, KST: -540, AEST: -600, AEDT: -660,
    NZST: -720, NZDT: -780, HKT: -480, SGT: -480, WIB: -420, ICT: -420,
    MSK: -180, EET: -120, EEST: -180, BRT: 180, ARST: 180, CAT: -120,
    WAT: -60, SAST: -120, HST: 600, AKST: 540, AKDT: 480, PHT: -480,
  };

  function decodeEntities(s) {
    if (!s) return s;
    return s
      .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
      .replace(/&amp;/g, '&');
  }

  function parseTimestamp(str) {
    // "25 Oct 2026, 21:51:26 IST" | "25 Oct 2026, 21:51:26 UTC+5:30" | "Oct 25, 2026, 9:51:26 PM IST"
    if (!str) return null;
    const m = str.match(/^(\d{1,2}) ([A-Z][a-z]+) (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (.+)$/);
    if (m) {
      const mon = MONTHS[m[2].toLowerCase()];
      if (mon === undefined) return null;
      const tz = m[7];
      let off = TZ_OFFSETS[tz];
      let tzName = tz;
      if (off === undefined) {
        const um = tz.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/);
        if (um) { off = (um[1] === '+' ? -1 : 1) * (+um[2] * 60 + (um[3] ? +um[3] : 0)); tzName = tz; }
        else { off = null; }
      }
      const base = Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +m[6]);
      if (off === null) return { utc: base, tz: null }; // treat as UTC-ish, flag unknown
      return { utc: base - off * 60000, tz: tzName };
    }
    const m2 = str.match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (AM|PM) (.+)$/);
    if (m2) {
      const mon = MONTHS[m2[1].toLowerCase()];
      if (mon === undefined) return null;
      let hr = +m2[4] % 12; if (m2[7] === 'PM') hr += 12;
      const tz = m2[8];
      let off = TZ_OFFSETS[tz];
      if (off === undefined) {
        const um = tz.match(/^UTC([+-])(\d{1,2})(?::(\d{2}))?$/);
        if (um) off = (um[1] === '+' ? -1 : 1) * (+um[2] * 60 + (um[3] ? +um[3] : 0));
        else off = 0;
      }
      return { utc: Date.UTC(+m2[3], mon, +m2[2], hr, +m2[5], +m2[6]) - off * 60000, tz };
    }
    return null;
  }

  function extractBlocks(html) {
    const marker = '<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp">';
    if (!html.includes(marker)) return [];
    // Keep full block incl. caption (ads marker "From Google Ads" lives there).
    return html.split(marker).slice(1).map(b => b.slice(0, b.indexOf('</div></div></div>') > 0 ? b.indexOf('</div></div></div>') : undefined));
  }

  function parseActivityHtml(html, kind) {
    const events = [];
    const blocks = extractBlocks(html);
    for (const b of blocks) {
      const i = b.indexOf(CELL_OPEN);
      if (i < 0) continue;
      const cell = b.slice(i + CELL_OPEN.length, b.indexOf('</div>', i));
      const header = (b.match(/mdl-typography--title">([^<]*)/) || [])[1] || '';
      const product = header.trim();
      // <br> separated segments
      const parts = cell.split('<br>').map(s => s.trim()).filter(Boolean);
      if (!parts.length) continue;
      let title = null, titleUrl = null, channel = null, channelId = null, channelUrl = null, timeStr = null, extra = null;
      const first = parts[0];
      let mode = null; // 'watch' | 'search'
      if (/^Watched(&nbsp;|\s)/.test(first)) mode = 'watch';
      else if (/^Searched for(&nbsp;|\s)/.test(first)) mode = 'search';
      else continue; // "Viewed Ads On YouTube Homepage", "Used Shorts creation tools", "Visited …" etc.
      if (kind !== 'any' && kind !== mode) continue;
      if (mode === 'search') {
        const linkM = first.match(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/);
        if (linkM) {
          titleUrl = linkM[1];
          title = decodeEntities(linkM[2]).trim();
          if (title.startsWith('https://')) title = null;
        } else {
          title = decodeEntities(first.replace(/^Searched for(&nbsp;|\s)+/, '').replace(/<[^>]+>/g, '')).trim() || null;
        }
      } else {
        const linkM = first.match(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/);
        if (linkM) {
          titleUrl = linkM[1];
          title = decodeEntities(linkM[2]).trim();
          if (title.startsWith('https://')) title = null; // dead link, title unavailable
        } else {
          const bare = first.replace(/^Watched(&nbsp;|\s)+/, '');
          title = decodeEntities(bare.replace(/<[^>]+>/g, '')).trim() || null;
        }
      }
      for (let p = 1; p < parts.length; p++) {
        const seg = parts[p];
        if (seg.startsWith('<a href="https://www.youtube.com/channel/UC')) {
          const cm = seg.match(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/);
          if (cm) { channelUrl = cm[1]; channelId = (cm[1].match(/UC[\w-]+/) || [])[0]; channel = decodeEntities(cm[2]).trim(); }
        } else if (/^Watched at/.test(seg)) {
          extra = seg;
        } else if (/^\d{1,2} [A-Z][a-z]+ \d{4}, \d{1,2}:\d{2}:\d{2} /.test(seg) ||
                   /^[A-Z][a-z]+ \d{1,2}, \d{4}, \d{1,2}:\d{2}:\d{2} (AM|PM) /.test(seg)) {
          timeStr = seg.replace(/&nbsp;/g, ' ').trim();
        }
      }
      const ts = parseTimestamp(timeStr);
      events.push({
        kind: mode,
        title, titleUrl, channel, channelId, channelUrl,
        product: product === 'YouTube Music' ? 'music' : 'youtube',
        ad: /From Google Ads/.test(b),
        ts: ts ? ts.utc : null,
        tz: ts ? ts.tz : null,
        extra,
      });
    }
    return events;
  }

  function parseWatchHistory(html) { return parseActivityHtml(html, 'watch'); }

  function parseSearchHistory(html) {
    // Returns search events; watched entries found in this file are returned separately.
    const all = parseActivityHtml(html, 'any');
    const search = all.filter(e => e.kind === 'search').map(e => ({
      query: e.title, url: e.titleUrl, ts: e.ts, tz: e.tz, product: e.product,
    }));
    const watched = all.filter(e => e.kind === 'watch');
    return { search, watched };
  }

  // ---------- CSV ----------
  function parseCsv(text) {
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cur += '"'; i++; }
          else q = false;
        } else cur += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur.length || row.length) { row.push(cur.replace(/\r$/, '')); rows.push(row); }
    if (!rows.length) return [];
    const head = rows[0].map(h => h.trim());
    return rows.slice(1).filter(r => r.some(c => c !== '')).map(r => {
      const o = {}; head.forEach((h, i) => { o[h] = r[i] !== undefined ? r[i] : ''; }); return o;
    });
  }

  function parseSubscriptionsCsv(text) {
    return parseCsv(text).map(r => ({
      channelId: r['Channel ID'], url: r['Channel URL'], title: decodeEntities(r['Channel title']),
    })).filter(s => s.title);
  }

  function parseCommentsCsv(text) {
    return parseCsv(text).map(r => {
      let txt = r['Comment text'] || '';
      try { const j = JSON.parse(txt); if (j && typeof j.text === 'string') txt = j.text; } catch (e) { /* plain */ }
      return {
        id: r['Comment ID'], channelId: r['Channel ID'],
        createdAt: r['Comment create timestamp'] || null,
        videoId: r['Video ID'] || (r['Post ID'] || '').replace(/^.*:/, ''),
        text: decodeEntities(txt),
      };
    }).filter(c => c.text);
  }

  function parsePlaylistsCsv(text) {
    return parseCsv(text).map(r => ({
      id: r['Playlist ID'],
      title: decodeEntities(r['Playlist title (original)'] || ''),
      createdAt: r['Playlist create timestamp'] || null,
      updatedAt: r['Playlist update timestamp'] || null,
      visibility: r['Playlist visibility'] || '',
    })).filter(p => p.title);
  }

  function parseMusicLibraryCsv(text) {
    return parseCsv(text).map(r => {
      const artists = [];
      for (let i = 1; i <= 13; i++) { const a = r['Artist Name ' + i]; if (a) artists.push(decodeEntities(a)); }
      return {
        videoId: r['Video ID'], title: decodeEntities(r['Song Title'] || ''),
        album: decodeEntities(r['Album Title'] || ''), artists,
      };
    }).filter(s => s.title);
  }

  // ---------- Takeout file aggregation ----------
  const WATCH_RE = /watch[-_ ]?history\.html?$/i;
  const SEARCH_RE = /search[-_ ]?history\.html?$/i;

  function findFile(files, re) {
    // files: [{name, text}]
    let best = null, bestDepth = 1e9;
    for (const f of files) {
      const base = f.name.split('/').pop();
      if (re.test(base) && !/#/.test(base)) {
        const depth = f.name.split('/').length;
        if (depth < bestDepth) { best = f; bestDepth = depth; }
      }
    }
    return best;
  }

  function parseTakeoutFiles(files, onProgress) {
    // files: [{name, text}] — already-decoded text of each archived file
    const report = { watch: [], search: [], subscriptions: [], comments: [], playlists: [], musicLibrary: [] };
    const wf = findFile(files, WATCH_RE);
    if (wf) { report.watch = parseWatchHistory(wf.text); onProgress && onProgress('watch', report.watch.length); }
    const sf = findFile(files, SEARCH_RE);
    if (sf) {
      const r = parseSearchHistory(sf.text);
      report.search = r.search;
      // merge watched events found inside search-history (videos launched from search)
      const wfName = wf ? wf.name : null;
      const have = new Set(report.watch.map(e => e.titleUrl + '|' + e.ts));
      for (const e of r.watched) {
        if (!have.has(e.titleUrl + '|' + e.ts)) report.watch.push(e);
      }
      onProgress && onProgress('search', report.search.length);
    }
    for (const f of files) {
      const base = f.name.split('/').pop();
      if (/^subscriptions\.csv$/i.test(base)) report.subscriptions = parseSubscriptionsCsv(f.text);
      else if (/^comments\.csv$/i.test(base)) report.comments = parseCommentsCsv(f.text);
      else if (/^playlists\.csv$/i.test(base)) report.playlists = parsePlaylistsCsv(f.text);
      else if (/^music library songs\.csv$/i.test(base)) report.musicLibrary = parseMusicLibraryCsv(f.text);
    }
    return report;
  }

  return {
    parseWatchHistory, parseSearchHistory, parseCsv,
    parseSubscriptionsCsv, parseCommentsCsv, parsePlaylistsCsv, parseMusicLibraryCsv,
    parseTakeoutFiles, parseTimestamp, decodeEntities,
  };
});
