/* Letterfield worker: loads the word list, builds the trie, and finds the computer's moves. */
/* global WordLogic */
importScripts("wordlogic.js");
var trie = null;

self.onmessage = function (e) {
  var msg = e.data || {};
  if (msg.type === "init") {
    Promise.all([fetchText(msg.words), fetchText(msg.skip).catch(function () { return ""; })])
      .then(function (texts) {
        trie = WordLogic.buildTrie(texts[0], texts[1]);
        // Send a copy so the page can check words without building its own.
        self.postMessage({ type: "ready", trie: { letter: trie.letter, term: trie.term, first: trie.first, next: trie.next, size: trie.size } });
      })
      .catch(function (err) { self.postMessage({ type: "error", error: String(err && err.message || err) }); });
  } else if (msg.type === "move") {
    var t0 = Date.now();
    var moves = WordLogic.generateMoves(msg.board, msg.rack, trie);
    var pick = WordLogic.chooseMove(moves, msg.level, Math.random);
    self.postMessage({ type: "move", id: msg.id, move: pick, count: moves.length, ms: Date.now() - t0 });
  }
};

function fetchText(url) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error("Couldn't load " + url + " (" + r.status + ")");
    return r.text();
  });
}
