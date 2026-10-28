# 开发说明

## 开发

网页部分是纯 JavaScript，不需要构建：

```bash
python3 -m http.server 8765 --directory www   # 浏览器打开 http://localhost:8765
```

自动化测试（需要 Playwright）：

```bash
node tests/smoke.mjs 地图.tmx 输出目录      # 读写往返、地形、撤销、5000×5000 压力
node tests/extra.mjs 地图.tmx 输出目录      # 边界情况
node tests/v2.mjs 地图.tmx 输出目录         # 2.0 界面、框选粘贴、触发器模板、缩放
node tests/v2b.mjs 地图.tmx 图片.png 输出目录 # 生成、图片转地图、贴图、印章、历史、教程
node tests/v2m.mjs 地图.tmx 输出目录        # 手机触屏手势
```

| 路径 | 内容 |
| --- | --- |
| `www/js/tmx.js` | TMX 读写（base64 + zlib/gzip、翻转位、内嵌图片），没改的部分原样保留 |
| `www/js/terrain.js` | 地形自动过渡：角点地形网格 + 地形邻接图 |
| `www/js/history.js` | 撤销记录（大改动自动转成整层快照） |
| `www/js/editor.js` | 工具、对称、物品、出生点、map_info |
| `www/js/transform.js` | 选区、复制粘贴、翻转旋转、整图镜像、对称检查、等比缩放 |
| `www/js/triggers.js` | 可视化触发器：类型定义、白话描述、检查、模板、逻辑图 |
| `www/js/gen.js` `terraform.js` `imagemap.js` | 随机生成、出生点/资源池摆放、图片转地图 |
| `www/js/pathing.js` | 通行图、步行距离、平衡报告 |
| `www/js/render.js` | 分块渲染、整图概览、叠加图、小地图 |
| `www/js/panels.js` `input.js` `actions.js` | 界面、手势与快捷键、菜单和功能搜索 |
| `www/js/help.js` `tutorial.js` `icons.js` | “?”说明、新手教程、图标 |
| `www/js/i18n.js` `www/js/i18n/` `scripts/i18n/` | 界面多语言：译文源文件在 scripts/i18n，`node scripts/i18n/build.mjs <语言> 20` 生成 |
| `android-plugin/` | 安卓原生插件（另存为、游戏文件夹）和固定签名 |
