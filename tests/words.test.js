"use strict";
const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const W = require("../games/words/wordlogic.js");

const dir = path.join(__dirname, "..", "games", "words");
let dict; // the real ENABLE list
const small = W.buildTrie(["cat", "cats", "at", "ta", "act", "tac", "scat", "as", "xi", "ax", "ox", "ex", "bad", "word"]);

before(() => {
  dict = W.buildTrie(fs.readFileSync(path.join(dir, "enable.txt"), "utf8"), fs.readFileSync(path.join(dir, "ai-skip.txt"), "utf8"));
});

/** Put a word on a board: start "r,c", across or down. */
function put(board, word, r, c, horiz, blanks) {
  const b = board.slice();
  for (let k = 0; k < word.length; k++) {
    const i = horiz ? r * 15 + c + k : (r + k) * 15 + c;
    b[i] = { l: word[k], b: !!(blanks && blanks.includes(k)) };
  }
  return b;
}
function pl(word, r, c, horiz, skip) {
  const out = [];
  for (let k = 0; k < word.length; k++) {
    if (skip && skip.includes(k)) continue;
    out.push({ i: horiz ? r * 15 + c + k : (r + k) * 15 + c, l: word[k], b: false });
  }
  return out;
}

describe("tiles and bag", () => {
  it("has 100 tiles with 2 blanks and standard values", () => {
    const bag = W.makeBag(W.makeRng(1));
    assert.equal(bag.length, 100);
    assert.equal(bag.filter((t) => t === "?").length, 2);
    assert.equal(bag.filter((t) => t === "E").length, 12);
    assert.equal(W.VALUES.Q, 10);
    assert.equal(W.VALUES["?"], 0);
    assert.equal(W.rackValue(["Q", "Z", "?", "A"]), 21);
  });
  it("a seed gives the same bag", () => {
    assert.deepEqual(W.makeBag(W.makeRng("x")), W.makeBag(W.makeRng("x")));
    assert.notDeepEqual(W.makeBag(W.makeRng("x")), W.makeBag(W.makeRng("y")));
  });
  it("draws and refills up to 7", () => {
    const bag = ["A", "B", "C"];
    assert.deepEqual(W.draw(bag, 2), ["C", "B"]);
    assert.deepEqual(W.refill(["X", "Y", "Z", "Q", "J", "K"], bag), ["X", "Y", "Z", "Q", "J", "K", "A"]);
    assert.equal(bag.length, 0);
  });
  it("exchange keeps the tile count and needs 7 in the bag", () => {
    const bag = W.makeBag(W.makeRng(3));
    const rack = W.draw(bag, 7);
    const res = W.exchange(rack, bag, rack.slice(0, 3), W.makeRng(4));
    assert.ok(res.ok);
    assert.equal(res.rack.length, 7);
    assert.equal(bag.length, 93);
    const sorted = (a) => a.slice().sort().join("");
    assert.equal(sorted(res.rack.concat(bag)), sorted(W.makeBag(W.makeRng(9))));
    assert.equal(W.exchange(rack, ["A", "B"], ["A"]).ok, false);
    assert.equal(W.exchange(["A"], bag, ["Q"]).ok, false);
    assert.equal(W.exchange(["A"], bag, []).ok, false);
  });
  it("removeFromRack handles repeats and blanks", () => {
    assert.deepEqual(W.removeFromRack(["A", "A", "?", "B"], ["A", "?"]), ["A", "B"]);
    assert.equal(W.removeFromRack(["A"], ["A", "A"]), null);
  });
});

