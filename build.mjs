#!/usr/bin/env node
/* YouScope build — inlines all CSS/JS into a single portable dist/index.html.
 * No dependencies. Run: node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const css = read('web/theme.css');
const scripts = [
  'web/vendor/fflate.js',
  'engine/takeout.js',
  'engine/taxonomy.js',
  'engine/analytics.js',
  'engine/correlations.js',
  'engine/insights.js',
  'engine/ai.js',
  'engine/deep.js',
  'engine/zip.js',
  'web/charts.js',
  'web/portrait.js',
  'web/app.js',
];

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YouScope — what your watch history says about you</title>
<meta name="description" content="A private, in-browser analyzer for your Google Takeout YouTube history. Maps your interests, tracks how they changed, and writes a portrait — nothing ever leaves your device.">
<meta name="color-scheme" content="dark">
<meta property="og:title" content="YouScope — what your watch history says about you">
<meta property="og:description" content="Drop your YouTube Takeout zip. Get your interests, their evolution, and a portrait. 100% client-side.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2307090c'/%3E%3Ccircle cx='16' cy='16' r='7' fill='none' stroke='%237dffb3' stroke-width='1.6'/%3E%3Ccircle cx='16' cy='16' r='2.4' fill='%237dffb3'/%3E%3C/svg%3E">
${fonts}
<style>
${css}
</style>
</head>
<body>
<noscript><div style="padding:40px;font-family:system-ui">
  <h1>YouScope needs JavaScript</h1>
  <p>All the analysis runs in your browser — nothing is sent to a server. Please enable JavaScript to continue.</p>
</div></noscript>
${scripts.map(s => `<script>\n${read(s)}\n</script>`).join('\n')}
</body>
</html>
`;

if (!existsSync(join(root, 'dist'))) mkdirSync(join(root, 'dist'));
writeFileSync(join(root, 'dist/index.html'), html, 'utf8');

// also emit a GitHub-Pages-ready copy at repo root as index.html
writeFileSync(join(root, 'index.html'), html, 'utf8');

const kb = (html.length / 1024).toFixed(0);
console.log(`✓ dist/index.html  ${kb} KB  (${scripts.length} scripts, 1 stylesheet inlined)`);
console.log(`✓ index.html       same bundle, ready for GitHub Pages`);
