/**
 * Sudoku logic — pure functions, used by the page and by Node tests.
 *
 * Grids are arrays of 81 numbers (row-major), 0 = empty, 1–9 = digit.
 * Everything random goes through a seeded PRNG, so a seed always gives the
 * same puzzle in every browser (that is how the daily puzzle works).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SudokuLogic = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DIFFICULTIES = ["easy", "medium", "hard"];
  var ALL = 0x1ff; // bits 0..8 = digits 1..9

  // ---------- geometry ----------
  var ROW = [], COL = [], BOX = [], PEERS = [], UNITS = [];
  (function build() {
    var i, r, c, b;
    for (i = 0; i < 81; i++) {
      ROW[i] = Math.floor(i / 9);
      COL[i] = i % 9;
      BOX[i] = Math.floor(ROW[i] / 3) * 3 + Math.floor(COL[i] / 3);
    }
    for (r = 0; r < 9; r++) { var u = []; for (c = 0; c < 9; c++) u.push(r * 9 + c); UNITS.push(u); }
    for (c = 0; c < 9; c++) { var v = []; for (r = 0; r < 9; r++) v.push(r * 9 + c); UNITS.push(v); }
    for (b = 0; b < 9; b++) {
      var w = [], br = Math.floor(b / 3) * 3, bc = (b % 3) * 3;
      for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) w.push((br + r) * 9 + bc + c);
      UNITS.push(w);
    }
    for (i = 0; i < 81; i++) {
      var p = [];
      for (var j = 0; j < 81; j++) {
        if (j !== i && (ROW[j] === ROW[i] || COL[j] === COL[i] || BOX[j] === BOX[i])) p.push(j);
      }
      PEERS.push(p);
    }
  })();

  function bitCount(m) { var n = 0; while (m) { m &= m - 1; n++; } return n; }
  function bitDigit(m) { for (var d = 1; d <= 9; d++) if (m === 1 << (d - 1)) return d; return 0; }

  // ---------- seeded random ----------
  function hashString(str) {
    // FNV-1a 32-bit
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeRng(seed) {
    return mulberry32(typeof seed === "number" ? seed : hashString(String(seed)));
  }
  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- dates ----------
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  /** Local calendar date as YYYY-MM-DD (the daily puzzle key). */
  function localDateKey(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function dailySeed(dateKey, difficulty) {
    return "somo-sudoku|daily|" + dateKey + "|" + difficulty;
  }

  // ---------- validation ----------
  function isValidGridShape(g) {
    if (!g || g.length !== 81) return false;
    for (var i = 0; i < 81; i++) {
      var v = g[i];
      if (typeof v !== "number" || v !== Math.floor(v) || v < 0 || v > 9) return false;
    }
    return true;
  }
  /** Indices of filled cells that clash with another filled cell in a row, column or box. */
  function findConflicts(g) {
    var out = [];
    for (var i = 0; i < 81; i++) {
      if (!g[i]) continue;
      var p = PEERS[i];
      for (var k = 0; k < p.length; k++) {
        if (g[p[k]] === g[i]) { out.push(i); break; }
      }
    }
    return out;
  }
  function isComplete(g) {
    for (var i = 0; i < 81; i++) if (!g[i]) return false;
    return findConflicts(g).length === 0;
  }
  function isSolvedBy(g, solution) {
    for (var i = 0; i < 81; i++) if (g[i] !== solution[i]) return false;
    return true;
  }
  /** Which digits each empty cell could take, given the filled cells (bitmask array). */
  function candidates(g) {
    var cand = new Array(81);
    for (var i = 0; i < 81; i++) {
      if (g[i]) { cand[i] = 0; continue; }
      var m = ALL, p = PEERS[i];
      for (var k = 0; k < p.length; k++) if (g[p[k]]) m &= ~(1 << (g[p[k]] - 1));
      cand[i] = m;
    }
    return cand;
  }
  function candidateList(mask) {
    var out = [];
    for (var d = 1; d <= 9; d++) if (mask & (1 << (d - 1))) out.push(d);
    return out;
  }

  // ---------- backtracking solver ----------
  /**
   * Count solutions up to `limit` (default 2). Optional `rng` randomises the
   * digit order (used to build full grids). Returns { count, solution }.
   */
  function solve(grid, limit, rng) {
    limit = limit || 2;
    var g = grid.slice();
    var rows = new Int32Array(9), cols = new Int32Array(9), boxes = new Int32Array(9);
    for (var i = 0; i < 81; i++) {
      var v = g[i];
      if (!v) continue;
      var bit = 1 << (v - 1);
      if ((rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]) & bit) return { count: 0, solution: null };
      rows[ROW[i]] |= bit; cols[COL[i]] |= bit; boxes[BOX[i]] |= bit;
    }
    var count = 0, solution = null;
    var order = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    function rec() {
      // choose the empty cell with fewest candidates
      var best = -1, bestMask = 0, bestN = 10;
      for (var i = 0; i < 81; i++) {
        if (g[i]) continue;
        var m = ALL & ~(rows[ROW[i]] | cols[COL[i]] | boxes[BOX[i]]);
        var n = bitCount(m);
        if (n < bestN) { best = i; bestMask = m; bestN = n; if (n <= 1) break; }
      }
      if (best === -1) {
        count++;
        if (!solution) solution = g.slice();
        return count >= limit;
      }
      if (bestN === 0) return false;
      var digits = rng ? shuffle(order.slice(), rng) : order;
      for (var k = 0; k < 9; k++) {
        var d = digits[k], bit = 1 << (d - 1);
        if (!(bestMask & bit)) continue;
        g[best] = d;
        rows[ROW[best]] |= bit; cols[COL[best]] |= bit; boxes[BOX[best]] |= bit;
        if (rec()) return true;
        rows[ROW[best]] &= ~bit; cols[COL[best]] &= ~bit; boxes[BOX[best]] &= ~bit;
        g[best] = 0;
      }
      return false;
    }
    rec();
    return { count: count, solution: solution };
  }
  function countSolutions(grid, limit) { return solve(grid, limit || 2).count; }
  function hasUniqueSolution(grid) { return countSolutions(grid, 2) === 1; }

  function generateFullGrid(rng) {
    var empty = new Array(81).fill(0);
    return solve(empty, 1, rng).solution;
  }

  // ---------- human-style grader ----------
  /**
   * Solve using human techniques only. Returns { solved, level, steps } where
   * level is the hardest technique needed: 1 naked singles, 2 hidden singles,
   * 3 locked candidates / naked & hidden pairs. Not solved = needs more than that.
   */
  function gradeLogic(grid) {
    var g = grid.slice();
    var cand = candidates(g);
    var level = 0, steps = 0;

    function place(i, d) {
      g[i] = d; cand[i] = 0;
      var bit = ~(1 << (d - 1)), p = PEERS[i];
      for (var k = 0; k < p.length; k++) cand[p[k]] &= bit;
      steps++;
    }
    function nakedSingles() {
      var moved = false;
      for (var i = 0; i < 81; i++) {
        if (!g[i] && bitCount(cand[i]) === 1) { place(i, bitDigit(cand[i])); moved = true; }
      }
      return moved;
    }
    function hiddenSingles() {
      for (var u = 0; u < 27; u++) {
        var unit = UNITS[u];
        for (var d = 1; d <= 9; d++) {
          var bit = 1 << (d - 1), spot = -1, n = 0, placed = false;
          for (var k = 0; k < 9; k++) {
            var i = unit[k];
            if (g[i] === d) { placed = true; break; }
            if (cand[i] & bit) { n++; spot = i; }
          }
          if (!placed && n === 1) { place(spot, d); return true; }
        }
      }
      return false;
    }
    function lockedCandidates() {
      var changed = false;
      for (var b = 18; b < 27; b++) {
        var box = UNITS[b];
        for (var d = 1; d <= 9; d++) {
          var bit = 1 << (d - 1), rs = {}, cs = {}, nr = 0, nc = 0, any = false, rr = -1, cc = -1;
          for (var k = 0; k < 9; k++) {
            var i = box[k];
            if (cand[i] & bit) {
              any = true;
              if (!rs[ROW[i]]) { rs[ROW[i]] = 1; nr++; rr = ROW[i]; }
              if (!cs[COL[i]]) { cs[COL[i]] = 1; nc++; cc = COL[i]; }
            }
          }
          if (!any) continue;
          if (nr === 1) {
            for (var c = 0; c < 9; c++) {
              var j = rr * 9 + c;
              if (BOX[j] !== b - 18 && (cand[j] & bit)) { cand[j] &= ~bit; changed = true; }
            }
          }
          if (nc === 1) {
            for (var r = 0; r < 9; r++) {
              var j2 = r * 9 + cc;
              if (BOX[j2] !== b - 18 && (cand[j2] & bit)) { cand[j2] &= ~bit; changed = true; }
            }
          }
        }
      }
      // claiming: digit in a row/col confined to one box
      for (var u = 0; u < 18; u++) {
        var unit = UNITS[u];
        for (var d2 = 1; d2 <= 9; d2++) {
          var bit2 = 1 << (d2 - 1), bx = -1, ok = true, seen = false;
          for (var k2 = 0; k2 < 9; k2++) {
            var i2 = unit[k2];
            if (cand[i2] & bit2) {
              if (!seen) { bx = BOX[i2]; seen = true; } else if (BOX[i2] !== bx) { ok = false; break; }
            }
          }
          if (!seen || !ok) continue;
          var boxCells = UNITS[18 + bx];
          for (var k3 = 0; k3 < 9; k3++) {
            var j3 = boxCells[k3];
            if (unit.indexOf(j3) === -1 && (cand[j3] & bit2)) { cand[j3] &= ~bit2; changed = true; }
          }
        }
      }
      return changed;
    }
    function pairs() {
      var changed = false;
      for (var u = 0; u < 27; u++) {
        var unit = UNITS[u];
        // naked pairs
        for (var a = 0; a < 9; a++) {
          var ia = unit[a];
          if (g[ia] || bitCount(cand[ia]) !== 2) continue;
          for (var b2 = a + 1; b2 < 9; b2++) {
            var ib = unit[b2];
            if (g[ib] || cand[ib] !== cand[ia]) continue;
            for (var k = 0; k < 9; k++) {
              var j = unit[k];
              if (j !== ia && j !== ib && (cand[j] & cand[ia])) { cand[j] &= ~cand[ia]; changed = true; }
            }
          }
        }
        // hidden pairs
        var where = [];
        for (var d = 1; d <= 9; d++) {
          var bit = 1 << (d - 1), cells = [];
          for (var k4 = 0; k4 < 9; k4++) if (cand[unit[k4]] & bit) cells.push(unit[k4]);
          where[d] = cells;
        }
        for (var d1 = 1; d1 <= 9; d1++) {
          if (where[d1].length !== 2) continue;
          for (var d3 = d1 + 1; d3 <= 9; d3++) {
            if (where[d3].length !== 2) continue;
            if (where[d3][0] !== where[d1][0] || where[d3][1] !== where[d1][1]) continue;
            var keep = (1 << (d1 - 1)) | (1 << (d3 - 1));
            for (var q = 0; q < 2; q++) {
              var cell = where[d1][q];
              if (cand[cell] & ~keep) { cand[cell] &= keep; changed = true; }
            }
          }
        }
      }
      return changed;
    }

    for (var guard = 0; guard < 2000; guard++) {
      if (nakedSingles()) { level = Math.max(level, 1); continue; }
      if (hiddenSingles()) { level = Math.max(level, 2); continue; }
      if (lockedCandidates() || pairs()) { level = Math.max(level, 3); continue; }
      break;
    }
    var solved = g.indexOf(0) === -1 && findConflicts(g).length === 0;
    return { solved: solved, level: solved ? Math.max(level, 1) : 0, steps: steps };
  }

  // ---------- generator ----------
  var PROFILES = {
    // clue range to aim for, and the allowed human-technique levels
    easy: { minClues: 36, maxClues: 40, levels: [1, 2] },
    medium: { minClues: 28, maxClues: 32, levels: [2] },
    hard: { minClues: 22, maxClues: 27, levels: [3] },
  };

  function carve(solution, rng, targetClues) {
    var puzzle = solution.slice();
    var clues = 81;
    var order = [];
    for (var i = 0; i <= 40; i++) order.push(i);
    shuffle(order, rng);
    for (var k = 0; k < order.length && clues > targetClues; k++) {
      var a = order[k], b = 80 - a; // symmetric pairs (centre cell alone)
      var saveA = puzzle[a], saveB = puzzle[b];
      puzzle[a] = 0; puzzle[b] = 0;
      if (hasUniqueSolution(puzzle)) {
        clues -= a === b ? 1 : 2;
      } else {
        puzzle[a] = saveA; puzzle[b] = saveB;
      }
    }
    return puzzle;
  }
  function clueCount(g) { var n = 0; for (var i = 0; i < 81; i++) if (g[i]) n++; return n; }

  /**
   * Make a puzzle with exactly one solution. Deterministic for a given seed.
   * Returns { puzzle, solution, difficulty, clues, level, seed, attempts }.
   */
  var MAX_ATTEMPTS = 120;

  function generate(difficulty, seed) {
    if (DIFFICULTIES.indexOf(difficulty) === -1) throw new Error("Unknown difficulty: " + difficulty);
    var rng = makeRng(seed);
    var prof = PROFILES[difficulty];
    var fallback = null;
    for (var attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      var solution = generateFullGrid(rng);
      var target = prof.minClues + Math.floor(rng() * (prof.maxClues - prof.minClues + 1));
      var puzzle = carve(solution, rng, target);
      var clues = clueCount(puzzle);
      var grade = gradeLogic(puzzle);
      var result = { puzzle: puzzle, solution: solution, difficulty: difficulty, clues: clues,
        level: grade.level, seed: String(seed), attempts: attempt };
      var inRange = clues >= prof.minClues && clues <= prof.maxClues;
      if (grade.solved && prof.levels.indexOf(grade.level) !== -1 && inRange) return result;
      // keep a reasonable fallback: logically solvable and inside the clue range
      if (grade.solved && inRange && !fallback) fallback = result;
    }
    if (fallback) return fallback;
    return result; // still unique, just graded outside the profile
  }

  function dailyPuzzle(dateKey, difficulty) {
    return generate(difficulty, dailySeed(dateKey, difficulty));
  }

  // ---------- puzzle ids & helpers for the UI ----------
  function puzzleId(mode, difficulty, key) {
    return mode + ":" + difficulty + ":" + key;
  }
  function gridToString(g) {
    var s = "";
    for (var i = 0; i < 81; i++) s += g[i] ? String(g[i]) : ".";
    return s;
  }
  function stringToGrid(s) {
    if (typeof s !== "string" || s.length !== 81) return null;
    var g = [];
    for (var i = 0; i < 81; i++) {
      var ch = s.charAt(i);
      if (ch === "." || ch === "0") g.push(0);
      else if (ch >= "1" && ch <= "9") g.push(Number(ch));
      else return null;
    }
    return g;
  }
  function formatTime(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds || 0));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return (h ? h + ":" + pad2(m) : String(m)) + ":" + pad2(sec);
  }
  /** Digits 1–9 → how many are still to place (9 minus correct-or-not placed count). */
  function remainingCounts(g) {
    var out = [0, 9, 9, 9, 9, 9, 9, 9, 9, 9];
    for (var i = 0; i < 81; i++) if (g[i]) out[g[i]]--;
    return out;
  }
  /** Pick which cell a hint should fill: the selected cell if it is empty or wrong, else a random empty/wrong one. */
  function pickHintCell(values, solution, selected, rng) {
    if (selected != null && selected >= 0 && values[selected] !== solution[selected]) return selected;
    var open = [];
    for (var i = 0; i < 81; i++) if (values[i] !== solution[i]) open.push(i);
    if (!open.length) return -1;
    return open[Math.floor((rng ? rng() : Math.random()) * open.length)];
  }
  /** Update best-time stats after a solve. Hinted solves count as solved but not as a best time. */
  function recordSolve(stats, difficulty, seconds, hintsUsed) {
    var s = stats && typeof stats === "object" ? JSON.parse(JSON.stringify(stats)) : {};
    var d = s[difficulty] || { solved: 0, best: null };
    d.solved = (d.solved || 0) + 1;
    var isBest = false;
    if (!hintsUsed && (d.best == null || seconds < d.best)) { d.best = seconds; isBest = true; }
    s[difficulty] = d;
    return { stats: s, isBest: isBest };
  }

  return {
    DIFFICULTIES: DIFFICULTIES,
    PROFILES: PROFILES,
    ROW: ROW, COL: COL, BOX: BOX, PEERS: PEERS, UNITS: UNITS,
    hashString: hashString,
    makeRng: makeRng,
    shuffle: shuffle,
    localDateKey: localDateKey,
    dailySeed: dailySeed,
    isValidGridShape: isValidGridShape,
    findConflicts: findConflicts,
    isComplete: isComplete,
    isSolvedBy: isSolvedBy,
    candidates: candidates,
    candidateList: candidateList,
    solve: solve,
    countSolutions: countSolutions,
    hasUniqueSolution: hasUniqueSolution,
    generateFullGrid: generateFullGrid,
    gradeLogic: gradeLogic,
    clueCount: clueCount,
    generate: generate,
    dailyPuzzle: dailyPuzzle,
    puzzleId: puzzleId,
    gridToString: gridToString,
    stringToGrid: stringToGrid,
    formatTime: formatTime,
    remainingCounts: remainingCounts,
    pickHintCell: pickHintCell,
    recordSolve: recordSolve,
  };
});
