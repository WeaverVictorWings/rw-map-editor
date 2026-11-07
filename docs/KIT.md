# RWKit(质检套件)3.4.2

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

## 3.4.2 新增命令
`png`(通行性/地形图,无依赖 PNG)· `crop`(截取窗口做小测试图,自动清理悬空引用,美国图截取后 0 错误、夺城场景可跑)· `pools`/`fill`(资源池缺口检查与补抽取仪)· `rmunits`(按单位名/队伍删除)· `passes`(沿线段列出可通行区段,查山口宽度和岩墙漏洞)· `water`(水域连通域)· `perf`(触发器负担,相对指标)· `dump`(稳定排序文本,适合 git diff)。`units.js` 另有 `placeQuota`(按队伍配额在指挥中心周围成簇放建筑,带 accept 回调)。规则文件的 `ignore` 现在也可以写 `{"code":"T04","key":"^占52","why":"已确认"}`。
**资源池**:本图实测是"一个池格一个抽取仪"(866 个池格,786 个抽取仪都落在池格上,其中 611 个有相邻抽取仪)。缺口 80 格都是不属于任何城市的自由池,与最初"只填城市池"的设计一致;`fill` 默认只填半径 10 格内有指挥中心的池,半径可调。

## 对照 154 条清单的完成情况(3.4.2)
**已做(46)**:1 2 3 4 5 6 7 8 9 10 11 12 14 16 18 20 21 22 23 24 25 28 29 30 33 34 35 36 37 38 41 42 44 54 62 65 67 68 70 72 74 77 79 80 88 89 90 95 96 117 120 121 124(其中 8/9/16 以"空闲覆盖率+L 系列检查"的形式,67/68 依赖你填的参数)
**部分(15)**:13 15 32 43 45 55(只能扫描验证山口,不会自动生成)56(能列水域连通域,不会自动造河)61(PNG 缩略图,无图层开关)66/69(有布局器,未接 UI)71(配额放置有 API,无表格界面)73 81 83 91 92/118(ignore 可写原因,没有"来源=用户原话"的结构)93(perf 只是相对指标)94 116
**仍未做**:19 26 27 31 39 40 46–53 57–60(60 的区域禁用地形规则在 rules.js 已有,不含自动覆盖)63 64 75 76 78 82 84–87 97–115 119 122 123 以及全部 Mod 编辑器条目。其中 26/27/97–109 属于编辑器界面改造;52/53/57/63 属于地形生成/导入,需要具体地图任务才能验证。

## 没有在真实游戏里验证的
122(多行消息的序列化)和 123(中文/下划线触发器名的引用兼容)这版仍未在游戏内确认,但美国图已经用到了两者,请以你试玩结果为准。
触发器模型来自反编译规格 `triggers_spec.md`,**没有和游戏逐帧对拍**;多行消息、屏幕截断字数、队伍号 10 以后的颜色、性能评级口径都未在游戏内实测。
