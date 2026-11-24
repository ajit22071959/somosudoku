# somosudoku

A calm sudoku for the browser: a daily puzzle in Easy, Medium and Hard that is the same for everyone on a given day, plus endless random puzzles. Pencil marks, hints, mistake checking, a pausable timer, and progress that survives a reload.

Live site: https://ajit22071959.github.io/somosudoku/

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

## Layout

```
index.html               page shell (header, board, controls)
site.config.js           site name, tagline, description, list of games
shared/base.css          the shared somo look (dark green #101715, soft green gradients)
games/sudoku/sudoku.js   pure logic: seeding, generator, solver, grader, helpers
games/sudoku/game.js     the game UI
games/sudoku/sudoku.css  board and control styles
scripts/rebrand.js       copies site.config.js into index.html and this README
tests/                   Node tests
```

Saved games use the key prefix `somo.sudoku.`, which belongs to the game, not the site name. Renaming the site, or moving sudoku into a collection of games, keeps everyone's progress.

## Renaming the site

Edit `name`, `tagline` and `description` in `site.config.js`, then run:

```bash
npm run rebrand
```

The script updates the page title, meta description, header and the heading of this README. A test fails if `index.html` is out of step with the config.

## Running tests

Node.js 18 or newer. No packages to install.

```bash
npm test
```

The tests cover seeding and the daily puzzle (stable per date and difficulty, pinned for one date), the solver (unique, multiple and impossible grids), the generator (unique solution, clue ranges, grading, symmetry, speed), conflict detection, hints, time formatting, stats, and the rebrand script.

## Local preview

```bash
python3 -m http.server 5070
```

Then open http://127.0.0.1:5070/.