describe("premium squares", () => {
  it("are symmetric in every direction", () => {
    for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) {
      const p = W.PREMIUM[r * 15 + c];
      assert.equal(p, W.PREMIUM[c * 15 + r]);
      assert.equal(p, W.PREMIUM[(14 - r) * 15 + c]);
      assert.equal(p, W.PREMIUM[r * 15 + 14 - c]);
    }
  });
  it("has a double-word start square in the centre and a sensible count of each", () => {
    assert.equal(W.PREMIUM[W.CENTER], "ST");
    assert.equal(W.wordMult(W.CENTER), 2);
    const count = (t) => W.PREMIUM.filter((p) => p === t).length;
    assert.equal(count("TW"), 8);
    assert.ok(count("DW") >= 12 && count("DW") <= 20, "DW " + count("DW"));
    assert.ok(count("TL") >= 8 && count("TL") <= 16, "TL " + count("TL"));
    assert.ok(count("DL") >= 16 && count("DL") <= 32, "DL " + count("DL"));
  });
});

describe("dictionary", () => {
  it("loads the full ENABLE list (2 to 15 letters)", () => {
    assert.ok(dict.has("quixotic"));
    assert.ok(dict.has("XI") && dict.has("ax") && dict.has("aa"));
    assert.ok(!dict.has("qwxz"));
    assert.ok(!dict.has("a"));
    assert.ok(!dict.has("ca"));
    assert.ok(dict.size > 300000);
  });
  it("words in the skip list stay valid for people but the computer won't play them", () => {
    const skip = fs.readFileSync(path.join(dir, "ai-skip.txt"), "utf8").split("\n").filter(Boolean);
    assert.ok(skip.length > 10);
    skip.forEach((w) => assert.ok(dict.has(w), w));
    const n = dict.walk(skip[0].toUpperCase(), 0);
    assert.equal(dict.term[n], 2);
  });
  it("can be rebuilt from its arrays (as sent from the worker)", () => {
    const copy = W.trieFromArrays({ letter: small.letter, term: small.term, first: small.first, next: small.next });
    assert.ok(copy.has("scat"));
    assert.ok(!copy.has("sca"));
  });
});

