## 铁锈地图编辑器 3.5.0

**下载**
- 安卓：`rw-map-editor.apk`（可直接覆盖安装）。电脑：`rw-map-editor-web.zip`，解压后双击 `Start-Editor.bat`。

**这一版：交付前自己就能把关**
- 触发器面板新增「工具箱」：一页红黄绿的交付检查，地形连通（浅水相连的陆块、海峡宽度、小岛、环绕、河流）、文本（全角标点、断句、覆灭文本草稿、开场压缩）、兵力（对照表、按档放兵、舰队）、触发器速记语法与模板、城市/势力表。
- 画河、画山脉（自动留山口）、岛链、区域放大、地貌贴花；高程栅格与国界导入。
- 地图叠加层：海峡宽度、仅浅水连通处、兵力热力、命名区域；按队伍显示/隐藏单位。
- 触发器列表：分组折叠、多选批量改、颜色标签。
- 全部没有在真实游戏里验证；逐条完成情况见 docs/ROADMAP-3.5.md。

完整说明见 CHANGELOG.md。

---

## Rusted Warfare Map Editor 3.5.0 (English)

**Download**
- Android: `rw-map-editor.apk` (installs over the old version). PC: `rw-map-editor-web.zip`, unzip and double-click `Start-Editor.bat`.

**Check your own map before you hand it over**
- A new “Toolbox” on the Triggers panel: a one-page red/yellow/green delivery check; terrain connectivity (shallow-only links, strait width, small islands, circumnavigation, rivers); text tools (fullwidth punctuation, sentence breaks, elimination-text drafts, opening compression); forces (comparison table, placement by tier, fleets); trigger shorthand and templates; city / faction tables.
- Draw rivers, mountain ridges (with passes), island chains, regional zoom and terrain decals; import elevation rasters and country borders.
- Map overlays: strait width, shallow-only links, force heat, named zones; show / hide units by team.
- Trigger list: group folding, multi-select bulk edit, colour tags.
- None of it has been verified in the real game; see docs/ROADMAP-3.5.md for the per-item status.

See CHANGELOG.md for details.

---

## 铁锈地图编辑器 3.2.0

**下载**
- 安卓：`rw-map-editor.apk`（可直接覆盖安装）。电脑：`rw-map-editor-web.zip`，解压后双击 `Start-Editor.bat`。

**这一版：少做重复劳动，更好看，更好分享**
- 派生向导（更快/更肉/更能打）、检查结果逐条“修复”、导入精灵图自动切帧、批量改多个单位、复制粘贴一段。
- 单位战力和性价比排名、关系图、全局搜索、字段帮助搜索、音效试听。
- 导出图鉴网页（图片内嵌）、和旧版对比生成公告稿；手机上长按单位有菜单。
- 没做：Mod 与地图联动、一键部署、触发器流程图编辑（需要真机和游戏里验证）。

完整说明见 CHANGELOG.md。

---

## Rusted Warfare Map Editor 3.2.0 (English)

**Download**
- Android: `rw-map-editor.apk` (installs over the old version). PC: `rw-map-editor-web.zip`, unzip and double-click `Start-Editor.bat`.

**Less repetitive work, clearer, easier to share**
- Derive wizard (faster / tougher / stronger), per-issue “Fix” buttons in the check list, sprite import with automatic frame slicing, batch edit across units, copy / paste a section.
- Per-unit power and value rank, relation graph, search everywhere, field help search, audio preview.
- Export a gallery web page (images embedded), compare with an older version to get an announcement; long-press a unit on a phone for a menu.
- Not done: Mod-to-map linking, one-tap deploy, a trigger flow editor (need real-device and in-game verification).

Full details in CHANGELOG.md.

---

## 铁锈地图编辑器 3.1.1

复查修复：“整理全部格式”和翻译表导回可能盖掉刚改的内容；整理格式重复写注释；补全多加冒号。其余同 3.1.0（见下）。

---

## Rusted Warfare Map Editor 3.1.1 (English)

Bug fixes from a review of 3.1: “Format all files” and translation import could overwrite edits you had just made; Format duplicated a comment after a section header; completion added a second colon. Everything else is as in 3.1.0 (below).

---

## 铁锈地图编辑器 3.1.0

**下载**
**下载**

**这一版：Mod 编辑器更能读、更准、更好写**
- 用 5 个真实大 Mod（最大 184 MB、777 个单位）测过兼容性，检查不再乱报错；支持文件名末尾带 “/” 的 rwmod、copyFrom 指向模板文件。
- 源码模式：边写边检查（点一条跳到那一行）、键名/选项/弹道名补全、整理格式。
- 新工具：翻译表（CSV 导出/导回）、单位图鉴、体检报告、整理全部格式。
- 新增命令行和 GitHub Action（lint / 图鉴 / 对比 / 打包）。
- 没做：一键部署到游戏、地图里放 Mod 单位（需要真机和游戏里实验）。

完整说明见 CHANGELOG.md。

---

## Rusted Warfare Map Editor 3.1.0 (English)

**Download**
- Android: `rw-map-editor.apk` (installs over the old version). PC: `rw-map-editor-web.zip`, unzip and double-click `Start-Editor.bat`.

**Mod editor: reads more mods, checks more accurately, easier to write**
- Tested against 5 real large mods (up to 184 MB / 777 units): far fewer false alarms; supports rwmods whose entry names end with “/” and copyFrom pointing at template files.
- Source mode: live diagnostics (tap one to jump to the line), completion for keys / enum values / projectile names, and Format.
- New tools: translation CSV export/import, unit gallery, health report, format all files.
- New command line and GitHub Action (lint / gallery / diff / pack), same checks as the web editor.
- Not done: one-tap deploy to the game and placing Mod units on maps (need real-device and in-game experiments).

Full details in CHANGELOG.md.

---

## 铁锈地图编辑器 3.0.0

**下载**
- 安卓：`rw-map-editor.apk`（可直接覆盖安装）。电脑：`rw-map-editor-web.zip`，解压后双击 `Start-Editor.bat`。

**这一版：好上手，也更让人放心**
- 新手默认精简界面，高级功能用 Ctrl+K 搜索；第一次使用有三步引导。
- 新增“资源池周围加一圈”“重新排布出生点”，先预览再应用，一步撤销。
- 新增“我的数据在哪”、一键反馈（自动复制诊断信息）、载入后检查有没有内容无法原样保留。
- 首页可以“继续编辑”，界面质感调整。

完整说明见 CHANGELOG.md。

---

## Rusted Warfare Map Editor 3.0.0 (English)

**Download**
- Android: `rw-map-editor.apk` (installs over the old version). PC: `rw-map-editor-web.zip`, unzip and double-click `Start-Editor.bat`.

**Easier to start, easier to trust**
- New users get a simple interface by default (advanced features are still found with Ctrl+K) and a three-step first-run guide.
- New: “Add a ring around resource pools” and “Re-lay out spawns” — preview first, one undo step.
- New: “Where is my data”， one-tap feedback that copies diagnostics, and a check after loading that warns if something cannot be kept as it was.
- “Continue editing” on the start screen and a refreshed look.

Full details in CHANGELOG.md.
