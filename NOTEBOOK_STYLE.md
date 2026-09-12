# Notebook style

An optional look (Settings → Appearance → Style → **Notebook**) that makes
Meraki feel like a school notebook: hand-drawn rules, pen circles, crossed-off
days. In the dark theme the pen turns to chalk.

## Rules

1. **Off by default.** `config.style` defaults to `'normal'`; nothing in this
   doc renders unless `<html>` has `.style-notebook`.
2. **Readability counts.** Marks, rules and headings may look handwritten.
   Data text (titles, times, grades, names) stays in the normal UI font, and a
   mark never runs through text (e.g. calendar chips get an opaque backing).
3. **Dark theme = chalkboard.** Sketch marks go through the `#sketch-chalk`
   grain filter (`--sketch-filter`). Text is never filtered.
4. **CJK handwriting font: ZCOOL KuaiLe** (Google Fonts). Picked over Long
   Cang (too thin at small sizes), Ma Shan Zheng / Zhi Mang Xing (brush and
   cursive, hard to read) and LXGW WenKai (readable, but reads as a book face,
   not handwriting; Google only hosts the TC build). `--font-hand` lists
   Recursive first, so Latin and digits stay Recursive and only CJK falls
   through. The stylesheet is injected only when Notebook is turned on.
5. **Ink colors carry meaning; the highlighter stays scarce.** Navy pen draws
   structure and ticks, red ink is the teacher's pen (crossing things off,
   circling grades), blue ink marks today and your current pick (in the dark
   theme these become coral and sky-blue chalk). The highlighter still only
   marks what needs attention or is selected. Motion respects
   `prefers-reduced-motion` (the global rule in styles.css).

## Shared kit

- `src/sketch.js`: seeded, pure path generators, tested in `test/sketch.test.js`.
  Always seed by what the mark belongs to (e.g. `` `today:${iso}` ``), because
  renderBody() rebuilds the DOM on every state change.
  - `seededRandom(seed)`
  - `sketchLine(x1, y1, x2, y2, rand, { bow, overshoot, jitter })`: rules, strikes, slashes, underlines
  - `sketchCircle(cx, cy, rx, ry, rand)`: pen loop that overshoots a full turn
  - `sketchBox(x, y, w, h, rand, opts)`: four strokes with crossing corners
  - `sketchGrid(cols, rows, rand, opts)`: hand-ruled table
  - `sketchTick(x, y, size, rand)`: check mark
  - `sketchSvg(paths, { viewBox, stretch, evenStroke, draw, className })`: DOM wrapper
- CSS: `.sketch` (base), `.sketch-even` (constant stroke width while
  stretched), `.sketch-draw` (draw-in; tune with `--sketch-draw-ms`,
  `--sketch-stagger`).
- `evenStroke` and `draw` don't mix: with non-scaling strokes Chromium
  measures dashes in screen space and the draw-in stops half-way, so
  `sketchSvg` ignores `draw` for even-stroke marks. Marks that animate
  (selection box, underline) scale their strokes instead.
- Tokens: `--font-hand`, `--sketch-ink`, `--sketch-grid`, `--sketch-ink-red`,
  `--sketch-ink-blue`, `--sketch-filter`, `--sketch-today-bg`.
- Animate on arrival only. Decide what's new from the previous render (see
  `marksToDraw` in calendar.js and `freshView` in main.js's renderBody), or
  every background refresh replays the drawing.

## Status

### Done

- [x] Shared kit (above) and the Style setting
- [x] **Calendar grid view:** hand-ruled grid, handwritten month label with a
      pen underline, today written and circled in blue ink over a
      highlighter swipe (sky-blue chalk and no swipe on the dark board, since
      the solid dark mark would swallow the circle), past days of this month
      crossed off in red ink, a navy pen box around the selected day,
      smudge hover, chalk in dark mode, handwritten day-panel title

- [x] **Overview:** Done items crossed out in red ink, with a pen tick
- [x] **Loading checklist:** hand-drawn checkboxes, ticked as each step finishes
- [x] **Grades:** Overview's overall grade and each Analytics class grade
      circled in red; "+3% above target" as a margin note with an arrow
- [x] **Attendance:** a tally card (groups of five, count alongside) above the rows
- [x] **Announcements:** paper cards taped to a corkboard
- [x] **Messages:** a paper plane draws in and flies off the "Message sent" toast
- [x] **Check-in:** doodled mood faces; the chosen one circled in blue ink
- [x] **Empty states:** a star-and-spiral margin doodle instead of the `·` icon
- [x] **My Record:** detentions as pink punched slips (all locales, CSS only,
      no new strings)
- [x] **Calendar list view:** merged with assignments and reminders and
      grouped by day in both styles (today's header highlighted, past days
      folded under "Earlier"); Notebook adds kind-colored highlighter swipes
      for the next 7 days (events blue, assignments orange, reminders green),
      red cross-outs on past items, and a blue "you are here" line

### To do

Nothing queued.

### Decided against

- **Chalkboard, part 2** (a board-colored dark background and chalky
  headings): the chalk marks carry the dark theme on their own.