describe("move checking and scoring", () => {
  const empty = W.emptyBoard();
  it("first move must cover the centre and have 2+ letters", () => {
    assert.match(W.evaluateMove(empty, pl("CAT", 0, 0, true), small).error, /centre/);
    assert.match(W.evaluateMove(empty, [{ i: W.CENTER, l: "A", b: false }], small).error, /two letters/);
  });
  it("scores the first word with the start square doubling it", () => {
    const ev = W.evaluateMove(empty, pl("CAT", 7, 6, true), small);
    assert.ok(ev.ok);
    assert.deepEqual(ev.words.map((w) => w.word), ["CAT"]);
    assert.equal(ev.score, (3 + 1 + 1) * 2);
  });
  it("rejects tiles not in one line, gaps, taken squares and unconnected words", () => {
    let board = put(empty, "CAT", 7, 6, true);
    assert.match(W.evaluateMove(board, [{ i: 0, l: "A" }, { i: 16, l: "T" }], small).error, /one row or one column/);
    assert.match(W.evaluateMove(board, [{ i: 5 * 15 + 3, l: "A" }, { i: 5 * 15 + 5, l: "T" }], small).error, /unbroken/);
    assert.match(W.evaluateMove(board, [{ i: 7 * 15 + 6, l: "A" }], small).error, /taken/);
    assert.match(W.evaluateMove(board, pl("AT", 2, 2, true), small).error, /connect/);
    assert.match(W.evaluateMove(board, [{ i: 0, l: "A" }, { i: 0, l: "T" }], small).error, /Two tiles/);
  });
  it("allows gaps filled by board tiles (playing through)", () => {
    const board = put(empty, "CAT", 7, 6, true);
    // S above C's column? play S C A T: add S at (7,5)
    const ev = W.evaluateMove(board, [{ i: 7 * 15 + 5, l: "S", b: false }], small);
    assert.ok(ev.ok);
    assert.deepEqual(ev.words.map((w) => w.word), ["SCAT"]);
    // down through A: A T with A on board -> "AT" down from (7,7)
    const ev2 = W.evaluateMove(board, [{ i: 8 * 15 + 7, l: "T", b: false }], small);
    assert.deepEqual(ev2.words.map((w) => w.word), ["AT"]);
  });
  it("reports words not in the list but still previews the score", () => {
    const board = put(empty, "CAT", 7, 6, true);
    const ev = W.evaluateMove(board, [{ i: 8 * 15 + 6, l: "B", b: false }], small);
    assert.equal(ev.ok, false);
    assert.deepEqual(ev.invalid, ["CB"]);
    assert.ok(ev.score > 0);
  });
  it("counts premium squares only for new tiles", () => {
    let board = put(empty, "AT", 7, 7, true); // A(7,7) T(7,8)
    // X at (8,7) makes AX down
    const i = 8 * 15 + 7;
    const ev = W.evaluateMove(board, [{ i, l: "X", b: false }], small);
    const expect = (1 + 8 * W.letterMult(i)) * W.wordMult(i);
    assert.equal(ev.score, expect);
    // premium under an existing tile doesn't count again: replay through the centre tile
    board = put(empty, "AX", 7, 7, false); // A centre, X (8,7)
    const ev2 = W.evaluateMove(board, [{ i: 7 * 15 + 8, l: "T", b: false }], small); // AT across
    assert.equal(ev2.score, (1 + 1 * W.letterMult(7 * 15 + 8)) * W.wordMult(7 * 15 + 8));
  });
  it("adds both words when a tile makes two", () => {
    let board = put(W.emptyBoard(), "CAT", 7, 6, true);
    board = put(board, "A", 6, 9, true);
    const i = 7 * 15 + 9;
    const ev = W.evaluateMove(board, [{ i, l: "S", b: false }], small);
    assert.ok(ev.ok, ev.error);
    assert.deepEqual(ev.words.map((w) => w.word).sort(), ["AS", "CATS"]);
    const s = 1 * W.letterMult(i), wm = W.wordMult(i);
    assert.equal(ev.score, (3 + 1 + 1 + s) * wm + (1 + s) * wm);
  });
  it("blank tiles score zero", () => {
    const ev = W.evaluateMove(W.emptyBoard(), [{ i: 112, l: "C", b: true }, { i: 113, l: "A", b: false }, { i: 114, l: "T", b: false }], small);
    assert.equal(ev.score, (0 + 1 + 1) * 2);
  });
  it("using all seven tiles adds 50", () => {
    const ev = W.evaluateMove(W.emptyBoard(), pl("QUIXOTE", 7, 4, true), dict);
    const raw = ev.words[0].score;
    assert.ok(ev.ok && ev.bingo);
    assert.equal(ev.score, raw + 50);
  });
});

