/**
 * Site branding — the one place to change the site name and tagline.
 * After editing, run `npm run rebrand` to copy these into index.html and README.md
 * (page title, header, meta description).
 *
 * Game code never uses the site name for storage, so renaming the site
 * (for example to a multi-game collection) keeps everyone's saved progress.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.SiteConfig = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
    name: "somosudoku",
    tagline: "Nine boxes. One calm mind.",
    description: "A calm daily sudoku in Easy, Medium and Hard, with pencil marks, hints and saved progress.",
    // Games on this site, in header-tab order. Paths are relative to the site root.
    games: [
      { id: "sudoku", title: "Sudoku", path: "./" },
      { id: "words", title: "Letterfield", path: "words/" },
    ],
  };
});
