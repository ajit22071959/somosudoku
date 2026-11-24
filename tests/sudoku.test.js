"use strict";
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../games/sudoku/sudoku.js");

// A well-known puzzle with a unique solution.
const KNOWN = "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
const KNOWN_SOLUTION = "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

function isValidSolution(g) {
  if (g.length !== 81 || g.indexOf(0) !== -1) return false;
  return S.UNITS.every((u) => new Set(u.map((i) => g[i])).size === 9);
}

describe("geometry", () => {
  it("has 27 units of 9 cells and 20 peers per cell", () => {
    assert.equal(S.UNITS.length, 27);
    S.UNITS.forEach((u) => assert.equal(u.length, 9));
    S.PEERS.forEach((p) => assert.equal(p.length, 20));
  });
  it("maps rows, columns and boxes", () => {
    assert.equal(S.ROW[80], 8);
    assert.equal(S.COL[80], 8);
    assert.equal(S.BOX[0], 0);
    assert.equal(S.BOX[40], 4);
    assert.equal(S.BOX[80], 8);
    assert.equal(S.BOX[30], 4); // row 3, col 3
  });
});

describe("seeding", () => {
  it("hashString is stable and 32-bit", () => {
    assert.equal(S.hashString("abc"), S.hashString("abc"));
    assert.notEqual(S.hashString("abc"), S.hashString("abd"));
    assert.ok(S.hashString("x") >= 0 && S.hashString("x") < 2 ** 32);
  });
  it("makeRng gives the same sequence for the same seed", () => {
    const a = S.makeRng("seed"), b = S.makeRng("seed"), c = S.makeRng("other");
    const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
    assert.deepEqual(sa, sb);
    assert.notDeepEqual(sa, sc);
    sa.forEach((x) => assert.ok(x >= 0 && x < 1));
  });
  it("localDateKey uses the local calendar date", () => {
    assert.equal(S.localDateKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
    assert.equal(S.localDateKey(new Date(2026, 10, 25, 0, 1)), "2026-11-25");
  });
  it("dailySeed differs by date and difficulty", () => {
    assert.notEqual(S.dailySeed("2026-11-25", "easy"), S.dailySeed("2026-11-25", "hard"));
    assert.notEqual(S.dailySeed("2026-11-25", "easy"), S.dailySeed("2026-11-26", "easy"));
  });
  it("shuffle is a permutation", () => {
    const arr = S.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], S.makeRng(1));
    assert.deepEqual(arr.slice().sort(), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe("parsing and validation", () => {
  it("round-trips grid strings", () => {
    const g = S.stringToGrid(KNOWN);
    assert.equal(g.length, 81);
    assert.equal(S.gridToString(g), KNOWN);
    assert.deepEqual(S.stringToGrid(KNOWN.replace(/\./g, "0")), g);
  });
  it("rejects bad strings", () => {
    assert.equal(S.stringToGrid("123"), null);
    assert.equal(S.stringToGrid("x".repeat(81)), null);
    assert.equal(S.stringToGrid(null), null);
  });
  it("isValidGridShape", () => {
    assert.ok(S.isValidGridShape(S.stringToGrid(KNOWN)));
    assert.ok(!S.isValidGridShape([1, 2]));
    assert.ok(!S.isValidGridShape(new Array(81).fill(10)));
    assert.ok(!S.isValidGridShape(new Array(81).fill(1.5)));
  });
  it("findConflicts flags clashes in a row, column and box", () => {
    const g = new Array(81).fill(0);
    g[0] = 5; g[8] = 5; // row
    assert.deepEqual(S.findConflicts(g), [0, 8]);
    const h = new Array(81).fill(0);
    h[0] = 3; h[72] = 3; // column
    assert.deepEqual(S.findConflicts(h), [0, 72]);
    const k = new Array(81).fill(0);
    k[0] = 7; k[20] = 7; // box (row 2, col 2)
    assert.deepEqual(S.findConflicts(k), [0, 20]);
    assert.deepEqual(S.findConflicts(S.stringToGrid(KNOWN)), []);
  });
  it("isComplete and isSolvedBy", () => {
    const sol = S.stringToGrid(KNOWN_SOLUTION);
    assert.ok(S.isComplete(sol));
    assert.ok(!S.isComplete(S.stringToGrid(KNOWN)));
    assert.ok(S.isSolvedBy(sol.slice(), sol));
    const wrong = sol.slice(); [wrong[0], wrong[1]] = [wrong[1], wrong[0]];
    assert.ok(!S.isSolvedBy(wrong, sol));
    assert.ok(!S.isComplete(wrong));
  });
  it("candidates exclude digits seen by peers", () => {
    const g = S.stringToGrid(KNOWN);
    const c = S.candidates(g);
    assert.equal(c[0], 0); // filled
    assert.deepEqual(S.candidateList(c[2]), [1, 2, 4]); // r1c3
  });
});

describe("solver", () => {
  it("solves a known puzzle", () => {
    const r = S.solve(S.stringToGrid(KNOWN), 2);
    assert.equal(r.count, 1);
    assert.equal(S.gridToString(r.solution), KNOWN_SOLUTION);
  });
  it("detects multiple solutions", () => {
    assert.equal(S.countSolutions(new Array(81).fill(0), 2), 2);
    const g = S.stringToGrid(KNOWN);
    g[0] = 0; g[1] = 0; g[4] = 0; g[9] = 0; g[10] = 0; g[13] = 0; g[14] = 0;
    // removing clues may or may not keep uniqueness; the counter must agree with an exhaustive limit
    const c2 = S.countSolutions(g, 2), c10 = S.countSolutions(g, 10);
    assert.equal(c2, Math.min(c10, 2));
  });
  it("returns zero for contradictory grids", () => {
    const g = S.stringToGrid(KNOWN);
    g[2] = 5; // 5 already in row
    assert.equal(S.countSolutions(g), 0);
  });
  it("finds no solution when a cell has no candidates", () => {
    const g = new Array(81).fill(0);
    for (let c = 0; c < 8; c++) g[c] = c + 1; // row 1: 1..8
    g[17] = 9; // 9 in r2c9 box 3 -> r1c9 can only be 9 but 9 in same box
    assert.equal(S.countSolutions(g), 0);
  });
  it("hasUniqueSolution", () => {
    assert.ok(S.hasUniqueSolution(S.stringToGrid(KNOWN)));
    assert.ok(!S.hasUniqueSolution(new Array(81).fill(0)));
  });
  it("generateFullGrid gives valid, seed-stable grids", () => {
    const a = S.generateFullGrid(S.makeRng("g1"));
    const b = S.generateFullGrid(S.makeRng("g1"));
    const c = S.generateFullGrid(S.makeRng("g2"));
    assert.ok(isValidSolution(a));
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });
});

describe("grader", () => {
  it("grades the known puzzle as singles-solvable", () => {
    const r = S.gradeLogic(S.stringToGrid(KNOWN));
    assert.ok(r.solved);
    assert.ok(r.level >= 1 && r.level <= 2);
  });
  it("cannot solve an empty grid logically", () => {
    assert.equal(S.gradeLogic(new Array(81).fill(0)).solved, false);
  });
  it("a solved grid is level 1 with no steps", () => {
    const r = S.gradeLogic(S.stringToGrid(KNOWN_SOLUTION));
    assert.ok(r.solved);
    assert.equal(r.steps, 0);
  });
});

describe("generator", () => {
  for (const d of S.DIFFICULTIES) {
    it(`${d}: 12 seeds give unique, consistent puzzles in the clue range`, () => {
      const prof = S.PROFILES[d];
      for (let k = 0; k < 12; k++) {
        const r = S.generate(d, `test-${d}-${k}`);
        assert.ok(isValidSolution(r.solution), "solution valid");
        assert.ok(S.hasUniqueSolution(r.puzzle), "unique");
        const solved = S.solve(r.puzzle, 2);
        assert.deepEqual(solved.solution, r.solution, "solution matches");
        for (let i = 0; i < 81; i++) if (r.puzzle[i]) assert.equal(r.puzzle[i], r.solution[i]);
        assert.equal(r.clues, S.clueCount(r.puzzle));
        assert.ok(r.clues >= prof.minClues && r.clues <= prof.maxClues, `${d} clues ${r.clues}`);
        const g = S.gradeLogic(r.puzzle);
        assert.ok(g.solved, "solvable by the human techniques the grader knows");
        assert.ok(prof.levels.includes(g.level), `${d} level ${g.level}`);
      }
    });
  }
  it("is deterministic for a seed", () => {
    const a = S.generate("medium", "same"), b = S.generate("medium", "same");
    assert.deepEqual(a.puzzle, b.puzzle);
    assert.deepEqual(a.solution, b.solution);
  });
  it("puzzles are rotationally symmetric", () => {
    const r = S.generate("easy", "sym");
    for (let i = 0; i < 81; i++) assert.equal(!!r.puzzle[i], !!r.puzzle[80 - i]);
  });
  it("difficulties get fewer clues as they get harder (on average)", () => {
    const avg = (d) => { let t = 0; for (let k = 0; k < 6; k++) t += S.generate(d, "avg" + k).clues; return t / 6; };
    const e = avg("easy"), m = avg("medium"), h = avg("hard");
    assert.ok(e > m && m > h, `${e} > ${m} > ${h}`);
  });
  it("rejects unknown difficulty", () => {
    assert.throws(() => S.generate("expert", 1), /Unknown difficulty/);
  });
  it("is fast: every difficulty under 250ms worst case over 25 seeds (phones are ~4x slower)", () => {
    for (const d of S.DIFFICULTIES) {
      let worst = 0;
      for (let k = 0; k < 25; k++) {
        const t = process.hrtime.bigint();
        S.generate(d, `speed-${d}-${k}`);
        worst = Math.max(worst, Number(process.hrtime.bigint() - t) / 1e6);
      }
      assert.ok(worst < 250, `${d} worst ${worst.toFixed(1)}ms`);
    }
  });
});

describe("daily puzzle", () => {
  it("is the same for everyone on a date and differs by difficulty and day", () => {
    const a = S.dailyPuzzle("2026-11-25", "easy");
    const b = S.dailyPuzzle("2026-11-25", "easy");
    const c = S.dailyPuzzle("2026-11-25", "hard");
    const d = S.dailyPuzzle("2026-11-26", "easy");
    assert.deepEqual(a.puzzle, b.puzzle);
    assert.notDeepEqual(a.puzzle, c.puzzle);
    assert.notDeepEqual(a.puzzle, d.puzzle);
    assert.equal(a.difficulty, "easy");
  });
  it("is pinned: a fixed date always gives the same grid (guards against accidental algorithm changes)", () => {
    const a = S.dailyPuzzle("2026-01-01", "medium");
    assert.equal(S.gridToString(a.puzzle).length, 81);
    // generated once and copied here; changing the generator changes everyone's daily puzzle
    assert.equal(S.gridToString(a.puzzle), PINNED_2026_01_01_MEDIUM);
  });
});

describe("UI helpers", () => {
  it("puzzleId", () => {
    assert.equal(S.puzzleId("daily", "easy", "2026-11-25"), "daily:easy:2026-11-25");
  });
  it("formatTime", () => {
    assert.equal(S.formatTime(0), "0:00");
    assert.equal(S.formatTime(65), "1:05");
    assert.equal(S.formatTime(3599), "59:59");
    assert.equal(S.formatTime(3725), "1:02:05");
    assert.equal(S.formatTime(-3), "0:00");
  });
  it("remainingCounts", () => {
    const left = S.remainingCounts(S.stringToGrid(KNOWN_SOLUTION));
    for (let d = 1; d <= 9; d++) assert.equal(left[d], 0);
    const l2 = S.remainingCounts(new Array(81).fill(0));
    assert.equal(l2[5], 9);
  });
  it("pickHintCell prefers the selected wrong/empty cell", () => {
    const sol = S.stringToGrid(KNOWN_SOLUTION);
    const vals = S.stringToGrid(KNOWN);
    assert.equal(S.pickHintCell(vals, sol, 2), 2);
    const i = S.pickHintCell(vals, sol, 0, S.makeRng(3)); // r1c1 is given & correct
    assert.notEqual(i, 0);
    assert.equal(vals[i], 0);
    assert.equal(S.pickHintCell(sol.slice(), sol, 5), -1);
    const wrong = sol.slice(); wrong[10] = wrong[10] === 1 ? 2 : 1;
    assert.equal(S.pickHintCell(wrong, sol, 0, S.makeRng(1)), 10);
  });
  it("recordSolve counts solves and best times, ignoring hinted solves for best", () => {
    let r = S.recordSolve({}, "easy", 300, false);
    assert.deepEqual(r.stats.easy, { solved: 1, best: 300 });
    assert.ok(r.isBest);
    r = S.recordSolve(r.stats, "easy", 200, true);
    assert.deepEqual(r.stats.easy, { solved: 2, best: 300 });
    assert.ok(!r.isBest);
    r = S.recordSolve(r.stats, "easy", 250, false);
    assert.equal(r.stats.easy.best, 250);
    assert.ok(r.isBest);
    const before = { hard: { solved: 1, best: 100 } };
    S.recordSolve(before, "hard", 50, false);
    assert.equal(before.hard.best, 100, "does not mutate input");
  });
});

const PINNED_2026_01_01_MEDIUM = "6591....3.14...26....36......3...94....8.3....28...3......71....61...78.2....9154";
