set -e
R=/home/claude/rw-map-editor
A=/home/claude/w8/out/大亚洲战争_v0.8.tmx; EU=/home/claude/w8/out/欧陆战争_v0.8.tmx; US=/home/claude/w8/out/美国内战_v78.tmx
echo "## lint"; for p in "$A:/home/claude/wg/rules_asia3.json" "$EU:/home/claude/eu/rules_eu6.json" "$US:/home/claude/wg/rules_us74.json"; do node $R/scripts/rwkit.mjs lint "${p%%:*}" --rules "${p##*:}" 2>&1 | tail -1; done
echo "## 文本"; for f in $A $EU $US; do python3 textcheck.py $f 2>/dev/null | head -1; done
echo "## 开场"; for f in $A $EU $US; do node $R/scripts/rwkit.mjs open $f 2>&1 | grep -E "^消息|^[0-9]+s" | tail -1 | cut -c1-40; done
echo "## 守城/统一"; node asia/hold.mjs $A A | cut -c1-150; node asia/hold.mjs $A B | cut -c1-150; node eu/hold_eu.mjs $EU NATO | cut -c1-150; node eu/hold_eu.mjs $EU RUS | cut -c1-150; node us/unify.mjs $US | sed -n '1p;6p'
