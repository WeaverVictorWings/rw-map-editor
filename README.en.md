# Rusted Warfare Map Editor

[![Release](https://img.shields.io/github/v/release/WeaverVictorWings/rw-map-editor)](https://github.com/WeaverVictorWings/rw-map-editor/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/WeaverVictorWings/rw-map-editor/total)](https://github.com/WeaverVictorWings/rw-map-editor/releases)
[![License](https://img.shields.io/github/license/WeaverVictorWings/rw-map-editor)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-Android%20%7C%20Windows%20%7C%20Browser-orange)
![UI languages](https://img.shields.io/badge/UI%20languages-11-blue)

[中文](README.md) · **English** · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/WeaverVictorWings/rw-map-editor/issues/new/choose)

An unofficial map editor made just for **Rusted Warfare**. Android first; the same editor runs in any desktop browser.

> Beginners make a playable map in minutes; veterans build huge maps, city-capture, survival and mission maps.

![Editor](docs/screenshot-en.png)

## Get started in 3 steps

1. Download from [Releases](https://github.com/WeaverVictorWings/rw-map-editor/releases/latest): install `rw-map-editor.apk` on your phone, or unzip `rw-map-editor-web.zip` on PC and double-click `Start-Editor.bat`.
2. Open any Rusted Warfare map you already have (.tmx) once — the editor takes the tile assets from it (no game assets are bundled).
3. Create or edit a map, press **Playable?** to check it, then **Save to game folder** and play.

The built-in 4-lesson tutorial and the **?** next to every tool explain everything.

## Highlights

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

**UI languages**: 简体中文, English, Русский, Português (BR), Español, Bahasa Indonesia, Türkçe, 繁體中文, Українська, Français, 日本語. English and Traditional Chinese are complete; the others cover menus, buttons and short texts, with a few long help paragraphs in English. Fixes are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## Player count

The engine supports **100 teams**, but normal rooms only have **10**: units and triggers of team 11+ are skipped. Bigger maps need a server room that supports more players (e.g. RW-HPS with a larger `maxPlayer`). The checker warns about this.

## Development

The web part is plain JavaScript, no build step:

```bash
python3 -m http.server 8765 --directory www   # open http://localhost:8765
```

Android builds are produced by GitHub Actions on every push to `main` and published as a release named after `package.json`'s version.

## Author

[@WeaverVictorWings](https://github.com/WeaverVictorWings) — if the editor helps you, a ⭐ Star helps other players find it.

## License

[MIT](LICENSE). Rusted Warfare game assets belong to their developer; this repository contains none.
