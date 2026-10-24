# 参与贡献 / Contributing

## 报告问题
在 [Issues](https://github.com/WeaverVictorWings/rw-map-editor/issues/new/choose) 选“报告 bug”“翻译问题”或“新功能建议”。附上版本号、平台、截图，能附地图文件更好。

## 改进翻译 / Improving translations
界面原文是简体中文，译文在 `scripts/i18n/`：

- `strings.txt`：每行一个原文，格式 `编号<TAB>来源文件<TAB>"原文"`。
- `<语言><序号>.tsv`：每行一条译文，格式 `编号<TAB>译文`，例如 `ja1.tsv`、`ru2.tsv`。语言代码：en ru uk pt es fr id tr ja。
- 改完运行 `node scripts/i18n/build.mjs <语言> 20` 生成 `www/js/i18n/<语言>.js`。
- 繁体中文由 `zht-opencc.py` 从简体自动转换，一般不用手改。

The UI source text is Simplified Chinese. Translations live in `scripts/i18n/*.tsv` as `id<TAB>text` lines, matched to `strings.txt`. Edit the line, run `node scripts/i18n/build.mjs <lang> 20`, and open a pull request. Untranslated long texts fall back to English.

## 改代码
网页部分是纯 JavaScript，不需要构建：`python3 -m http.server 8765 --directory www`，然后浏览器打开 http://localhost:8765 。测试脚本在 `tests/`（需要 Playwright）。
