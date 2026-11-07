# RWKit(质检套件)3.4.0

同一套代码两处使用:**命令行** `node scripts/rwkit.mjs …`(不需要浏览器和编辑器服务)和**编辑器里的「质检套件…」面板**(`kit/` 通过 `node scripts/sync-kit.mjs` 同步到 `www/js/kit/`)。

## 命令
```
node scripts/rwkit.mjs lint 地图.tmx --rules 规则.json   # 全套质检,有 error 时退出码为 1
node scripts/rwkit.mjs open 地图.tmx                       # 开局 30 秒模拟:有无刷屏
node scripts/rwkit.mjs scen 地图.tmx --city 12 --team 3 --fail 1   # 打掉第 12 座城的指挥中心 → 某队占领 → 看战报
node scripts/rwkit.mjs remap 地图.tmx --swap 0,1 -o 新.tmx # 互换队伍号(单位+触发器),默认不覆盖
node scripts/rwkit.mjs teams 地图.tmx | route … | wrap "文本"
node kit/tests/kit.test.mjs 正常地图.tmx                   # 回归:故意弄坏地图,验证质检抓得到
```
## 规则文件(rules.json)
`teams` 队伍数上限 · `mapSize:[w,h]` · `forbidClasses`(lava/cliff/bigcliff/water/shallow)· `forbidGids` · `regions:[{name,box:[x0,y0,x1,y1],forbidClasses}]` · `factions:[{team,box,mustAllInside}]` · `noUnits:["seaFactory"]` · `text:{lineMax,linesMax,banned:["新势力"]}` · `openMsgMax` · `sources:[依赖文件]`(输出比它们旧会提示重新导出)。

## 检查代码
G01 名字重复 · G02 引用不存在 · G03 属性格式(时间 `10m`、hsl 颜色、整数/布尔)· G04 未知属性 · G05 零面积检测区 · G06 team 非法 · G07 刷兵语法/未知选项 · G08 多来源默认「或」提示 · G09 activatedBy 成环 · G10 区域在图外 · G12 allToActivate 无意义 · T01–T06 文本(超长行/行数/禁用词/重复句/完全相同)· F01 海军工厂不在水边 · F02 舰船不在水上 · F03/F04 站位不可通行 · N01 孤岛(陆路不通)· N02 孤立小水域/陆块 · D01–D03 队伍 · R01–R04 项目规则 · S01 输出过期 · S02 尺寸不符 · O01 开局刷屏 · P01/P02 性能。

## 对照 154 条清单的完成情况
**已做(20)**:1 2 3 4 5 6 11 33 34 44 54 79 80 89 90 117 120 124 77/121(serve.sh)
**部分做了(16)**:8 开局只列出"会发动作的"触发器 · 13 隐含默认值只在 unitDetect 模型里实现 · 14 只能模拟"刷出失败",没做目标格占用检查 · 15 只放行多语言后缀,没预览 · 32 只有行宽/行数限制,没有按字体宽度的所见即所得 · 38 只查完全相同/8 字以上重复 · 43 前 10 号用编辑器色表,10 号以后**没有在游戏内核对** · 45 只有 `teams` 命令的单位/触发器计数 · 56 `route` 能判断某条水道是否通以及可过宽度,不会自动找河 · 66 `layout.js` 有簇布局器和疏密/对称统计,**没有接进 UI** · 68 同上,最小距离只在布局器参数里 · 73 舰船/海军工厂的水域检查已做,"联通海域"未做 · 81 lint 失败退出码为 1,但没有强制挡住导出 · 83/89 CLI 已有,但没有 `build/export` · 91 结果带触发器名/编号,点击定位未做 · 94 陆路孤岛与水路都有,口岸未做 · 96 `--json` 输出,没有一页报告 · 116 BASE_COLORS 与 TEAM_COLORS 未统一
**未做**:其余(包括 7 9 10 12 16 17 18–31 35–37 39–42 46–53 55 57–65 67 69–72 74–76 78 82 84–88 92–93 95 97–115 118–119 122–123 以及全部 Mod 编辑器相关条目)。

## 没有在真实游戏里验证的
触发器模型来自反编译规格 `triggers_spec.md`,**没有和游戏逐帧对拍**;多行消息、屏幕截断字数、队伍号 10 以后的颜色、性能评级口径都未在游戏内实测。
