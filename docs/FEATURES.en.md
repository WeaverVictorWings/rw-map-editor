# Features

Full feature list. New here? Start with the [README](../README.en.md).

## Map editor

**Painting**
- Terrain brush with **automatic transitions** (grass next to water gets beaches and shallows by itself), rectangle, ellipse, bucket, eyedropper, primary/secondary terrain.
- **Color blocks**: any color from a palette (RGB / HSV / hex / eyedropper) with a required in-game property — land, ford, shallow, deep water, impassable, lava.
- Items with shapes (brush, rectangle, ellipse, line, bucket), density and minimum spacing; random mixed brush.
- Unit palette with icons, categories and search; place a whole row or block at once. Up to **100 teams** (engine limit).
- Symmetric drawing: left-right, top-bottom, center rotation, four-way.

**Whole-map tools**
- **Auto detail**: 10 terrain styles, a modifier stack, 4 variants side by side, biome / height / detail brushes, custom rules, learn from a reference map, road tool, tactical modules, theme switch.
- Random generation with share codes, image to map, proportional scale (never duplicates units or pools), mirror, resize canvas, picture decals, tracing reference.
- Stamp library (standard base, expansions, chokepoints, bridgeheads, lakes…), copy from another map, stitch several maps into one.

**Triggers without code**
- Every trigger is a “When … then …” card with a plain-language summary; logic map of all links.
- Templates: city capture, survival waves, step-by-step missions, plus common blocks (timed reinforcements, stronghold, creep camps…).
- Text tool (mapText shown in the editor), battle log editor, multi-language map text (`text_en`, `text_ru`…).

**Checking & sharing**
- **Playable?** check with one-tap fixes; balance report by real walking routes; opening simulation (seconds until first contact, front lines).
- Playtest checklist with a test log, map health score, version diff against snapshots.
- Save straight into the game folder with a same-name cover image; map library; batch processing; pack a collection as `.rwmod`; import Mods' units and tilesets.

**New in 2.6**
- **Mod editor tools**: copy / variants / value scaling / wizard / weapon templates, comparison table, scatter plot, battle simulation, build tree, rename with references, turret position dragging, changelog, score and fix, asset check.

**New in 2.5**
- **Mod editor (phase 1)**: open `.rwmod`/zip/folder, browse units, edit by form or source, check for problems, pack `.rwmod`.

**New in 2.4**
- Resource pools are truly 1×1 (they can sit side by side), **one-tap balance**, design wizard, curve tool for rivers and roads, smooth / erode / noise brushes, feathered paste, snapping and precision drawing.
- **Trigger simulator** (see when each trigger fires without launching the game), trigger template library, firepower coverage analysis, passage bottleneck map, naval check, distance and range circles.
- Bulk unit editing, bulk replace, find and jump, layer panel, zone manager, history panel (undo just one middle step), multiple reference images, team colors and alliances.
- Workshop package, one-tap map description, screenshot export, project files (.rwproj), auto backup, offline web version (PWA), phone experience mode.

**UI languages**: 简体中文, English, Русский, Português (BR), Español, Bahasa Indonesia, Türkçe, 繁體中文, Українська, Français, 日本語. English and Traditional Chinese are complete; the others cover menus, buttons and short texts from before 2.4 (new 2.4 features show English for now), with a few long help paragraphs in English. Fixes are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Player count

The engine supports **100 teams**, but normal rooms only have **10**: units and triggers of team 11+ are skipped. Bigger maps need a server room that supports more players (e.g. RW-HPS with a larger `maxPlayer`). The checker warns about this.

## Development

The web part is plain JavaScript, no build step:

```bash
python3 -m http.server 8765 --directory www   # open http://localhost:8765
```

Android builds are produced by GitHub Actions on every push to `main` and published as a release named after `package.json`'s version.
