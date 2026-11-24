"use strict";
const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { rebrandHtml, PAGES } = require("../scripts/rebrand.js");
const cfg = require("../site.config.js");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

it("every page matches site.config.js (run `npm run rebrand` after editing the config)", () => {
  for (const page of PAGES) {
    const h = fs.readFileSync(path.join(root, page), "utf8");
    assert.equal(rebrandHtml(h, cfg), h, page);
    assert.ok(h.includes(`<title>${cfg.name} — ${cfg.tagline}</title>`), page);
  }
});

it("rebrand swaps name, tagline and title", () => {
  const out = rebrandHtml(html, { name: "somoplay", tagline: "Small games, calm mind.", description: "Games" });
  assert.ok(out.includes("<title>somoplay — Small games, calm mind.</title>"));
  assert.ok(out.includes('data-brand="name">somoplay</span>'));
  assert.ok(out.includes('data-brand="tagline">Small games, calm mind.</small>'));
  assert.ok(out.includes('content="Games"'));
  assert.ok(out.includes('aria-label="somoplay home"'));
  assert.ok(!out.includes(">somosudoku<"));
});

it("rebrand also updates the home link on a page in a subfolder", () => {
  const sub = fs.readFileSync(path.join(root, "words/index.html"), "utf8");
  const out = rebrandHtml(sub, { name: "somoplay", tagline: "t", description: "d" });
  assert.ok(out.includes('<a class="brand" href="../" aria-label="somoplay home">'));
});

it("each page has a header tab for every game, with its own tab marked current", () => {
  const pages = { sudoku: "index.html", words: "words/index.html" };
  for (const game of cfg.games) {
    const file = pages[game.id];
    assert.ok(file, "no page for " + game.id);
    const h = fs.readFileSync(path.join(root, file), "utf8");
    const nav = h.match(/<nav class="game-tabs"[\s\S]*?<\/nav>/);
    assert.ok(nav, file + " has the game tabs");
    for (const other of cfg.games) assert.ok(nav[0].includes(">" + other.title + "</a>"), file + " links to " + other.title);
    assert.match(nav[0], new RegExp('aria-current="page">' + game.title + "</a>"));
  }
});

it("shared CSS leaves room at the bottom so a fixed host badge cannot cover controls", () => {
  const css = fs.readFileSync(path.join(root, "shared/base.css"), "utf8");
  assert.match(css, /--host-badge-clearance:\s*calc\(64px \+ env\(safe-area-inset-bottom/);
  assert.match(css, /padding: 35px 28px calc\(24px \+ var\(--host-badge-clearance\)\)/);
  assert.match(css, /padding: 22px 16px calc\(20px \+ var\(--host-badge-clearance\)\)/);
});