describe("move generation", () => {
  it("finds every opening for a small dictionary and scores like evaluateMove", () => {
    const moves = W.generateMoves(W.emptyBoard(), ["C", "A", "T"], small);
    const words = new Set(moves.map((m) => m.word));
    ["CAT", "ACT", "TAC", "AT", "TA"].forEach((w) => assert.ok(words.has(w), w));
    moves.forEach((m) => {
      assert.ok(m.placements.some((p) => p.i === W.CENTER));
      const ev = W.evaluateMove(W.emptyBoard(), m.placements, small);
      assert.ok(ev.ok);
      assert.equal(ev.score, m.score);
    });
  });
  it("matches evaluateMove for every move in a real mid-game position", () => {
    const rng = W.makeRng("gen");
    const g = W.newGame({ rng, players: [{ name: "a", cpu: true }, { name: "b", cpu: true }] });
    for (let turn = 0; turn < 8 && !g.over; turn++) {
      const moves = W.generateMoves(g.board, g.players[g.turn].rack, dict);
      moves.forEach((m) => {
        const ev = W.evaluateMove(g.board, m.placements, dict);
        assert.ok(ev.ok, m.word + " " + ev.error);
        assert.equal(ev.score, m.score, m.word);
      });
      const seen = new Set(moves.map((m) => m.placements.map((p) => p.i + p.l + p.b).sort().join("|")));
      assert.equal(seen.size, moves.length, "no duplicate moves");
      const pick = W.chooseMove(moves, "hard", rng);
      if (pick) W.playMove(g, pick.placements, dict); else W.passTurn(g);
    }
  });
  it("uses blanks and finds a bingo when there is one", () => {
    const moves = W.generateMoves(W.emptyBoard(), ["Q", "U", "I", "X", "O", "T", "?"], dict);
    const best = W.chooseMove(moves, "hard");
    assert.equal(best.tiles, 7);
    assert.ok(best.score >= 50 + 20);
    assert.ok(moves.some((m) => m.blanks > 0));
  });
  it("never plays a skip-list word", () => {
    const moves = W.generateMoves(W.emptyBoard(), ["S", "L", "U", "T", "Q", "Q", "Q"], dict);
    assert.ok(!moves.some((m) => m.word === "SLUT"));
    assert.ok(moves.some((m) => m.word === "LUST"));
  });
  it("is fast even with two blanks", () => {
    const rng = W.makeRng("speed");
    const g = W.newGame({ rng, players: [{ name: "a", cpu: true }, { name: "b", cpu: true }] });
    for (let t = 0; t < 6; t++) {
      const m = W.chooseMove(W.generateMoves(g.board, g.players[g.turn].rack, dict), "hard", rng);
      if (m) W.playMove(g, m.placements, dict); else W.passTurn(g);
    }
    const t0 = Date.now();
    const moves = W.generateMoves(g.board, ["E", "R", "S", "T", "A", "?", "?"], dict);
    const ms = Date.now() - t0;
    assert.ok(moves.length > 1000);
    assert.ok(ms < 1500, "took " + ms + "ms");
  });
});

describe("computer levels", () => {
  const fake = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((s, k) => ({ score: s, word: k < 5 ? "CAT" : "LONGWORD", tiles: k < 5 ? 3 : 7, blanks: 0, placements: [] }));
  it("hard always takes the top score", () => {
    for (let k = 0; k < 20; k++) assert.equal(W.chooseMove(fake, "hard", Math.random).score, 100);
  });
  it("medium aims for a good but not best move", () => {
    const rng = W.makeRng(1);
    for (let k = 0; k < 50; k++) {
      const s = W.chooseMove(fake, "medium", rng).score;
      assert.ok(s >= 50 && s <= 90, String(s));
    }
  });
  it("easy prefers short words and low scores", () => {
    const rng = W.makeRng(2);
    for (let k = 0; k < 50; k++) {
      const m = W.chooseMove(fake, "easy", rng);
      assert.equal(m.word, "CAT");
      assert.ok(m.score <= 30);
    }
  });
  it("returns null with no moves, and swaps poor tiles", () => {
    assert.equal(W.chooseMove([], "hard"), null);
    const out = W.chooseExchange(["Q", "?", "S", "E", "E", "V", "V"]);
    assert.ok(!out.includes("?") && !out.includes("S"));
    assert.ok(out.includes("Q"));
    assert.equal(out.filter((t) => t === "E").length, 1);
  });
  it("easy, medium and hard rank in that order over real positions", () => {
    const rng = W.makeRng("levels");
    const totals = { easy: 0, medium: 0, hard: 0 };
    const g = W.newGame({ rng, players: [{ name: "a", cpu: true }, { name: "b", cpu: true }] });
    for (let t = 0; t < 10 && !g.over; t++) {
      const moves = W.generateMoves(g.board, g.players[g.turn].rack, dict);
      if (!moves.length) { W.passTurn(g); continue; }
      for (const l of W.LEVELS) totals[l] += W.chooseMove(moves, l, rng).score;
      W.playMove(g, W.chooseMove(moves, "medium", rng).placements, dict);
    }
    assert.ok(totals.easy < totals.medium && totals.medium < totals.hard, JSON.stringify(totals));
  });
});

