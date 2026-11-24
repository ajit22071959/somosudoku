/* Sudoku game UI. Logic lives in sudoku.js (SudokuLogic). */
(function () {
  "use strict";
  var S = window.SudokuLogic;
  // Storage is namespaced by game, not by site name, so renaming the site keeps progress.
  var NS = "somo.sudoku.";
  var MAX_SAVED_GAMES = 40;

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $("board"), padEl = $("pad"), statusEl = $("status"), timerEl = $("timer");
  var cells = [], padButtons = [];

  var game = null;          // current puzzle state
  var selected = 40;
  var notesMode = false;
  var paused = false;
  var undoStack = [];
  var settings = load("settings", { showMistakes: false });
  var flashTimer = null;

  // ---------- storage ----------
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(NS + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
  }
  function remove(key) { try { localStorage.removeItem(NS + key); } catch (e) {} }

  function saveGame() {
    if (!game) return;
    game.savedAt = Date.now();
    save("game." + game.id, {
      id: game.id, mode: game.mode, difficulty: game.difficulty, dateKey: game.dateKey, seed: game.seed,
      puzzle: S.gridToString(game.puzzle), solution: S.gridToString(game.solution),
      values: S.gridToString(game.values), notes: game.notes, hinted: game.hinted,
      elapsed: game.elapsed, hints: game.hints, completed: game.completed, savedAt: game.savedAt,
    });
    var index = load("index", []).filter(function (x) { return x.id !== game.id; });
    index.push({ id: game.id, savedAt: game.savedAt });
    index.sort(function (a, b) { return a.savedAt - b.savedAt; });
    while (index.length > MAX_SAVED_GAMES) remove("game." + index.shift().id);
    save("index", index);
    save("current", { mode: game.mode, difficulty: game.difficulty, id: game.id });
  }
  function readSavedGame(id) {
    var g = load("game." + id, null);
    if (!g) return null;
    var puzzle = S.stringToGrid(g.puzzle), solution = S.stringToGrid(g.solution), values = S.stringToGrid(g.values);
    if (!puzzle || !solution || !values || !Array.isArray(g.notes) || g.notes.length !== 81) return null;
    return {
      id: g.id, mode: g.mode, difficulty: g.difficulty, dateKey: g.dateKey, seed: g.seed,
      puzzle: puzzle, solution: solution, values: values,
      notes: g.notes.map(function (n) { return n | 0; }),
      hinted: Array.isArray(g.hinted) ? g.hinted : [],
      elapsed: g.elapsed || 0, hints: g.hints || 0, completed: !!g.completed,
    };
  }

  // ---------- starting puzzles ----------
  function newGameFrom(gen, mode, dateKey) {
    var key = mode === "daily" ? dateKey : String(S.hashString(String(gen.seed)));
    return {
      id: S.puzzleId(mode, gen.difficulty, key), mode: mode, difficulty: gen.difficulty,
      dateKey: dateKey || null, seed: String(gen.seed),
      puzzle: gen.puzzle.slice(), solution: gen.solution.slice(), values: gen.puzzle.slice(),
      notes: new Array(81).fill(0), hinted: [], elapsed: 0, hints: 0, completed: false,
    };
  }
  function withSpinner(fn) {
    setStatus("Making a puzzle…");
    // let the message paint before the (short) generation work
    setTimeout(function () { fn(); }, 20);
  }
  function openDaily(difficulty) {
    var dateKey = S.localDateKey(new Date());
    var id = S.puzzleId("daily", difficulty, dateKey);
    var saved = readSavedGame(id);
    if (saved) return start(saved, "Welcome back — your progress is restored.");
    withSpinner(function () { start(newGameFrom(S.dailyPuzzle(dateKey, difficulty), "daily", dateKey), ""); });
  }
  function openRandom(difficulty, forceNew) {
    var last = load("lastRandom." + difficulty, null);
    if (!forceNew && last) {
      var saved = readSavedGame(last);
      if (saved && !saved.completed) return start(saved, "Welcome back — your progress is restored.");
    }
    withSpinner(function () {
      var seed = "random|" + Date.now() + "|" + Math.floor(Math.random() * 1e9);
      var g = newGameFrom(S.generate(difficulty, seed), "random", null);
      save("lastRandom." + difficulty, g.id);
      start(g, "Fresh " + difficulty + " puzzle ready.");
    });
  }
  function start(g, message) {
    game = g;
    undoStack = [];
    paused = false;
    selected = firstEmpty();
    setPaused(false);
    hideCelebration();
    saveGame();
    renderPicker();
    render();
    renderStats();
    setStatus(g.completed ? "You've solved this one. Try another difficulty or a random puzzle." : message || "");
  }
  function firstEmpty() {
    for (var i = 0; i < 81; i++) if (!game.values[i]) return i;
    return 40;
  }

  // ---------- rendering ----------
  function buildBoard() {
    for (var r = 0; r < 9; r++) {
      var row = document.createElement("div");
      row.className = "row";
      row.setAttribute("role", "row");
      for (var c = 0; c < 9; c++) {
        var i = r * 9 + c;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "cell r" + r + " c" + c;
        b.setAttribute("role", "gridcell");
        b.dataset.index = i;
        b.tabIndex = -1;
        b.addEventListener("click", onCellClick);
        row.appendChild(b);
        cells.push(b);
      }
      boardEl.appendChild(row);
    }
    for (var d = 1; d <= 9; d++) {
      var p = document.createElement("button");
      p.type = "button";
      p.dataset.digit = d;
      p.innerHTML = '<span class="num">' + d + '</span><span class="left"></span>';
      p.addEventListener("click", function (e) { enterDigit(Number(e.currentTarget.dataset.digit)); });
      padEl.appendChild(p);
      padButtons.push(p);
    }
  }

  function render() {
    if (!game) return;
    var v = game.values, sol = game.solution;
    var conflicts = {};
    S.findConflicts(v).forEach(function (i) { conflicts[i] = true; });
    var selVal = selected >= 0 ? v[selected] : 0;
    var hintedSet = {};
    game.hinted.forEach(function (i) { hintedSet[i] = true; });

    for (var i = 0; i < 81; i++) {
      var el = cells[i];
      var given = game.puzzle[i] !== 0;
      var cls = ["cell", "r" + S.ROW[i], "c" + S.COL[i]];
      if (given) cls.push("given");
      if (hintedSet[i]) cls.push("hinted");
      if (i === selected) cls.push("selected");
      else if (selected >= 0 && (S.ROW[i] === S.ROW[selected] || S.COL[i] === S.COL[selected] || S.BOX[i] === S.BOX[selected])) cls.push("peer");
      if (selVal && v[i] === selVal && i !== selected) cls.push("same");
      if (conflicts[i]) cls.push("conflict");
      if (settings.showMistakes && v[i] && !given && v[i] !== sol[i]) cls.push("mistake");
      if (el.classList.contains("flash")) cls.push("flash");
      el.className = cls.join(" ");
      el.tabIndex = i === selected ? 0 : -1;
      el.setAttribute("aria-selected", i === selected ? "true" : "false");

      var label = "Row " + (S.ROW[i] + 1) + ", column " + (S.COL[i] + 1) + ", ";
      if (v[i]) {
        el.textContent = String(v[i]);
        label += v[i] + (given ? ", given" : hintedSet[i] ? ", hint" : "") + (conflicts[i] ? ", conflict" : "");
      } else if (game.notes[i]) {
        var list = S.candidateList(game.notes[i]);
        var html = '<span class="notes" aria-hidden="true">';
        for (var d = 1; d <= 9; d++) {
          var on = list.indexOf(d) !== -1;
          html += "<span" + (on && d === selVal ? ' class="hl"' : "") + ">" + (on ? d : "") + "</span>";
        }
        el.innerHTML = html + "</span>";
        label += "empty, notes " + list.join(" ");
      } else {
        el.textContent = "";
        label += "empty";
      }
      el.setAttribute("aria-label", label);
    }
    boardEl.classList.toggle("paused", paused);
    boardEl.classList.toggle("solved", game.completed);

    var left = S.remainingCounts(v);
    padButtons.forEach(function (p, k) {
      var d = k + 1;
      p.querySelector(".left").textContent = left[d] > 0 ? left[d] : "";
      p.classList.toggle("used-up", left[d] <= 0);
      p.setAttribute("aria-label", (notesMode ? "Note " : "Enter ") + d + (left[d] > 0 ? ", " + left[d] + " left" : ", all placed"));
      p.disabled = paused || game.completed;
    });
    padEl.classList.toggle("notes-mode", notesMode);
    $("notes-btn").setAttribute("aria-pressed", notesMode ? "true" : "false");
    $("notes-state").textContent = notesMode ? "on" : "off";
    ["undo-btn", "erase-btn", "hint-btn", "check-btn", "notes-btn"].forEach(function (id) {
      $(id).disabled = paused || game.completed;
    });
    $("undo-btn").disabled = paused || game.completed || !undoStack.length;
    timerEl.textContent = S.formatTime(game.elapsed);
  }

  function renderPicker() {
    document.querySelectorAll("#mode-seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.mode === game.mode ? "true" : "false");
    });
    document.querySelectorAll("#diff-seg button").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.diff === game.difficulty ? "true" : "false");
    });
    var name = game.difficulty.charAt(0).toUpperCase() + game.difficulty.slice(1);
    var text;
    if (game.mode === "daily") {
      var parts = game.dateKey.split("-").map(Number);
      var date = new Date(parts[0], parts[1] - 1, parts[2]);
      var nice = date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      text = "<strong>Daily " + name + "</strong> · " + nice + " · the same puzzle for everyone today";
    } else {
      text = "<strong>Random " + name + "</strong> · a new puzzle just for you";
    }
    text += " · " + S.clueCount(game.puzzle) + " clues";
    if (game.completed) text += ' · <span class="done">solved ✓</span>';
    $("puzzle-meta").innerHTML = text;
  }

  function renderStats() {
    var stats = load("stats", {});
    var today = S.localDateKey(new Date());
    var html = "";
    S.DIFFICULTIES.forEach(function (d) {
      var s = stats[d] || { solved: 0, best: null };
      var daily = readSavedGame(S.puzzleId("daily", d, today));
      var dailyText = daily && daily.completed ? "Solved ✓" : daily && daily.values.join("") !== daily.puzzle.join("") ? "In progress" : "Not started";
      html += '<div class="stat"><h3>' + d.charAt(0).toUpperCase() + d.slice(1) + "</h3><dl>" +
        "<dt>Solved</dt><dd>" + (s.solved || 0) + "</dd>" +
        "<dt>Best</dt><dd>" + (s.best != null ? S.formatTime(s.best) : "—") + "</dd>" +
        "<dt>Today</dt><dd>" + dailyText + "</dd></dl></div>";
    });
    $("stats").innerHTML = html;
  }

  function setStatus(msg, tone) {
    statusEl.textContent = msg || "";
    statusEl.className = "status" + (tone ? " " + tone : "");
  }

  // ---------- moves ----------
  function snapshot(i) { return { i: i, v: game.values[i], n: game.notes[i] }; }
  function editable(i) { return i >= 0 && game.puzzle[i] === 0 && game.hinted.indexOf(i) === -1; }
  function canPlay() { return game && !paused && !game.completed; }

  function enterDigit(d) {
    if (!canPlay()) return;
    if (!editable(selected)) {
      setStatus(game.puzzle[selected] ? "That's a given number — pick an empty cell." : "That cell was filled by a hint.");
      return;
    }
    var i = selected;
    if (notesMode) {
      if (game.values[i]) { setStatus("Erase the number first to add notes."); return; }
      undoStack.push([snapshot(i)]);
      game.notes[i] ^= 1 << (d - 1);
    } else {
      var changes = [snapshot(i)];
      if (game.values[i] === d) {
        game.values[i] = 0;
      } else {
        game.values[i] = d;
        game.notes[i] = 0;
        // clear this digit from notes in the same row, column and box
        var bit = 1 << (d - 1);
        S.PEERS[i].forEach(function (p) {
          if (game.notes[p] & bit) { changes.push(snapshot(p)); game.notes[p] &= ~bit; }
        });
        cells[i].classList.remove("pop"); void cells[i].offsetWidth; cells[i].classList.add("pop");
      }
      undoStack.push(changes);
    }
    afterMove();
  }
  function erase() {
    if (!canPlay()) return;
    var i = selected;
    if (!editable(i)) return;
    if (!game.values[i] && !game.notes[i]) return;
    undoStack.push([snapshot(i)]);
    game.values[i] = 0;
    game.notes[i] = 0;
    afterMove();
  }
  function undo() {
    if (!canPlay() || !undoStack.length) return;
    var changes = undoStack.pop();
    for (var k = changes.length - 1; k >= 0; k--) {
      var c = changes[k];
      if (game.hinted.indexOf(c.i) !== -1) continue; // hint-filled cells stay filled
      game.values[c.i] = c.v;
      game.notes[c.i] = c.n;
    }
    selected = changes[0].i;
    setStatus("Undone.");
    afterMove(true);
  }
  function hint() {
    if (!canPlay()) return;
    var i = S.pickHintCell(game.values, game.solution, selected);
    if (i < 0) return;
    undoStack = undoStack.filter(function (ch) { return ch[0].i !== i; });
    game.values[i] = game.solution[i];
    game.notes[i] = 0;
    var bit = 1 << (game.solution[i] - 1);
    S.PEERS[i].forEach(function (p) { game.notes[p] &= ~bit; });
    if (game.hinted.indexOf(i) === -1) game.hinted.push(i);
    game.hints++;
    selected = i;
    setStatus("Hint: row " + (S.ROW[i] + 1) + ", column " + (S.COL[i] + 1) + " is " + game.solution[i] + ".", "good");
    afterMove(true);
  }
  function check() {
    if (!canPlay()) return;
    var wrong = [], empty = 0;
    for (var i = 0; i < 81; i++) {
      if (!game.values[i]) empty++;
      else if (game.values[i] !== game.solution[i]) wrong.push(i);
    }
    if (!wrong.length) {
      setStatus("No mistakes so far — " + empty + (empty === 1 ? " cell" : " cells") + " to go.", "good");
      return;
    }
    setStatus(wrong.length + (wrong.length === 1 ? " cell doesn't" : " cells don't") + " match the solution. They're flashing red.", "bad");
    wrong.forEach(function (k) { cells[k].classList.remove("flash"); void cells[k].offsetWidth; cells[k].classList.add("flash"); });
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { cells.forEach(function (c) { c.classList.remove("flash"); }); }, 2500);
  }
  function afterMove(keepStatus) {
    if (!keepStatus) setStatus("");
    if (S.isSolvedBy(game.values, game.solution)) {
      complete();
    } else if (game.values.indexOf(0) === -1) {
      setStatus("The board is full, but something's not right yet. Try Check.", "bad");
    }
    saveGame();
    render();
    if (game.completed) renderPicker();
    focusSelected();
  }

  function complete() {
    game.completed = true;
    var res = S.recordSolve(load("stats", {}), game.difficulty, game.elapsed, game.hints > 0);
    save("stats", res.stats);
    renderStats();
    showCelebration(res.isBest);
    setStatus("Solved in " + S.formatTime(game.elapsed) + ".", "good");
  }

  // ---------- celebration ----------
  function showCelebration(isBest) {
    var name = game.difficulty.charAt(0).toUpperCase() + game.difficulty.slice(1);
    $("celebrate-kind").textContent = (game.mode === "daily" ? "Daily " : "Random ") + name + " · solved";
    $("celebrate-title").textContent = isBest ? "New best time!" : "Well done!";
    $("celebrate-time").textContent = S.formatTime(game.elapsed);
    var note = game.hints ? "Solved with " + game.hints + (game.hints === 1 ? " hint" : " hints") + "." : "No hints needed.";
    if (game.mode === "daily") note += " A new daily puzzle arrives tomorrow.";
    $("celebrate-note").textContent = note;
    var sp = document.querySelector(".sparkles");
    sp.innerHTML = "";
    var colors = ["#b0d6af", "#e8bc7b", "#dcebd6", "#7fa77e", "#f1f2e6"];
    for (var k = 0; k < 28; k++) {
      var dot = document.createElement("i");
      dot.style.left = Math.random() * 100 + "%";
      dot.style.background = colors[k % colors.length];
      dot.style.animationDelay = (Math.random() * 0.8).toFixed(2) + "s";
      sp.appendChild(dot);
    }
    $("celebrate").hidden = false;
    $("celebrate-new").focus();
  }
  function hideCelebration() { $("celebrate").hidden = true; }

  // ---------- timer & pause ----------
  function setPaused(p) {
    paused = p;
    $("pause-cover").hidden = !p;
    $("pause-btn").setAttribute("aria-pressed", p ? "true" : "false");
    $("pause-btn").setAttribute("aria-label", p ? "Resume" : "Pause");
    render();
    if (p) saveGame();
  }
  setInterval(function () {
    if (!game || paused || game.completed || document.hidden) return;
    if (!$("celebrate").hidden) return;
    game.elapsed++;
    timerEl.textContent = S.formatTime(game.elapsed);
    if (game.elapsed % 5 === 0) saveGame();
  }, 1000);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && game && !game.completed && !paused) setPaused(true);
  });
  window.addEventListener("pagehide", saveGame);

  // ---------- input ----------
  function focusSelected() {
    if (document.activeElement && document.activeElement.classList.contains("cell") && cells[selected]) cells[selected].focus({ preventScroll: true });
  }
  function onCellClick(e) {
    if (paused) return;
    selected = Number(e.currentTarget.dataset.index);
    render();
    cells[selected].focus({ preventScroll: true });
  }
  function move(dr, dc) {
    var r = (S.ROW[selected] + dr + 9) % 9, c = (S.COL[selected] + dc + 9) % 9;
    selected = r * 9 + c;
    render();
    cells[selected].focus({ preventScroll: true });
  }
  document.addEventListener("keydown", function (e) {
    if (!game) return;
    if (!$("celebrate").hidden) { if (e.key === "Escape") hideCelebration(); return; }
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.altKey) return;
    var k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "Z")) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey) return;
    if (paused) return;
    var onCell = t && t.classList && t.classList.contains("cell");
    var inBoard = onCell || t === document.body || !t;
    if (/^[1-9]$/.test(k)) { e.preventDefault(); enterDigit(Number(k)); return; }
    if (k === "Backspace" || k === "Delete" || k === "0") { e.preventDefault(); erase(); return; }
    if (k === "n" || k === "N") { e.preventDefault(); toggleNotes(); return; }
    if (k === "z" || k === "Z") { e.preventDefault(); undo(); return; }
    if (!inBoard) return; // let arrow keys work normally on buttons outside the board
    if (k === "ArrowUp") { e.preventDefault(); move(-1, 0); }
    else if (k === "ArrowDown") { e.preventDefault(); move(1, 0); }
    else if (k === "ArrowLeft") { e.preventDefault(); move(0, -1); }
    else if (k === "ArrowRight") { e.preventDefault(); move(0, 1); }
  });
  function toggleNotes() {
    if (!canPlay()) return;
    notesMode = !notesMode;
    setStatus(notesMode ? "Notes on: numbers go in as pencil marks." : "Notes off.");
    render();
  }

  $("undo-btn").addEventListener("click", undo);
  $("erase-btn").addEventListener("click", erase);
  $("notes-btn").addEventListener("click", toggleNotes);
  $("hint-btn").addEventListener("click", hint);
  $("check-btn").addEventListener("click", check);
  $("pause-btn").addEventListener("click", function () { if (game && !game.completed) setPaused(!paused); });
  $("resume-btn").addEventListener("click", function () { setPaused(false); cells[selected].focus({ preventScroll: true }); });
  $("mistakes-toggle").checked = !!settings.showMistakes;
  $("mistakes-toggle").addEventListener("change", function (e) {
    settings.showMistakes = e.target.checked;
    save("settings", settings);
    render();
  });
  $("mode-seg").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || !game) return;
    saveGame();
    if (b.dataset.mode === "daily") openDaily(game.difficulty); else openRandom(game.difficulty, false);
  });
  $("diff-seg").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b || !game) return;
    saveGame();
    if (game.mode === "daily") openDaily(b.dataset.diff); else openRandom(b.dataset.diff, false);
  });
  $("new-random").addEventListener("click", function () { if (game) { saveGame(); openRandom(game.difficulty, true); } });
  $("celebrate-new").addEventListener("click", function () { hideCelebration(); openRandom(game.difficulty, true); });
  $("celebrate-close").addEventListener("click", function () { hideCelebration(); render(); });
  $("celebrate").addEventListener("click", function (e) { if (e.target.id === "celebrate") hideCelebration(); });

  // ---------- boot ----------
  buildBoard();
  var cur = load("current", null);
  var startDiff = cur && S.DIFFICULTIES.indexOf(cur.difficulty) !== -1 ? cur.difficulty : "medium";
  if (cur && cur.mode === "random") openRandom(startDiff, false);
  else openDaily(startDiff);
})();
