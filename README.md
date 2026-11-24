# somosudoku

A calm sudoku for the browser: a daily puzzle in Easy, Medium and Hard that is the same for everyone on a given day, plus endless random puzzles. Pencil marks, hints, mistake checking, a pausable timer, and progress that survives a reload.

Live site: https://ajit22071959.github.io/somosudoku/

The site has two games, linked by tabs in the header:

- **Sudoku** at `/` (below).
- **Letterfield** at `/words/`, a crossword-style word-building game for two (see [Letterfield](#letterfield)).

## What it does

- **Daily puzzles.** Each difficulty has one puzzle per day, made from a seed of the visitor's local date (`YYYY-MM-DD`) and the difficulty, so everyone gets the same grid on the same day. **New random puzzle** makes a fresh one at the chosen difficulty.
- **Real puzzles.** Every grid has exactly one solution (checked with a backtracking solver). Difficulty is set by clue count and by the techniques a human needs:
  - Easy: 36–40 clues, solvable with singles.
  - Medium: 28–32 clues, needs hidden singles.
  - Hard: 22–27 clues, needs locked candidates or naked/hidden pairs.
  Generation takes a few milliseconds (under 100 ms worst case on a laptop), so there is nothing pregenerated.
- **Playing.** Tap a cell and use the number pad, or the keyboard: `1`–`9` to enter, arrow keys to move, `Backspace`/`Delete`/`0` to erase, `N` for notes, `Ctrl/⌘+Z` (or `Z`) to undo. Entering a number again clears it. Placing a number removes it from the notes in its row, column and box.
- **Help.** The row, column and box of the selected cell are shaded, and so is every cell with the same number. Clashing numbers are always shown in red. **Highlight mistakes as I go** also marks numbers that don't match the solution. **Check** flashes any wrong cells, and **Hint** fills the selected cell (or a random empty one) with the right number.
- **Timer and pause.** Pausing hides the board. The timer also pauses when the tab is hidden.
- **Saved progress and stats.** Each puzzle's progress is kept in `localStorage`, so a reload continues where you left off. Stats show how many puzzles of each difficulty you've solved, your best time (solves without hints only), and whether today's daily puzzle is done.
- **Phones.** Built for 390 px screens and up, with a 9-across number pad and large buttons. Cells and buttons have screen-reader labels.

Puzzles are made in the browser. Nothing is sent anywhere.

## Letterfield

A turn-based word game on a 15 × 15 board, for two people sharing one device or one person against the computer. It's an original game name and board layout built on the familiar mechanics of this kind of game.

- **Board and tiles.** 15 × 15 with premium squares (2L, 3L, 2W, 3W and a double-word start star) in Letterfield's own symmetric layout. 100 tiles in the usual English letter mix with the usual point values, including 2 blanks that can be any letter and score 0. Racks hold 7 tiles.
- **Rules.** The first word covers the centre star; later words must join the board. Tiles go in one row or column with no gaps. Every word formed must be in the word list. Using all 7 tiles adds 50. You can swap tiles (while 7 or more are in the bag) or pass. The game ends when the bag is empty and someone plays their last tile (they gain the value of the other rack, which the other player loses), or after six scoreless turns in a row (everyone loses what's left on their rack).
- **Playing.** Tap a rack tile and then a square, or drag it. Tap a new tile on the board (or drag it back) to take it back. On a keyboard, click a square and type; Space flips across/down, Backspace takes back the last tile, Enter plays, Esc recalls everything. **Shuffle**, **Recall**, **Swap** and **Pass** sit under the rack. As you place tiles the status line shows the words and the score, or which words aren't in the list, and the Play button shows the score.
- **Two players.** Names are optional. After each turn a "Pass the device to …" screen hides the board and racks until the next player taps to show their tiles.
- **Against the computer.** Easy plays short words without blanks and aims for 20–50% of its best score; Medium aims for 55–85%; Hard always plays the highest-scoring move. Moves are found with the anchor-and-cross-check method over a trie, in a web worker, in a few milliseconds on a laptop. The computer never plays the handful of slurs listed in `games/words/ai-skip.txt`; people can still play them, since they're in the official list.
- **Also:** scoreboard, move history, tiles left in the bag, the letters you haven't seen yet, and win/loss record and best move/game against the computer. The game saves after every move (`somo.words.game` in `localStorage`), so a reload carries on.

### Word list

`games/words/enable.txt` is the **ENABLE** word list (Enhanced North American Benchmark Lexicon, by Alan Beale and M. Cooper), which is in the public domain. It was taken from https://github.com/dolph/dictionary (`enable1.txt`) and trimmed to the 168,551 words of 2–15 letters. About 1.6 MB, 440 KB gzipped as GitHub Pages serves it. The worker loads it once and the browser caches it.

## Layout

```
index.html               sudoku page (header, board, controls)
words/index.html         Letterfield page
site.config.js           site name, tagline, description, list of games
shared/base.css          the shared somo look (dark green #101715, soft green gradients)
games/sudoku/sudoku.js   pure logic: seeding, generator, solver, grader, helpers
games/sudoku/game.js     the game UI
games/sudoku/sudoku.css  board and control styles
games/words/wordlogic.js Letterfield pure logic: bag, trie, move checking, scoring, move generator, AI levels, turns
games/words/worker.js    loads the word list and finds the computer's moves off the main thread
games/words/game.js      the Letterfield UI
games/words/words.css    Letterfield styles
games/words/enable.txt   ENABLE word list (public domain)
games/words/ai-skip.txt  words the computer won't play
scripts/rebrand.js       copies site.config.js into both pages and this README
tests/                   Node tests
```

Saved games use the key prefix `somo.sudoku.`, which belongs to the game, not the site name. Renaming the site, or moving sudoku into a collection of games, keeps everyone's progress.

## Renaming the site

Edit `name`, `tagline` and `description` in `site.config.js`, then run:

```bash
npm run rebrand
```

The script updates the page title, meta description and header of both pages, and the heading of this README. A test fails if `index.html` is out of step with the config.

## Running tests

Node.js 18 or newer. No packages to install.

```bash
npm test
```

The Letterfield tests cover the bag and swaps, the premium layout, the dictionary and skip list, move checking and scoring (cross words, premiums, blanks, the 50 bonus), the move generator (scores match the checker for every move, blanks, speed with two blanks), the three computer levels, and turns and end-of-game scoring over full computer games. The sudoku tests cover seeding and the daily puzzle (stable per date and difficulty, pinned for one date), the solver (unique, multiple and impossible grids), the generator (unique solution, clue ranges, grading, symmetry, speed), conflict detection, hints, time formatting, stats, and the rebrand script.

## Local preview

```bash
python3 -m http.server 5070
```

Then open http://127.0.0.1:5070/ (sudoku) or http://127.0.0.1:5070/words/ (Letterfield). Letterfield needs a server rather than `file://`, because it fetches the word list.