describe("turns and game end", () => {
  it("a full computer-vs-computer game ends with correct totals", () => {
    const rng = W.makeRng("full");
    const g = W.newGame({ rng, players: [{ name: "a", cpu: true }, { name: "b", cpu: true }] });
    let turns = 0;
    while (!g.over && turns < 200) {
      const p = g.players[g.turn];
      const m = W.chooseMove(W.generateMoves(g.board, p.rack, dict), turns % 2 ? "hard" : "medium", rng);
      if (m) assert.ok(W.playMove(g, m.placements, dict).ok);
      else if (g.bag.length >= 7) W.exchangeTurn(g, W.chooseExchange(p.rack), rng);
      else W.passTurn(g);
      turns++;
    }
    assert.ok(g.over);
    const played = g.history.reduce((a, h) => { a[h.p] += h.score; return a; }, [0, 0]);
    g.players.forEach((p, i) => assert.equal(p.score, played[i] + g.result.adjust[i]));
    const onBoard = g.board.filter(Boolean).length;
    const inRacks = g.players.reduce((a, p) => a + p.rack.length, 0);
    assert.equal(onBoard + inRacks + g.bag.length, 100);
  });
  it("going out takes the other rack's value", () => {
    const g = W.newGame({ rng: W.makeRng(1) });
    g.bag = [];
    g.players[0].rack = ["C", "A", "T"];
    g.players[1].rack = ["Q", "Z"];
    const res = W.playMove(g, pl("CAT", 7, 6, true), small);
    assert.ok(res.ok);
    assert.ok(g.over);
    assert.deepEqual(g.result.adjust, [20, -20]);
    assert.equal(g.players[0].score, 10 + 20);
    assert.equal(g.players[1].score, -20);
    assert.deepEqual(g.result.winners, [0]);
  });
  it("six scoreless turns end the game and every rack counts against its owner", () => {
    const g = W.newGame({ rng: W.makeRng(2) });
    g.players[0].rack = ["Q"]; g.players[1].rack = ["A", "B"];
    for (let k = 0; k < 6; k++) { assert.ok(!g.over); W.passTurn(g); }
    assert.ok(g.over);
    assert.equal(g.result.reason, "scoreless");
    assert.deepEqual(g.result.adjust, [-10, -4]);
    assert.deepEqual(g.result.winners, [1]);
  });
  it("a play resets the scoreless count and turns alternate", () => {
    const g = W.newGame({ rng: W.makeRng(3) });
    W.passTurn(g);
    assert.equal(g.turn, 1);
    g.players[1].rack = ["C", "A", "T", "E", "E", "E", "E"];
    assert.ok(W.playMove(g, pl("CAT", 7, 6, true), small).ok);
    assert.equal(g.scoreless, 0);
    assert.equal(g.turn, 0);
    assert.equal(g.players[1].rack.length, 7);
    assert.deepEqual(g.lastMove, [111, 112, 113]);
  });
  it("won't play tiles the player doesn't have", () => {
    const g = W.newGame({ rng: W.makeRng(4) });
    g.players[0].rack = ["A", "A", "A", "A", "A", "A", "A"];
    assert.equal(W.playMove(g, pl("CAT", 7, 6, true), small).ok, false);
  });
  it("a blank on the board comes from the rack's ?", () => {
    const g = W.newGame({ rng: W.makeRng(5) });
    g.players[0].rack = ["?", "A", "T", "E", "E", "E", "E"];
    const res = W.playMove(g, [{ i: 111, l: "C", b: true }, { i: 112, l: "A", b: false }, { i: 113, l: "T", b: false }], small);
    assert.ok(res.ok);
    assert.equal(g.board[111].b, true);
    assert.equal(g.board[111].l, "C");
    assert.equal(g.players[0].rack.length, 7);
    assert.equal(g.players[0].score, (0 + 1 + 1) * 2);
  });
  it("unseen tiles are the bag plus the other rack", () => {
    const g = W.newGame({ rng: W.makeRng(6) });
    const u = W.unseenTiles(g, 0);
    assert.equal(u.length, 86 + 7);
    assert.deepEqual(u, g.bag.concat(g.players[1].rack).sort());
  });
});
