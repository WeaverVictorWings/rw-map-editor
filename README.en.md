# Rusted Warfare Map Editor

[![Release](https://img.shields.io/github/v/release/WeaverVictorWings/rw-map-editor)](https://github.com/WeaverVictorWings/rw-map-editor/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/WeaverVictorWings/rw-map-editor/total)](https://github.com/WeaverVictorWings/rw-map-editor/releases)
[![License](https://img.shields.io/github/license/WeaverVictorWings/rw-map-editor)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-Android%20%7C%20Windows%20%7C%20Browser-orange)
![UI languages](https://img.shields.io/badge/UI%20languages-11-blue)

[中文](README.md) · [繁體中文](README.zh-TW.md) · **English** · [日本語](README.ja.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Features](docs/FEATURES.en.md) · [Changelog](CHANGELOG.md) · [Report an issue](https://github.com/WeaverVictorWings/rw-map-editor/issues/new/choose)

A free, unofficial editor for **Rusted Warfare**: a **map editor** and a **mod editor**. Android first; it also runs in any desktop browser.

![Editor](docs/screenshot-en.png)

## What it does

**Maps**
- Pick grass, water or sand and paint; coasts and cliffs connect by themselves.
- Spawn points and resource pools in one tap; paint half a map and mirror it.
- Triggers are "when ... then ..." cards, no property names to remember.
- Press **Playable?** to check the map; most problems can be fixed in one tap.
- Random generation, image to map and a guided wizard get you a playable map in minutes.

**Mods**
- Open a `.rwmod` and edit units with forms instead of raw ini.
- Copy a unit, generate light / heavy variants, scale values with one tap (×2).
- Comparison table and battle simulation to see whether a new unit is too strong.
- Check for missing sprites and sounds and broken references, then pack a `.rwmod`.

The interface comes in 11 languages.

## Get started in 3 steps

1. Download from [Releases](https://github.com/WeaverVictorWings/rw-map-editor/releases/latest): install `rw-map-editor.apk` on a phone, or unzip `rw-map-editor-web.zip` on a PC and double-click `Start-Editor.bat`.
2. Open any Rusted Warfare map you already have (.tmx) once; the editor takes the tile assets from it (no game assets are bundled).
3. Create or edit a map, press **Playable?**, then **Save to game folder** and play.

The built-in tutorial (9 lessons: 7 for maps, 2 for mods) and the **?** next to every tool explain the rest.

## FAQ

**Purple or flat-coloured tiles after opening a map?** The map uses tile images from the game or from external files. It can still be edited and the game is not affected; use "Map → Add missing tile images" to see the real tiles.

**"Tile assets needed" when creating a map?** The editor ships no game assets. Open any map exported from the game once and it will pick them up.

**Where is the mod editor?** Pick "Mod editor" on the start screen or use the button in the top bar. Its estimates (DPS, power, battle simulation) are rough; trust the game.

## Feedback and contributing

- Bugs and ideas: [open an issue](https://github.com/WeaverVictorWings/rw-map-editor/issues/new/choose).
- Translations: see [CONTRIBUTING.md](CONTRIBUTING.md).
- If it helps you, a Star on the repository or a mention to a friend helps others find it.
- Code: see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

Author: [@WeaverVictorWings](https://github.com/WeaverVictorWings). License: [MIT](LICENSE). The game's assets belong to its developer; this repository contains none.
