/**
 * Letterfield logic — pure functions shared by the page, the AI worker and Node tests.
 *
 * Board: array of 225 cells (15 x 15, row-major). Each cell is null or {l: "A".."Z", b: bool}
 * where b marks a blank tile standing in for that letter (worth 0 points).
 * Rack: array of tile strings, "A".."Z" or "?" for a blank.
 * A placement: {i: cellIndex, l: "A".."Z", b: bool}.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WordLogic = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var N = 15, SIZE = 225, CENTER = 112, RACK_SIZE = 7, BINGO = 50, BLANK = "?";
  var A = 65;

  // ---------- tiles ----------
  // Standard English letter mix (100 tiles) and point values.
  var DISTRIBUTION = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
    N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1, "?": 2,
  };
  var VALUES = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
    N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10, "?": 0,
  };
  var VAL = []; // by letter code 0..25
  for (var k = 0; k < 26; k++) VAL[k] = VALUES[String.fromCharCode(A + k)];

  function tileValue(t) { return VALUES[t] || 0; }
  function cellValue(cell) { return cell.b ? 0 : VALUES[cell.l]; }
  function rackValue(rack) { var s = 0; for (var i = 0; i < rack.length; i++) s += tileValue(rack[i]); return s; }

  // ---------- premium squares ----------
  // Letterfield's own layout (not the classic one): defined for one eighth of the board
  // (row <= col <= 7) and mirrored, so it is symmetric across both axes and both diagonals.
  var OCTANT = {
    "0,0": "DL", "0,3": "TW", "0,7": "DL",
    "1,1": "DW", "1,5": "TL",
    "2,2": "DW", "2,6": "DL",
    "3,3": "DW", "3,7": "DW",
    "4,4": "TL",
    "5,5": "DL", "6,6": "DL",
    "7,7": "ST", // the start square, worth double word
  };
  var PREMIUM = new Array(SIZE);
  (function build() {
    for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
      var rr = r > 7 ? 14 - r : r, cc = c > 7 ? 14 - c : c;
      var a = Math.min(rr, cc), b = Math.max(rr, cc);
      PREMIUM[r * N + c] = OCTANT[a + "," + b] || "";
    }
  })();
  function letterMult(i) { var p = PREMIUM[i]; return p === "DL" ? 2 : p === "TL" ? 3 : 1; }
  function wordMult(i) { var p = PREMIUM[i]; return p === "DW" || p === "ST" ? 2 : p === "TW" ? 3 : 1; }
  var LM = [], WM = [];
  for (var q = 0; q < SIZE; q++) { LM[q] = letterMult(q); WM[q] = wordMult(q); }

  // ---------- randomness ----------
  function hashString(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function makeRng(seed) {
    var a = typeof seed === "number" ? seed >>> 0 : hashString(String(seed));
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rng) {
    rng = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  // ---------- bag ----------
  function makeBag(rng) {
    var bag = [];
    Object.keys(DISTRIBUTION).forEach(function (t) { for (var n = 0; n < DISTRIBUTION[t]; n++) bag.push(t); });
    return shuffle(bag, rng);
  }
  /** Draw up to n tiles from the end of the bag (mutates bag). */
  function draw(bag, n) {
    var out = [];
    while (n-- > 0 && bag.length) out.push(bag.pop());
    return out;
  }
  function refill(rack, bag) {
    var need = RACK_SIZE - rack.length;
    return rack.concat(draw(bag, need));
  }
  /** Remove tiles (by value) from a rack copy. Returns null if the rack lacks one. */
  function removeFromRack(rack, tiles) {
    var r = rack.slice();
    for (var i = 0; i < tiles.length; i++) {
      var at = r.indexOf(tiles[i]);
      if (at < 0) return null;
      r.splice(at, 1);
    }
    return r;
  }
  /** Swap tiles with the bag. Needs at least 7 tiles in the bag. Mutates bag. */
  function exchange(rack, bag, tiles, rng) {
    if (!tiles.length) return { ok: false, error: "Pick at least one tile to swap." };
    if (bag.length < RACK_SIZE) return { ok: false, error: "You can only swap while 7 or more tiles are left in the bag." };
    var rest = removeFromRack(rack, tiles);
    if (!rest) return { ok: false, error: "Those tiles aren't on the rack." };
    var fresh = draw(bag, tiles.length);
    for (var i = 0; i < tiles.length; i++) bag.push(tiles[i]);
    shuffle(bag, rng);
    return { ok: true, rack: rest.concat(fresh) };
  }

  // ---------- dictionary (trie in typed arrays) ----------
  // Node 0 is the root. letter: code 0..25; term: 0 = not a word, 1 = word, 2 = word the
  // computer won't play (still valid for people). Children are a first-child / next-sibling list.
  function buildTrie(text, skipText) {
    var words = Array.isArray(text) ? text : String(text).split(/\r?\n/);
    var cap = 1;
    for (var w = 0; w < words.length; w++) cap += words[w].length;
    var letter = new Uint8Array(cap), term = new Uint8Array(cap);
    var first = new Int32Array(cap).fill(-1), next = new Int32Array(cap).fill(-1);
    var count = 1;
    function insert(word, mark) {
      var node = 0;
      for (var i = 0; i < word.length; i++) {
        var ch = word.charCodeAt(i);
        ch = (ch >= 97 ? ch - 97 : ch - 65);
        if (ch < 0 || ch > 25) return;
        var c = first[node], prev = -1;
        while (c !== -1 && letter[c] < ch) { prev = c; c = next[c]; }
        if (c === -1 || letter[c] !== ch) {
          if (count >= cap) return; // only reachable for skip words not in the list
          var n = count++;
          letter[n] = ch; next[n] = c;
          if (prev === -1) first[node] = n; else next[prev] = n;
          c = n;
        }
        node = c;
      }
      if (mark === 2) { if (term[node]) term[node] = 2; } else term[node] = 1;
    }
    for (w = 0; w < words.length; w++) { var s = words[w].trim(); if (s.length >= 2) insert(s, 1); }
    if (skipText) String(skipText).split(/\r?\n/).forEach(function (s) { s = s.trim(); if (s) insert(s, 2); });
    return trieFromArrays({
      letter: letter.slice(0, count), term: term.slice(0, count),
      first: first.slice(0, count), next: next.slice(0, count), size: count,
    });
  }
  /** Wrap raw arrays (for example ones sent from a worker) in the trie API. */
  function trieFromArrays(t) {
    var letter = t.letter, term = t.term, first = t.first, next = t.next;
    function child(node, ch) {
      var c = first[node];
      while (c !== -1 && letter[c] < ch) c = next[c];
      return c !== -1 && letter[c] === ch ? c : -1;
    }
    function walk(word, node) {
      node = node || 0;
      for (var i = 0; i < word.length && node !== -1; i++) node = child(node, word.charCodeAt(i) - 65);
      return node;
    }
    function has(word) {
      var n = walk(String(word).toUpperCase(), 0);
      return n > 0 && term[n] > 0;
    }
    return { letter: letter, term: term, first: first, next: next, size: t.size || letter.length,
      child: child, walk: walk, has: has };
  }

  // ---------- board helpers ----------
  function emptyBoard() { var b = new Array(SIZE); for (var i = 0; i < SIZE; i++) b[i] = null; return b; }
  function isEmptyBoard(board) { for (var i = 0; i < SIZE; i++) if (board[i]) return false; return true; }
  function rc(i) { return [Math.floor(i / N), i % N]; }
  function applyPlacements(board, placements) {
    var b = board.slice();
    placements.forEach(function (p) { b[p.i] = { l: p.l, b: !!p.b }; });
    return b;
  }

  /** Read the word through cell i in a direction (dr,dc) on a board with the new tiles applied. */
  function wordThrough(b, i, horiz, newSet) {
    var r = Math.floor(i / N), c = i % N;
    var step = horiz ? 1 : N;
    var start = i;
    while (true) {
      var pr = horiz ? (start % N) - 1 : Math.floor(start / N) - 1;
      if (pr < 0 || !b[start - step]) break;
      start -= step;
    }
    var cells = [], word = "", sum = 0, wm = 1, cur = start;
    while (true) {
      var cell = b[cur];
      cells.push(cur);
      word += cell.l;
      var v = cellValue(cell);
      if (newSet[cur]) { sum += v * LM[cur]; wm *= WM[cur]; } else sum += v;
      var nx = horiz ? (cur % N) + 1 : Math.floor(cur / N) + 1;
      if (nx >= N || !b[cur + step]) break;
      cur += step;
    }
    void r; void c;
    return { word: word, cells: cells, score: sum * wm, horiz: horiz };
  }

  /**
   * Check a move and score it. dict: object with has(word). Returns
   * {ok, error, words: [{word, cells, score}], score, bingo, invalid: [words]}.
   * Scoring and shape are reported even when some words aren't in the dictionary,
   * so the page can preview them.
   */
  function evaluateMove(board, placements, dict) {
    var fail = function (msg) { return { ok: false, error: msg, words: [], score: 0, invalid: [] }; };
    if (!placements || !placements.length) return fail("Place some tiles first.");
    var seen = {};
    for (var p = 0; p < placements.length; p++) {
      var pl = placements[p];
      if (pl.i < 0 || pl.i >= SIZE) return fail("That square is off the board.");
      if (board[pl.i]) return fail("That square is already taken.");
      if (seen[pl.i]) return fail("Two tiles on one square.");
      if (!/^[A-Z]$/.test(pl.l)) return fail("Choose a letter for the blank tile.");
      seen[pl.i] = true;
    }
    var rows = {}, cols = {};
    placements.forEach(function (x) { rows[Math.floor(x.i / N)] = 1; cols[x.i % N] = 1; });
    var oneRow = Object.keys(rows).length === 1, oneCol = Object.keys(cols).length === 1;
    if (!oneRow && !oneCol) return fail("Tiles must be in one row or one column.");
    var b = applyPlacements(board, placements);
    var first = isEmptyBoard(board);
    var idxs = placements.map(function (x) { return x.i; }).sort(function (a, z) { return a - z; });
    var horiz;
    if (placements.length > 1) horiz = oneRow;
    else {
      var i0 = idxs[0], c0 = i0 % N;
      horiz = (c0 > 0 && !!b[i0 - 1]) || (c0 < N - 1 && !!b[i0 + 1]);
    }
    // contiguous: every square between first and last must be filled
    var step = horiz ? 1 : N;
    for (var s = idxs[0]; s <= idxs[idxs.length - 1]; s += step) if (!b[s]) return fail("Tiles must form one unbroken line.");
    if (first) {
      if (!seen[CENTER]) return fail("The first word must cover the centre star.");
      if (placements.length < 2) return fail("The first word needs at least two letters.");
    } else {
      var touches = false;
      for (var t = 0; t < idxs.length && !touches; t++) {
        var ii = idxs[t], cc = ii % N;
        if ((cc > 0 && board[ii - 1]) || (cc < N - 1 && board[ii + 1]) || (ii >= N && board[ii - N]) || (ii < SIZE - N && board[ii + N])) touches = true;
      }
      if (!touches) return fail("New tiles must connect to tiles already on the board.");
    }
    var words = [];
    var main = wordThrough(b, idxs[0], horiz, seen);
    if (main.word.length >= 2) words.push(main);
    for (var m = 0; m < idxs.length; m++) {
      var cross = wordThrough(b, idxs[m], !horiz, seen);
      if (cross.word.length >= 2) words.push(cross);
    }
    if (!words.length) return fail("Make a word of at least two letters.");
    var bingo = placements.length === RACK_SIZE;
    var score = words.reduce(function (a, w) { return a + w.score; }, 0) + (bingo ? BINGO : 0);
    var invalid = dict ? words.filter(function (w) { return !dict.has(w.word); }).map(function (w) { return w.word; }) : [];
    var res = { ok: invalid.length === 0, words: words, score: score, bingo: bingo, invalid: invalid, horiz: horiz };
    if (invalid.length) res.error = (invalid.length === 1 ? "Not in the word list: " : "Not in the word list: ") + invalid.join(", ");
    return res;
  }

  // ---------- move generation (for the computer) ----------
  var ALL = (1 << 26) - 1;

  /**
   * Every legal move for a rack, as [{placements, word, score, tiles, horiz, blanks}].
   * Uses anchor squares and cross-checks over the trie (the classic Appel & Jacobson method).
   * Only words marked 1 in the trie count, so the computer skips words in the skip list.
   */
  function generateMoves(board, rack, trie, opts) {
    opts = opts || {};
    var counts = new Int32Array(27);
    for (var i = 0; i < rack.length; i++) {
      if (rack[i] === BLANK) counts[26]++; else counts[rack[i].charCodeAt(0) - A]++;
    }
    var moves = [];
    var empty = isEmptyBoard(board);
    var firstArr = trie.first, nextArr = trie.next, letterArr = trie.letter, termArr = trie.term;
    var child = trie.child;
    var maxMoves = opts.maxMoves || 400000;

    for (var dir = 0; dir < 2; dir++) {
      var horiz = dir === 0;
      // g: letter codes (+1, 0 = empty) laid out so the move always runs along a "row".
      var g = new Int8Array(SIZE), gb = new Uint8Array(SIZE), map = new Int32Array(SIZE);
      for (var r = 0; r < N; r++) for (var c = 0; c < N; c++) {
        var src = horiz ? r * N + c : c * N + r; // transposed for vertical moves
        var cell = board[src];
        var j = r * N + c;
        map[j] = src;
        if (cell) { g[j] = cell.l.charCodeAt(0) - A + 1; gb[j] = cell.b ? 1 : 0; }
      }
      for (var row = 0; row < N; row++) genRow(row, horiz, g, gb, map);
      if (moves.length >= maxMoves) break;
    }
    return moves;

    function gval(g, gb, j) { return gb[j] ? 0 : VAL[g[j] - 1]; }

    function genRow(row, horiz, g, gb, map) {
      var base = row * N;
      var cross = new Int32Array(N), crossScore = new Int32Array(N), anchor = new Uint8Array(N);
      for (var c = 0; c < N; c++) {
        var j = base + c;
        crossScore[c] = -1;
        if (g[j]) continue;
        var up = row > 0 && g[j - N], down = row < N - 1 && g[j + N];
        var left = c > 0 && g[j - 1], right = c < N - 1 && g[j + 1];
        if (up || down || left || right || (empty && map[j] === CENTER)) anchor[c] = 1;
        if (!up && !down) { cross[c] = ALL; continue; }
        // perpendicular word: tiles above + ? + tiles below
        var top = j; while (top - N >= 0 && g[top - N]) top -= N;
        var node = 0, sc = 0;
        for (var t = top; t < j && node !== -1; t += N) { node = child(node, g[t] - 1); sc += gval(g, gb, t); }
        var bot = j + N, belowEnd = j;
        while (bot < SIZE && g[bot]) { sc += gval(g, gb, bot); belowEnd = bot; bot += N; }
        var mask = 0;
        if (node !== -1) {
          for (var ch = firstArr[node]; ch !== -1; ch = nextArr[ch]) {
            var n2 = ch;
            for (var t2 = j + N; t2 <= belowEnd && n2 !== -1; t2 += N) n2 = child(n2, g[t2] - 1);
            if (n2 !== -1 && termArr[n2] === 1) mask |= 1 << letterArr[ch];
          }
        }
        cross[c] = mask; crossScore[c] = sc;
      }

      var wl = new Int8Array(N + 1), wb = new Uint8Array(N + 1); // word being built (letters, blank flags)
      var wnew = new Uint8Array(N + 1);

      for (var a = 0; a < N; a++) {
        if (!anchor[a] || moves.length >= maxMoves) continue;
        if (a > 0 && g[base + a - 1]) {
          var s = a - 1; while (s > 0 && g[base + s - 1]) s--;
          var nd = 0;
          for (var x = s; x < a && nd !== -1; x++) { nd = child(nd, g[base + x] - 1); wl[x - s] = g[base + x] - 1; wb[x - s] = gb[base + x]; wnew[x - s] = 0; }
          if (nd !== -1) extend(s, a - s, nd, a, a);
        } else {
          var limit = 0;
          for (var y = a - 1; y >= 0 && !g[base + y] && !anchor[y]; y--) limit++;
          leftPart(0, 0, limit, a);
        }
      }

      function leftPart(len, node, limit, a) {
        extend(a - len, len, node, a, a);
        if (len >= limit) return;
        for (var ch = firstArr[node]; ch !== -1; ch = nextArr[ch]) {
          var L = letterArr[ch];
          if (counts[L] > 0) {
            counts[L]--; wl[len] = L; wb[len] = 0; wnew[len] = 1;
            leftPart(len + 1, ch, limit, a);
            counts[L]++;
          }
          if (counts[26] > 0) {
            counts[26]--; wl[len] = L; wb[len] = 1; wnew[len] = 1;
            leftPart(len + 1, ch, limit, a);
            counts[26]++;
          }
        }
      }

      // start: column where the word begins; len: letters so far; col: next column to fill
      function extend(start, len, node, col, a) {
        if (moves.length >= maxMoves) return;
        if (col >= N || !g[base + col]) {
          if (col > a && termArr[node] === 1 && len >= 2) record(start, len);
          if (col >= N) return;
          var cm = cross[col];
          if (!cm) return;
          for (var ch = firstArr[node]; ch !== -1; ch = nextArr[ch]) {
            var L = letterArr[ch];
            if (!(cm & (1 << L))) continue;
            if (counts[L] > 0) {
              counts[L]--; wl[len] = L; wb[len] = 0; wnew[len] = 1;
              extend(start, len + 1, ch, col + 1, a);
              counts[L]++;
            }
            if (counts[26] > 0) {
              counts[26]--; wl[len] = L; wb[len] = 1; wnew[len] = 1;
              extend(start, len + 1, ch, col + 1, a);
              counts[26]++;
            }
          }
        } else {
          var nx = child(node, g[base + col] - 1);
          if (nx === -1) return;
          wl[len] = g[base + col] - 1; wb[len] = gb[base + col]; wnew[len] = 0;
          extend(start, len + 1, nx, col + 1, a);
        }
      }

      function record(start, len) {
        var sum = 0, wm = 1, crossTotal = 0, tiles = 0, blanks = 0, word = "", placements = [];
        for (var k = 0; k < len; k++) {
          var col = start + k, jj = base + col, src = map[jj];
          var v = wb[k] ? 0 : VAL[wl[k]];
          var letter = String.fromCharCode(A + wl[k]);
          word += letter;
          if (wnew[k]) {
            var lv = v * LM[src];
            sum += lv; wm *= WM[src]; tiles++;
            if (wb[k]) blanks++;
            if (crossScore[col] >= 0) crossTotal += (crossScore[col] + lv) * WM[src];
            placements.push({ i: src, l: letter, b: !!wb[k] });
          } else sum += v;
        }
        // a single tile that also makes a word across is found in both passes; keep one
        if (!horiz && tiles === 1) {
          var pi = placements[0].i, pc = pi % N;
          if ((pc > 0 && board[pi - 1]) || (pc < N - 1 && board[pi + 1])) return;
        }
        var score = sum * wm + crossTotal + (tiles === RACK_SIZE ? BINGO : 0);
        moves.push({ placements: placements, word: word, score: score, tiles: tiles, blanks: blanks, horiz: horiz });
      }
    }
  }

  // ---------- computer players ----------
  var LEVELS = ["easy", "medium", "hard"];

  /**
   * Pick a move for a level. Hard takes the highest score. Medium aims for a random
   * 55–85% of the best score. Easy sticks to short words without blanks and aims for 20–50%.
   * Returns null when there is no move.
   */
  function chooseMove(moves, level, rng) {
    rng = rng || Math.random;
    if (!moves.length) return null;
    var best = moves[0];
    for (var i = 1; i < moves.length; i++) {
      var m = moves[i];
      if (m.score > best.score || (m.score === best.score && (m.blanks < best.blanks || (m.blanks === best.blanks && m.tiles < best.tiles)))) best = m;
    }
    if (level === "hard") return best;
    var pool = moves, lo = 0.55, hi = 0.85;
    if (level === "easy") {
      lo = 0.2; hi = 0.5;
      var short = moves.filter(function (m) { return m.word.length <= 5 && m.tiles <= 4 && !m.blanks; });
      if (short.length) pool = short;
    } else {
      var noBlank = moves.filter(function (m) { return !m.blanks || m.score >= best.score * 0.8; });
      if (noBlank.length) pool = noBlank;
    }
    var top = 0;
    pool.forEach(function (m) { if (m.score > top) top = m.score; });
    var target = top * (lo + (hi - lo) * rng());
    var pick = null, gap = Infinity, ties = 0;
    for (var p = 0; p < pool.length; p++) {
      var d = Math.abs(pool[p].score - target);
      if (d < gap) { gap = d; pick = pool[p]; ties = 1; }
      else if (d === gap && rng() < 1 / ++ties) pick = pool[p];
    }
    return pick;
  }

  /** Which tiles the computer swaps when it has no move: keeps blanks, S and one of each vowel. */
  function chooseExchange(rack) {
    var keep = {}, out = [];
    rack.forEach(function (t) {
      var good = t === BLANK || t === "S" || ("AEIOU".indexOf(t) >= 0 && !keep[t]) || ("RSTLN".indexOf(t) >= 0 && !keep[t]);
      if (good && !keep[t]) keep[t] = true; else out.push(t);
    });
    return out.length ? out : rack.slice();
  }

  // ---------- game state ----------
  function newGame(opts) {
    opts = opts || {};
    var rng = opts.rng || Math.random;
    var bag = makeBag(rng);
    var players = (opts.players || [{ name: "Player 1" }, { name: "Player 2" }]).map(function (p) {
      return { name: p.name, cpu: !!p.cpu, score: 0, rack: draw(bag, RACK_SIZE) };
    });
    return {
      v: 1, mode: opts.mode || "pvp", level: opts.level || "medium",
      board: emptyBoard(), bag: bag, players: players, turn: 0,
      history: [], scoreless: 0, over: false, result: null, lastMove: [],
      started: Date.now(),
    };
  }

  function nextTurn(g) { g.turn = (g.turn + 1) % g.players.length; }

  /** Play placements for the current player. Mutates and returns {ok, error, score, words}. */
  function playMove(g, placements, dict) {
    if (g.over) return { ok: false, error: "The game is over." };
    var pl = g.players[g.turn];
    var ev = evaluateMove(g.board, placements, dict);
    if (!ev.ok) return ev;
    var used = placements.map(function (p) { return p.b ? BLANK : p.l; });
    var rest = removeFromRack(pl.rack, used);
    if (!rest) return { ok: false, error: "Those tiles aren't on the rack." };
    g.board = applyPlacements(g.board, placements);
    pl.rack = refill(rest, g.bag);
    pl.score += ev.score;
    g.scoreless = ev.score > 0 ? 0 : g.scoreless + 1;
    g.lastMove = placements.map(function (p) { return p.i; });
    g.history.push({ p: g.turn, type: "play", words: ev.words.map(function (w) { return w.word; }), score: ev.score, bingo: ev.bingo });
    if (!pl.rack.length && !g.bag.length) finish(g, g.turn);
    else if (g.scoreless >= 6) finish(g, -1);
    else nextTurn(g);
    return { ok: true, score: ev.score, words: ev.words, bingo: ev.bingo };
  }

  function passTurn(g) {
    if (g.over) return { ok: false, error: "The game is over." };
    g.history.push({ p: g.turn, type: "pass", score: 0 });
    g.scoreless++;
    g.lastMove = [];
    if (g.scoreless >= 6) finish(g, -1); else nextTurn(g);
    return { ok: true };
  }

  function exchangeTurn(g, tiles, rng) {
    if (g.over) return { ok: false, error: "The game is over." };
    var pl = g.players[g.turn];
    var res = exchange(pl.rack, g.bag, tiles, rng);
    if (!res.ok) return res;
    pl.rack = res.rack;
    g.history.push({ p: g.turn, type: "swap", count: tiles.length, score: 0 });
    g.scoreless++;
    g.lastMove = [];
    if (g.scoreless >= 6) finish(g, -1); else nextTurn(g);
    return { ok: true };
  }

  /**
   * End-of-game scoring. If someone went out, they gain everyone else's rack value and the
   * others lose their own. Otherwise (six scoreless turns in a row) everyone loses their rack value.
   */
  function finish(g, outIdx) {
    var adj = g.players.map(function () { return 0; });
    var total = 0;
    g.players.forEach(function (p, i) {
      if (i === outIdx) return;
      var v = rackValue(p.rack);
      adj[i] = -v; total += v;
    });
    if (outIdx >= 0) adj[outIdx] = total;
    g.players.forEach(function (p, i) { p.score += adj[i]; });
    var top = Math.max.apply(null, g.players.map(function (p) { return p.score; }));
    var winners = [];
    g.players.forEach(function (p, i) { if (p.score === top) winners.push(i); });
    g.over = true;
    g.result = { out: outIdx, adjust: adj, winners: winners, reason: outIdx >= 0 ? "out" : "scoreless" };
    return g.result;
  }

  /** Tiles the given player can't see: the bag plus the other racks. */
  function unseenTiles(g, idx) {
    var all = g.bag.slice();
    g.players.forEach(function (p, i) { if (i !== idx) all = all.concat(p.rack); });
    return all.sort();
  }

  return {
    N: N, SIZE: SIZE, CENTER: CENTER, RACK_SIZE: RACK_SIZE, BINGO: BINGO, BLANK: BLANK,
    DISTRIBUTION: DISTRIBUTION, VALUES: VALUES, PREMIUM: PREMIUM, LEVELS: LEVELS,
    tileValue: tileValue, rackValue: rackValue, letterMult: letterMult, wordMult: wordMult,
    hashString: hashString, makeRng: makeRng, shuffle: shuffle,
    makeBag: makeBag, draw: draw, refill: refill, removeFromRack: removeFromRack, exchange: exchange,
    buildTrie: buildTrie, trieFromArrays: trieFromArrays,
    emptyBoard: emptyBoard, isEmptyBoard: isEmptyBoard, rc: rc, applyPlacements: applyPlacements,
    evaluateMove: evaluateMove, generateMoves: generateMoves, chooseMove: chooseMove, chooseExchange: chooseExchange,
    newGame: newGame, playMove: playMove, passTurn: passTurn, exchangeTurn: exchangeTurn, finish: finish,
    unseenTiles: unseenTiles,
  };
});
