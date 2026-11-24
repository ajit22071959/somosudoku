/* Letterfield page: board, rack, turns, computer opponent and saved games. */
/* global WordLogic */
(function () {
  "use strict";
  var W = WordLogic, N = W.N;
  var NS = "somo.words.";
  var BASE = new URL("../games/words/", document.baseURI).href;
  var $ = function (id) { return document.getElementById(id); };

  function load(key, fallback) {
    try { var raw = localStorage.getItem(NS + key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  }
  function store(key, value) { try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) {} }

  var LEVEL_HINTS = {
    easy: "Plays short, simple words. Good for a relaxed game.",
    medium: "Plays decent words but not always the best one.",
    hard: "Always plays the highest-scoring move it can find.",
  };
  var PREMIUM_LABEL = { TW: "3W", DW: "2W", TL: "3L", DL: "2L", ST: "★" };
  var PREMIUM_NAME = { TW: "triple word", DW: "double word", TL: "triple letter", DL: "double letter", ST: "start square, double word" };

  // ---------- state ----------
  var dict = null;          // trie for checking words
  var worker = null, workerOk = false, aiReqId = 0;
  var game = load("game", null);
  if (game && (game.v !== 1 || !Array.isArray(game.board) || game.board.length !== W.SIZE)) game = null;
  var pending = [];         // [{i, slot, l, b}]
  var sel = null;           // selected rack slot
  var cursor = null;        // {i, horiz} board square chosen for typing
  var thinking = false, lastAiMs = 0;
  var hidden = false;       // two-player: rack hidden until the next player is ready
  var lastEval = null;
  var setupMode = "cpu", setupLevel = "medium";
  var stats = load("stats", { easy: { w: 0, l: 0, t: 0 }, medium: { w: 0, l: 0, t: 0 }, hard: { w: 0, l: 0, t: 0 }, bestMove: 0, bestGame: 0 });

  // ---------- dictionary ----------
  function loadDictionary() {
    var wordsUrl = BASE + "enable.txt", skipUrl = BASE + "ai-skip.txt";
    try {
      worker = new Worker(BASE + "worker.js");
      worker.onmessage = onWorker;
      worker.onerror = function (e) { if (e && e.preventDefault) e.preventDefault(); workerFailed(); };
      worker.postMessage({ type: "init", words: wordsUrl, skip: skipUrl });
    } catch (e) { workerFailed(); }

    function workerFailed() {
      if (workerOk || dict) return;
      worker = null;
      Promise.all([fetch(wordsUrl).then(function (r) { return r.text(); }), fetch(skipUrl).then(function (r) { return r.ok ? r.text() : ""; }).catch(function () { return ""; })])
        .then(function (t) { dict = W.buildTrie(t[0], t[1]); onReady(); })
        .catch(function () { setStatus("Couldn't load the word list. Check your connection and reload.", "bad"); });
    }
  }
  function onWorker(e) {
    var m = e.data;
    if (m.type === "ready") { workerOk = true; dict = W.trieFromArrays(m.trie); onReady(); }
    else if (m.type === "error") { setStatus("Couldn't load the word list. Check your connection and reload.", "bad"); }
  }
  function onReady() {
    render();
    maybeCpu();
  }

  // ---------- helpers ----------
  function cur() { return game && game.players[game.turn]; }
  function humanTurn() { return game && !game.over && !cur().cpu; }
  function viewer() {
    // whose rack the screen shows
    if (!game) return null;
    if (game.mode === "cpu") return game.players[0].cpu ? game.players[1] : game.players[0];
    return cur();
  }
  function viewerIndex() { return game.players.indexOf(viewer()); }
  function placements() { return pending.map(function (p) { return { i: p.i, l: p.l, b: p.b }; }); }
  function pendingAt(i) { for (var k = 0; k < pending.length; k++) if (pending[k].i === i) return pending[k]; return null; }
  function slotUsed(s) { return pending.some(function (p) { return p.slot === s; }); }
  function save() { store("game", game); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  function setStatus(text, kind) {
    var el = $("wf-status");
    el.textContent = text;
    el.className = "wf-status" + (kind ? " " + kind : "");
  }

  // ---------- rendering ----------
  var cells = [];
  function buildBoard() {
    var board = $("wf-board");
    for (var r = 0; r < N; r++) {
      var row = document.createElement("div");
      row.className = "row"; row.setAttribute("role", "row");
      for (var c = 0; c < N; c++) {
        var i = r * N + c;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "sq";
        b.setAttribute("role", "gridcell");
        b.dataset.i = i;
        var p = W.PREMIUM[i];
        if (p) { b.classList.add("p-" + p.toLowerCase()); b.dataset.label = PREMIUM_LABEL[p]; }
        row.appendChild(b);
        cells[i] = b;
      }
      board.appendChild(row);
    }
  }

  function tileHtml(letter, blank, extra) {
    var v = blank ? "" : W.VALUES[letter];
    return '<span class="tile' + (blank ? " blank" : "") + (extra || "") + '"><span class="tl">' + esc(letter) + "</span>" +
      (v !== "" ? '<span class="tv">' + v + "</span>" : "") + "</span>";
  }

  function render() {
    if (!game) { renderEmpty(); return; }
    var ev = lastEval = pending.length ? W.evaluateMove(game.board, placements(), dict) : null;
    var bad = {};
    if (ev && !ev.ok && ev.words) ev.words.forEach(function (w) { if (ev.invalid.indexOf(w.word) >= 0) w.cells.forEach(function (c) { bad[c] = 1; }); });
    var last = {}; (game.lastMove || []).forEach(function (i) { last[i] = 1; });

    for (var i = 0; i < W.SIZE; i++) {
      var el = cells[i], cell = game.board[i], p = pendingAt(i), r = Math.floor(i / N) + 1, c = (i % N) + 1;
      var label = "Row " + r + ", column " + c;
      el.classList.toggle("filled", !!(cell || p));
      el.classList.toggle("pending", !!p);
      el.classList.toggle("bad", !!(p && ev && !ev.ok));
      el.classList.toggle("badword", !!bad[i]);
      el.classList.toggle("last", !!last[i] && !p);
      el.classList.toggle("cursor", !!(cursor && cursor.i === i && !cell && !p));
      el.classList.toggle("down", !!(cursor && cursor.i === i && !cursor.horiz));
      if (cell) { el.innerHTML = tileHtml(cell.l, cell.b); label += ", " + cell.l + (cell.b ? " (blank)" : ""); }
      else if (p) { el.innerHTML = tileHtml(p.l, p.b); label += ", your new tile " + p.l + ". Tap to take it back"; }
      else { el.innerHTML = ""; var pr = W.PREMIUM[i]; label += pr ? ", " + PREMIUM_NAME[pr] : ", empty"; }
      el.setAttribute("aria-label", label);
    }

    renderScores();
    renderRack();
    renderControls(ev);
    renderHistory();
    renderBag();
    renderStats();
  }

  function renderEmpty() {
    $("scorebar").innerHTML = "";
    $("rack").innerHTML = "";
    $("history").innerHTML = '<li class="muted">No game yet.</li>';
    setStatus(dict ? "Start a new game to play." : "Loading the word list…");
    ["shuffle-btn", "recall-btn", "swap-btn", "pass-btn", "play-btn"].forEach(function (id) { $(id).disabled = true; });
    renderStats();
  }

  function renderScores() {
    var html = game.players.map(function (p, i) {
      var active = !game.over && i === game.turn;
      var win = game.over && game.result.winners.indexOf(i) >= 0;
      return '<div class="pcard' + (active ? " active" : "") + (win ? " won" : "") + '">' +
        '<span class="pname">' + esc(p.name) + (p.cpu ? ' <small>' + esc(game.level) + "</small>" : "") + "</span>" +
        '<span class="pscore">' + p.score + "</span>" +
        '<span class="pturn">' + (active ? (p.cpu && thinking ? "Thinking…" : "To play") : win ? (game.result.winners.length > 1 ? "Tie" : "Winner") : p.cpu ? esc(cap(game.level)) : "&nbsp;") + "</span></div>";
    }).join("");
    html += '<div class="bagchip" title="Tiles left in the bag"><span>' + game.bag.length + "</span><small>in bag</small></div>";
    $("scorebar").innerHTML = html;
  }

  function renderRack() {
    var v = viewer(), rack = $("rack");
    if (!v || hidden) { rack.innerHTML = '<p class="rack-hidden">Tiles hidden</p>'; return; }
    var html = "";
    for (var s = 0; s < v.rack.length; s++) {
      var t = v.rack[s], used = slotUsed(s);
      if (used) { html += '<button type="button" class="rslot used" data-slot="' + s + '" aria-label="Tile on the board. Tap to take it back"></button>'; continue; }
      var blank = t === W.BLANK;
      html += '<button type="button" class="rslot' + (sel === s ? " sel" : "") + '" data-slot="' + s + '" aria-pressed="' + (sel === s) + '" aria-label="' +
        (blank ? "Blank tile" : t + ", " + W.VALUES[t] + " points") + '">' + tileHtml(blank ? "" : t, blank) + "</button>";
    }
    rack.innerHTML = html;
  }

  function renderControls(ev) {
    var mine = humanTurn() && !hidden && !!dict;
    $("shuffle-btn").disabled = !viewer() || hidden || game.over;
    $("recall-btn").disabled = !pending.length;
    $("swap-btn").disabled = !mine || game.bag.length < W.RACK_SIZE;
    $("pass-btn").disabled = !mine;
    var play = $("play-btn");
    play.disabled = !mine || !ev || !ev.ok;
    play.textContent = ev && ev.words && ev.words.length ? "Play · " + ev.score : "Play";

    if (game.over) {
      var r = game.result;
      var wn = r.winners.length > 1 ? null : game.players[r.winners[0]];
      setStatus(!wn ? "Game over — it's a tie." : game.mode === "cpu" ? (wn.cpu ? "Game over — the computer won." : "Game over — you won!") : "Game over — " + wn.name + " won.", "");
    } else if (!dict) setStatus("Loading the word list…");
    else if (cur().cpu) setStatus(thinking ? cur().name + " is thinking…" : cur().name + "'s turn.");
    else if (ev) {
      if (ev.ok) {
        var words = ev.words.map(function (w) { return w.word; }).join(", ");
        setStatus(words + " · " + plural(ev.score, "point") + (ev.bingo ? " (includes 50 for using all 7 tiles!)" : ""), "good");
      } else if (ev.words && ev.words.length && ev.invalid.length) {
        setStatus("Not in the word list: " + ev.invalid.join(", ") + " · would score " + ev.score, "bad");
      } else setStatus(ev.error, "bad");
    } else {
      var msg = game.mode === "pvp" ? cur().name + ", your turn." : "Your turn.";
      if (W.isEmptyBoard(game.board)) msg += " Start with a word across or down through the centre star.";
      else msg += " Tap a tile, then a square — or drag it.";
      setStatus(msg);
    }
  }

  function moveText(h) {
    var who = game.players[h.p].name;
    if (h.type === "play") return '<span class="hwho">' + esc(who) + '</span> <span class="hwords">' + esc(h.words.join(", ")) + "</span>" +
      (h.bingo ? ' <span class="hbingo">all 7</span>' : "") + ' <span class="hscore">+' + h.score + "</span>";
    if (h.type === "swap") return '<span class="hwho">' + esc(who) + "</span> swapped " + plural(h.count, "tile");
    return '<span class="hwho">' + esc(who) + "</span> passed";
  }
  function renderHistory() {
    var h = game.history;
    var html = "";
    if (game.over) {
      var r = game.result;
      html += '<li class="hend">' + game.players.map(function (p, i) { var a = r.adjust[i]; return esc(p.name) + " " + (a >= 0 ? "+" : "") + a; }).join(" · ") + " for tiles left</li>";
    }
    for (var k = h.length - 1; k >= 0; k--) html += "<li>" + moveText(h[k]) + "</li>";
    $("history").innerHTML = html || '<li class="muted">No moves yet.</li>';
  }

  function renderBag() {
    $("bag-count").innerHTML = "<strong>" + game.bag.length + "</strong> in the bag" +
      (game.bag.length < W.RACK_SIZE && !game.over ? " · swapping is off" : "");
    var unseen = hidden ? [] : W.unseenTiles(game, viewerIndex());
    var counts = {};
    unseen.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; });
    $("unseen").innerHTML = Object.keys(counts).sort().map(function (t) {
      return '<span class="u"><b>' + (t === W.BLANK ? "?" : t) + "</b>" + counts[t] + "</span>";
    }).join("") || '<span class="muted">None</span>';
  }

  function renderStats() {
    var s = stats;
    var rows = W.LEVELS.map(function (l) {
      var x = s[l];
      return '<div class="srow"><span>' + l[0].toUpperCase() + l.slice(1) + "</span><span>" + x.w + " won · " + x.l + " lost" + (x.t ? " · " + x.t + " tied" : "") + "</span></div>";
    }).join("");
    rows += '<div class="srow"><span>Best move</span><span>' + (s.bestMove || "—") + "</span></div>";
    rows += '<div class="srow"><span>Best game</span><span>' + (s.bestGame || "—") + "</span></div>";
    $("wf-stats").innerHTML = rows;
  }

  // ---------- placing tiles ----------
  function placeTile(slot, i) {
    var v = viewer();
    if (!humanTurn() || hidden || game.board[i] || pendingAt(i) || slotUsed(slot)) return;
    var t = v.rack[slot];
    if (t === W.BLANK) {
      chooseBlank(function (letter) { pending.push({ i: i, slot: slot, l: letter, b: true }); afterPlace(i); });
      return;
    }
    pending.push({ i: i, slot: slot, l: t, b: false });
    afterPlace(i);
  }
  function afterPlace(i) {
    sel = null;
    if (cursor && cursor.i === i) advanceCursor();
    render();
  }
  function advanceCursor() {
    var step = cursor.horiz ? 1 : N, i = cursor.i;
    while (true) {
      var r = Math.floor(i / N), c = i % N;
      if (cursor.horiz ? c >= N - 1 : r >= N - 1) { cursor = null; return; }
      i += step;
      if (!game.board[i] && !pendingAt(i)) { cursor.i = i; return; }
    }
  }
  function recallAt(i) {
    pending = pending.filter(function (p) { return p.i !== i; });
    render();
  }
  function recallAll() { pending = []; sel = null; render(); }

  function onBoardClick(e) {
    var el = e.target.closest(".sq");
    if (!el || suppressClick) return;
    var i = +el.dataset.i;
    if (!humanTurn() || hidden) return;
    if (pendingAt(i)) { recallAt(i); return; }
    if (game.board[i]) return;
    if (sel !== null) { placeTile(sel, i); return; }
    // choose a square for typing; tapping it again flips across/down
    if (cursor && cursor.i === i) cursor.horiz = !cursor.horiz;
    else cursor = { i: i, horiz: true };
    render();
  }
  function onRackClick(e) {
    var el = e.target.closest(".rslot");
    if (!el || suppressClick) return;
    var s = +el.dataset.slot;
    if (slotUsed(s)) { pending = pending.filter(function (p) { return p.slot !== s; }); render(); return; }
    if (!humanTurn() || hidden) return;
    if (cursor && !game.board[cursor.i] && !pendingAt(cursor.i)) { placeTile(s, cursor.i); return; }
    sel = sel === s ? null : s;
    render();
  }

  // drag and drop with pointer events (mouse, touch and pen)
  var drag = null, suppressClick = false;
  function onPointerDown(e) {
    if (e.button > 0 || !humanTurn() || hidden) return;
    var rs = e.target.closest(".rslot:not(.used)"), sq = e.target.closest(".sq.pending");
    if (!rs && !sq) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, slot: rs ? +rs.dataset.slot : null, from: sq ? +sq.dataset.i : null, el: rs || sq, ghost: null };
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.ghost) {
      if (dx * dx + dy * dy < 49) return;
      var tile = drag.el.querySelector(".tile");
      if (!tile) { drag = null; return; }
      var g = tile.cloneNode(true);
      g.className += " ghost";
      var box = drag.el.getBoundingClientRect();
      g.style.width = Math.max(40, box.width) + "px"; g.style.height = Math.max(40, box.width) + "px";
      document.body.appendChild(g);
      drag.ghost = g;
      drag.el.classList.add("dragging");
    }
    drag.ghost.style.transform = "translate(" + (e.clientX - 24) + "px," + (e.clientY - 44) + "px)";
    var over = dropTarget(e.clientX, e.clientY);
    document.querySelectorAll(".sq.drop").forEach(function (x) { x.classList.remove("drop"); });
    if (over && over.classList.contains("sq")) over.classList.add("drop");
    e.preventDefault();
  }
  function dropTarget(x, y) {
    var el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest(".sq") || el.closest(".rslot") || el.closest(".rack");
  }
  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag; drag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    d.el.classList.remove("dragging");
    document.querySelectorAll(".sq.drop").forEach(function (x) { x.classList.remove("drop"); });
    suppressClick = true; setTimeout(function () { suppressClick = false; }, 0);
    if (e.type === "pointercancel") return;
    var t = dropTarget(e.clientX, e.clientY);
    if (!t) return;
    if (t.classList.contains("sq")) {
      var i = +t.dataset.i;
      if (game.board[i] || pendingAt(i)) return;
      if (d.from !== null) { var p = pendingAt(d.from); if (p) { p.i = i; render(); } }
      else placeTile(d.slot, i);
    } else if (d.from !== null) {
      recallAt(d.from);
    } else if (t.classList.contains("rslot") && d.slot !== null) {
      // reorder the rack
      var to = +t.dataset.slot, rack = viewer().rack;
      if (to === d.slot || slotUsed(to)) return;
      var moving = rack.splice(d.slot, 1)[0];
      rack.splice(to, 0, moving);
      remapSlots(function (s) {
        if (s === d.slot) return to;
        if (d.slot < to && s > d.slot && s <= to) return s - 1;
        if (d.slot > to && s >= to && s < d.slot) return s + 1;
        return s;
      });
      sel = null; save(); render();
    }
  }
  function remapSlots(fn) { pending.forEach(function (p) { p.slot = fn(p.slot); }); }

  function shuffleRack() {
    var v = viewer();
    if (!v) return;
    var order = v.rack.map(function (t, k) { return k; });
    W.shuffle(order);
    var newRack = order.map(function (k) { return v.rack[k]; });
    var where = {}; order.forEach(function (k, n) { where[k] = n; });
    remapSlots(function (s) { return where[s]; });
    v.rack = newRack; sel = null;
    save(); render();
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (!game || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector(".modal:not([hidden])")) { if (e.key === "Escape") closeTopModal(); return; }
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (!humanTurn() || hidden) return;
    var k = e.key;
    if (k === "Enter") {
      var ae = document.activeElement;
      if (lastEval && lastEval.ok && !(ae && ae.tagName === "BUTTON" && !ae.classList.contains("sq"))) { doPlay(); e.preventDefault(); }
      return;
    }
    if (k === "Escape") { cursor = null; recallAll(); return; }
    if (k === "Backspace") {
      if (pending.length) { var p = pending.pop(); if (cursor) cursor.i = p.i; render(); e.preventDefault(); }
      return;
    }
    if (k === " " && cursor) { cursor.horiz = !cursor.horiz; render(); e.preventDefault(); return; }
    if (/^[a-zA-Z]$/.test(k) && cursor) {
      var L = k.toUpperCase(), rack = viewer().rack, slot = -1;
      for (var s = 0; s < rack.length; s++) if (!slotUsed(s) && rack[s] === L) { slot = s; break; }
      var useBlank = false;
      if (slot < 0) for (s = 0; s < rack.length; s++) if (!slotUsed(s) && rack[s] === W.BLANK) { slot = s; useBlank = true; break; }
      if (slot < 0) { setStatus("No " + L + " on your rack.", "bad"); return; }
      var at = cursor.i;
      if (game.board[at] || pendingAt(at)) return;
      pending.push({ i: at, slot: slot, l: L, b: useBlank });
      afterPlace(at);
      e.preventDefault();
    }
  }

  // ---------- turns ----------
  function doPlay() {
    if (!humanTurn() || !dict) return;
    var res = W.playMove(game, placements(), dict);
    if (!res.ok) { setStatus(res.error, "bad"); return; }
    if (res.score > (stats.bestMove || 0) && game.mode === "cpu") { stats.bestMove = res.score; store("stats", stats); }
    pending = []; sel = null; cursor = null;
    afterTurn();
  }
  function doPass() {
    confirmDlg("Pass this turn?", game.bag.length >= W.RACK_SIZE ? "You'll score nothing this turn. You could swap tiles instead." : "You'll score nothing this turn.", "Pass", function () {
      pending = []; sel = null; cursor = null;
      W.passTurn(game); afterTurn();
    });
  }
  function afterTurn() {
    save();
    if (game.over) { finishGame(); return; }
    if (game.mode === "pvp") { hidden = true; render(); showHandoff(); return; }
    render();
    maybeCpu();
  }

  function maybeCpu() {
    if (!game || game.over || !cur().cpu || !dict || thinking) return;
    thinking = true;
    render();
    var started = Date.now(), id = ++aiReqId, p = cur();
    var done = function (move) {
      var wait = Math.max(0, 700 - (Date.now() - started));
      setTimeout(function () { if (id === aiReqId) applyCpuMove(move, true); }, wait);
    };
    if (worker && workerOk) {
      worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === "move") { if (m.id === id) { lastAiMs = m.ms; done(m.move); } }
        else onWorker(e);
      };
      worker.postMessage({ type: "move", id: id, board: game.board, rack: p.rack, level: game.level });
    } else {
      setTimeout(function () {
        var t0 = Date.now(), moves = W.generateMoves(game.board, p.rack, dict);
        lastAiMs = Date.now() - t0;
        done(W.chooseMove(moves, game.level));
      }, 30);
    }
  }
  function applyCpuMove(move, real) {
    if (!real || !game || game.over || !cur().cpu) { thinking = false; return; }
    thinking = false;
    var res = move ? W.playMove(game, move.placements, dict) : { ok: false };
    if (!res.ok) {
      if (game.bag.length >= W.RACK_SIZE) W.exchangeTurn(game, W.chooseExchange(cur().rack));
      else W.passTurn(game);
    }
    save();
    if (game.over) { finishGame(); return; }
    render();
  }

  function finishGame() {
    render();
    var r = game.result;
    if (game.mode === "cpu" && !game.counted) {
      var me = game.players[0].cpu ? 1 : 0, s = stats[game.level];
      if (r.winners.length > 1) s.t++; else if (r.winners[0] === me) s.w++; else s.l++;
      if (game.players[me].score > (stats.bestGame || 0)) stats.bestGame = game.players[me].score;
      game.counted = true; store("stats", stats); save();
    }
    var title;
    if (r.winners.length > 1) title = "It's a tie!";
    else if (game.mode === "cpu") title = game.players[r.winners[0]].cpu ? "The computer wins" : "You win!";
    else title = game.players[r.winners[0]].name + " wins!";
    $("over-title").textContent = title;
    $("over-scores").innerHTML = game.players.map(function (p, i) {
      var a = r.adjust[i];
      return '<div class="orow' + (r.winners.indexOf(i) >= 0 ? " win" : "") + '"><span>' + esc(p.name) + '</span><span class="oadj">' + (a >= 0 ? "+" : "−") + Math.abs(a) + '</span><strong>' + String(p.score).replace("-", "−") + "</strong></div>";
    }).join("");
    var outP = r.reason === "out" ? game.players[r.out] : null;
    $("over-note").textContent = outP
      ? (game.mode === "cpu" && !outP.cpu ? "You used your last tile, so you get the value of the tiles left on the computer's rack."
        : outP.name + " used the last tile first and gets the value of the tiles left on the other rack.")
      : "Six turns in a row without a score. Tiles left on each rack are taken off.";
    openModal("over-dlg");
    render();
    renderStats();
  }

  // ---------- modals ----------
  var modalStack = [];
  function openModal(id) {
    var m = $(id); m.hidden = false; modalStack.push(id);
    var f = m.querySelector(".primary:not(:disabled), button, input");
    if (f) f.focus();
  }
  function closeModal(id) { $(id).hidden = true; modalStack = modalStack.filter(function (x) { return x !== id; }); }
  function closeTopModal() {
    var id = modalStack[modalStack.length - 1];
    if (!id || id === "handoff") return;
    if (id === "setup" && !game) return;
    if (id === "blank-dlg" && blankCb) { blankCb = null; }
    closeModal(id);
  }

  var blankCb = null;
  function chooseBlank(cb) {
    blankCb = cb;
    openModal("blank-dlg");
  }
  function buildBlankGrid() {
    var html = "";
    for (var k = 0; k < 26; k++) { var L = String.fromCharCode(65 + k); html += '<button type="button" data-l="' + L + '">' + L + "</button>"; }
    $("blank-grid").innerHTML = html;
    $("blank-grid").addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      var cb = blankCb; blankCb = null; closeModal("blank-dlg");
      if (cb) cb(b.dataset.l);
    });
    $("blank-cancel").onclick = function () { blankCb = null; closeModal("blank-dlg"); };
  }

  var confirmCb = null;
  function confirmDlg(title, text, yes, cb) {
    $("confirm-title").textContent = title; $("confirm-text").textContent = text; $("confirm-yes").textContent = yes;
    confirmCb = cb; openModal("confirm-dlg");
  }

  var swapSel = [];
  function openSwap() {
    if (!humanTurn() || game.bag.length < W.RACK_SIZE) return;
    pending = []; sel = null; swapSel = []; render();
    renderSwap(); openModal("swap-dlg");
  }
  function renderSwap() {
    var rack = viewer().rack;
    $("swap-rack").innerHTML = rack.map(function (t, s) {
      var blank = t === W.BLANK;
      return '<button type="button" class="rslot' + (swapSel.indexOf(s) >= 0 ? " sel" : "") + '" data-slot="' + s + '" aria-pressed="' + (swapSel.indexOf(s) >= 0) + '" aria-label="' + (blank ? "Blank" : t) + '">' + tileHtml(blank ? "" : t, blank) + "</button>";
    }).join("");
    $("swap-go").disabled = !swapSel.length;
    $("swap-go").textContent = swapSel.length ? "Swap " + swapSel.length : "Swap";
    $("swap-all").textContent = swapSel.length === rack.length ? "Clear" : "Select all";
  }

  function showHandoff() {
    var h = game.history[game.history.length - 1], who = game.players[h.p].name;
    $("handoff-last").textContent = h.type === "play" ? who + " played " + h.words[0] + " for " + h.score
      : h.type === "swap" ? who + " swapped " + plural(h.count, "tile") : who + " passed";
    $("handoff-title").textContent = "Pass the device to " + cur().name;
    $("handoff-go").textContent = "I'm " + cur().name + " — show my tiles";
    openModal("handoff");
  }

  function openSetup() {
    var last = load("setup", null);
    if (last) { setupMode = last.mode || "cpu"; setupLevel = last.level || "medium"; $("p1-name").value = last.p1 || ""; $("p2-name").value = last.p2 || ""; }
    syncSetup();
    $("setup-cancel").hidden = !game;
    openModal("setup");
  }
  function syncSetup() {
    document.querySelectorAll("#opp-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.mode === setupMode)); });
    document.querySelectorAll("#level-seg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.level === setupLevel)); });
    $("setup-cpu").hidden = setupMode !== "cpu";
    $("setup-pvp").hidden = setupMode !== "pvp";
    $("level-hint").textContent = LEVEL_HINTS[setupLevel];
  }
  function startGame() {
    var p1 = $("p1-name").value.trim(), p2 = $("p2-name").value.trim();
    store("setup", { mode: setupMode, level: setupLevel, p1: p1, p2: p2 });
    var players = setupMode === "cpu" ? [{ name: "You" }, { name: "Computer", cpu: true }]
      : [{ name: p1 || "Player 1" }, { name: p2 && p2 !== p1 ? p2 : (p1 === "Player 2" ? "Player 1" : "Player 2") }];
    aiReqId++; thinking = false;
    game = W.newGame({ mode: setupMode, level: setupLevel, players: players });
    pending = []; sel = null; cursor = null; hidden = false;
    save();
    closeModal("setup"); closeModal("over-dlg");
    render();
    if (game.mode === "pvp") { hidden = true; render(); $("handoff-last").textContent = "New game"; $("handoff-title").textContent = game.players[0].name + " goes first"; $("handoff-go").textContent = "I'm " + game.players[0].name + " — show my tiles"; openModal("handoff"); }
  }

  // ---------- wiring ----------
  function wire() {
    $("wf-board").addEventListener("click", onBoardClick);
    $("rack").addEventListener("click", onRackClick);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
    document.addEventListener("keydown", onKey);
    $("shuffle-btn").onclick = shuffleRack;
    $("recall-btn").onclick = function () { cursor = null; recallAll(); };
    $("play-btn").onclick = doPlay;
    $("pass-btn").onclick = doPass;
    $("swap-btn").onclick = openSwap;
    $("new-game-btn").onclick = function () {
      if (game && !game.over && game.history.length) confirmDlg("Start a new game?", "The current game will be lost.", "New game", openSetup);
      else openSetup();
    };
    $("confirm-yes").onclick = function () { var cb = confirmCb; confirmCb = null; closeModal("confirm-dlg"); if (cb) cb(); };
    $("confirm-no").onclick = function () { confirmCb = null; closeModal("confirm-dlg"); };
    $("swap-rack").addEventListener("click", function (e) {
      var b = e.target.closest(".rslot"); if (!b) return;
      var s = +b.dataset.slot, at = swapSel.indexOf(s);
      if (at >= 0) swapSel.splice(at, 1); else swapSel.push(s);
      renderSwap();
    });
    $("swap-all").onclick = function () {
      var rack = viewer().rack;
      swapSel = swapSel.length === rack.length ? [] : rack.map(function (t, s) { return s; });
      renderSwap();
    };
    $("swap-go").onclick = function () {
      var rack = viewer().rack, tiles = swapSel.map(function (s) { return rack[s]; });
      var res = W.exchangeTurn(game, tiles);
      closeModal("swap-dlg");
      if (!res.ok) { setStatus(res.error, "bad"); return; }
      afterTurn();
    };
    $("swap-cancel").onclick = function () { closeModal("swap-dlg"); };
    $("handoff-go").onclick = function () { hidden = false; closeModal("handoff"); render(); };
    $("over-new").onclick = function () { closeModal("over-dlg"); openSetup(); };
    $("over-close").onclick = function () { closeModal("over-dlg"); };
    $("opp-seg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { setupMode = b.dataset.mode; syncSetup(); } });
    $("level-seg").addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) { setupLevel = b.dataset.level; syncSetup(); } });
    $("setup-form").addEventListener("submit", function (e) { e.preventDefault(); startGame(); });
    $("setup-cancel").onclick = function () { closeModal("setup"); };
    document.querySelectorAll(".modal").forEach(function (m) {
      m.addEventListener("click", function (e) { if (e.target === m) closeTopModal(); });
    });
  }

  buildBoard();
  buildBlankGrid();
  wire();
  loadDictionary();
  if (!game) { renderEmpty(); openSetup(); }
  else {
    if (game.mode === "pvp" && !game.over) { hidden = true; render(); $("handoff-last").textContent = "Welcome back"; $("handoff-title").textContent = "It's " + cur().name + "'s turn"; $("handoff-go").textContent = "I'm " + cur().name + " — show my tiles"; openModal("handoff"); }
    else render();
  }
  // Exposed for automated checks.
  window.Letterfield = { get game() { return game; }, get ready() { return !!dict; }, get thinking() { return thinking; }, get aiMs() { return lastAiMs; } };
})();
