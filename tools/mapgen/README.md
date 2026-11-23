# tools/mapgen — 大亚洲战争 / 美国内战 生成脚本
- 亚洲图流程:`asia1.py`(底图,含扩大变形/海峡/清岛/隔水)→ `rwgen.py` → `dumppass.mjs`(在 eu/py)→ `mk.py asia_spec`(城市、单位、触发器,调用 mk2.py、place_new.py、texts_*.py)。
- 美国图:`python3 us_v75.py 原版v71.tmx 输出.tmx`(合并/重写文本、开场压缩、覆灭重写、追加兵力)。
- 质检:`hold.mjs`(十城胜利模拟)、`audit4.py`(陆块与海峡,按"陆地+浅水可走"算)、`rules_*.json`(RWKit lint 规则)。
- 注意:脚本里有 `/home/claude/...` 写死路径与 data/ 缓存依赖,换环境需改路径;未包含地图与 mod。
