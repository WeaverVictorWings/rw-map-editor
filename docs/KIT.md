# RWKit(质检套件)3.4.1

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

## 3.4.1 新增命令
`report`(一页报告,rules.ignore 屏蔽已确认警告)· `timeline` · `find`/`refs` · `rename`(同步引用)· `set`(批量改属性)· `clone [--tree]` · `diff` · `texts`/`texts-in`(新闻文本 CSV 往返)· `graph`(mermaid/dot)· `tpl capture`(夺城链模板;`templates.js` 另有新闻/奖励/覆灭模板)。过滤语法:`type=unitDetect reset=200 name~^占 team!=-1 has:activatedBy`。
新检查:L01 minUnits>maxUnits · L02 开局即触发动作 · L03 一次性触发器 · L04 刷兵点不可通行/在图外 · T07 文字颜色对比 · F05 建筑叠格 · F06 占地重叠(需 rules.footprints,如 {"landFactory":7},**边长是你自己填的,我没有核实游戏里的真实占地**)· F07 不同队建筑过近(rules.minDist)。

## 对照 154 条清单的完成情况(3.4.1)
**已做(37)**:1 2 3 4 5 6 8 9(以 L01 + 空闲覆盖率的形式)10(L03)11 12(ignore)16(空闲覆盖率)20 21 22 23 24 25 29(comment 字段放行)30 33 34 35 36 37 38 41 42(timeline)44 54 72 79 80 89 90 96 117 120 124 · 18/28(模板库四种)· 77/121(serve.sh)· 95(各队概况表)· 7(timeline 文字版)· 14(L04)· 67/68(F06/F07,依赖你填的参数)
**部分(10)**:13 · 15 · 32(只有行宽限制,无字体宽度预览)· 43(10 号以后颜色未核对)· 45 · 56 · 66/69(`layout.js` 有布局器,未接 UI/未存预设)· 73 · 81(失败退出码为 1,不强制挡导出)· 83 · 91 · 94 · 116
**仍未做**:19 26 27 31 39 40 46–53 55 57–65 70 71 74–76 78 82 84–88 92 93 97–115 118 119 122 123 以及全部 Mod 编辑器条目。其中 26/27/97–109 属于编辑器界面改造,这版没有碰;52/53/55/57/63 属于地形生成,需要有具体地图任务才好验证。

## 没有在真实游戏里验证的
触发器模型来自反编译规格 `triggers_spec.md`,**没有和游戏逐帧对拍**;多行消息、屏幕截断字数、队伍号 10 以后的颜色、性能评级口径都未在游戏内实测。
