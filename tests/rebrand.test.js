"use strict";
const { it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { rebrandHtml } = require("../scripts/rebrand.js");
const cfg = require("../site.config.js");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

it("index.html matches site.config.js (run `npm run rebrand` after editing the config)", () => {
  assert.equal(rebrandHtml(html, cfg), html);
  assert.ok(html.includes(`<title>${cfg.name} — ${cfg.tagline}</title>`));
});

it("rebrand swaps name, tagline and title", () => {
  const out = rebrandHtml(html, { name: "somoplay", tagline: "Small games, calm mind.", description: "Games" });
  assert.ok(out.includes("<title>somoplay — Small games, calm mind.</title>"));
  assert.ok(out.includes('data-brand="name">somoplay</span>'));
  assert.ok(out.includes('data-brand="tagline">Small games, calm mind.</small>'));
  assert.ok(out.includes('content="Games"'));
  assert.ok(!out.includes(">somosudoku<"));
});
