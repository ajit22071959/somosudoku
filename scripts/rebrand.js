#!/usr/bin/env node
/**
 * Copy the name, tagline and description from site.config.js into index.html
 * and words/index.html (title, meta description, header) and the README heading.
 * Usage: edit site.config.js, then `npm run rebrand`.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const cfg = require(path.join(root, "site.config.js"));

// Every page with the site header.
const PAGES = ["index.html", "words/index.html"];

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function rebrandHtml(html, c) {
  html = html.replace(/(<!-- brand:start[^>]*-->)[\s\S]*?(<!-- brand:end -->)/,
    `$1\n  <meta name="description" content="${esc(c.description)}">\n  <title>${esc(c.name)} — ${esc(c.tagline)}</title>\n  $2`);
  html = html.replace(/(<span class="brand-name" data-brand="name">)[^<]*(<\/span>)/, `$1${esc(c.name)}$2`);
  html = html.replace(/(<small data-brand="tagline">)[^<]*(<\/small>)/, `$1${esc(c.tagline)}$2`);
  html = html.replace(/(<a class="brand" href="[^"]*" aria-label=")[^"]*(")/, `$1${esc(c.name)} home$2`);
  return html;
}

if (require.main === module) {
  for (const page of PAGES) {
    const p = path.join(root, page);
    fs.writeFileSync(p, rebrandHtml(fs.readFileSync(p, "utf8"), cfg));
  }
  const readmePath = path.join(root, "README.md");
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, "utf8").replace(/^# .*$/m, `# ${cfg.name}`);
    fs.writeFileSync(readmePath, readme);
  }
  console.log(`Rebranded to "${cfg.name} — ${cfg.tagline}".`);
}

module.exports = { rebrandHtml, PAGES };
