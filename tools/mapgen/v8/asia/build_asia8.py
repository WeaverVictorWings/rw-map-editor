# -*- coding: utf-8 -*-
# 大亚洲战争 v0.8:a1.tmx(已连岛)→ 文本 + 触发器节奏 + 胜利城标注
import sys, re, json, random
sys.path.insert(0, '/home/claude/w8'); sys.path.insert(0, '/home/claude/w8/asia'); sys.path.insert(0, '/home/claude/wg')
from common import *
import asia_spec as spec
import asia_text8 as X

SRC = '/home/claude/w8/asia/a1.tmx'
DST = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/w8/out/大亚洲战争_v0.8.tmx'
RED, BLUE = '#FF6A5A', '#6FB4FF'
NAT = {s: v['zh'] for s, v in spec.SEATS.items()}
CAMP = {s: ('A' if s % 2 else 'B') for s in NAT}
COL = {'A': RED, 'B': BLUE}
DISP = {s: ('中国' if s in (1, 3, 5, 7, 9) else NAT[s]) for s in NAT}
cities = json.load(open('/home/claude/wg/out/asia_cities.json'))
V = ['北京', '上海', '广州', '伊斯兰堡', '平壤', '东京', '首尔', '新德里', '马尼拉', '悉尼']
T = Tmx(SRC)
stat = {}

# ---------- 1. 开场(1 秒一条) ----------
items = []
for tx, c in X.INTRO:
    for m in split_story(tx):
        items.append((m, c))
timed(T, [f'开场{i}' for i in range(1, 12)], items, start=2, gap=1)
stat['开场条数'] = len(items)

# ---------- 2. 战局 / 提示 ----------
for i, tx in enumerate(X.PHASE):
    T.set(f'战局{i + 1}', tx, GOLD)
for i, tx in enumerate(X.TIPS):
    T.set(f'提示{i + 1}', tx, '#FFFFFF')

# ---------- 3. 守城 / 胜利 / 清场 ----------
for ab in 'AB':
    for i, tx in enumerate(X.HOLD[ab]):
        T.set(f'守报{ab}{i}', tx, COL[ab])
    other = 'B' if ab == 'A' else 'A'
    msgs = [X.END_TITLE[ab]] + split_story(X.END[ab]) + split_story(X.LOSE[other]) + [X.THANKS]
    cols = [COL[ab]] * (1 + len(split_story(X.END[ab]))) + [COL[other]] * len(split_story(X.LOSE[other])) + [GOLD]
    names = [o.name for o in follow(T, f'终{ab}1')]
    objs = put(T, names, msgs, cols)
    wait = len(msgs) + 6   # 结局全部播完后再等几秒才清场
    for k, o in T.by.items():
        if re.fullmatch(rf'清{ab}_\d+', k):
            o.set('warmup', f'{wait}s')
    stat[f'结局{ab}'] = f'{len(msgs)} 条,{sum(len(m) for m in msgs)} 字,清场 {wait}s'

# ---------- 4. 覆灭 / 首府陷落 ----------
CAPNAME = {}
for s in NAT:
    nm = [o.name for o in follow(T, f'灭{s}报1')]
    title, body = X.DEAD[s]
    put(T, nm, [title] + split_story(body), COL[CAMP[s]])
    nm = [o.name for o in follow(T, f'陷{s}报1')]
    head = T.msg(nm[0])
    CAPNAME[s] = re.search(r'】(.+?)失守', head.get('globalMessage').replace('\n', '')).group(1)
    title, body = X.FALL[s]
    hc = head.get('globalMessage_textColor')
    msgs = [title] + split_story(body)
    put(T, nm, msgs, [hc] + [COL[CAMP[s]]] * (len(msgs) - 1))

# ---------- 5. 势力里程碑 ----------
for s in NAT:
    for k in range(3):
        n = f'国{s}_{k}讯'
        m = int(T.by[f'国{s}_{k}'].get('minUnits'))
        tx = X.MILE[s][k].replace('{m}', str(m))
        put(T, [o.name for o in follow(T, n)], split_story(tx), COL[CAMP[s]])

# ---------- 6. 城市易手 ----------
capset = set(CAPNAME.values())
# 悉尼是胜利城但不是首府:原图只有附近 6 支队伍有占领检测,补齐其余队伍,保证谁打下来都有播报
SYD = [k for k, q in enumerate(cities) if q['zh'] == '悉尼'][0]
have = [t for t in range(20) if f'占{SYD}_{t}' in T.by]
for t in range(20):
    if t in have or t == cities[SYD]['owner']:
        continue
    src = [x for x in have if T.by[f'占{SYD}_{x}'].get('activatedBy') is None][0]
    d = T._clone_after(T.by[f'占{SYD}_{src}'], f'占{SYD}_{t}'); d.set('team', str(t))
    m = T._clone_after(T.by[f'占{SYD}_{src}讯'], f'占{SYD}_{t}讯'); m.set('activatedBy', f'占{SYD}_{t}')
    stat['悉尼补检测'] = stat.get('悉尼补检测', 0) + 1
for ci, q in enumerate(cities):
    for t in range(20):
        h = f'占{ci}_{t}讯'
        if T.msg(h) is None:
            continue
        s_ = t + 1; own = q['owner']; C = q['zh']
        if own < 0: kk, A, O = 'neutral', DISP[s_], ''
        elif t == own: kk, A, O = 'back', DISP[s_], ''
        elif CAMP[s_] == CAMP[own + 1]:
            same = DISP[s_] == DISP[own + 1]
            kk, A, O = 'ally', (NAT[s_] if same else DISP[s_]), (NAT[own + 1] if same else DISP[own + 1])
        else: kk, A, O = 'enemy', DISP[s_], DISP[own + 1]
        r = random.Random(ci * 131 + t * 17 + 11)
        fm = dict(A=A, O=O, C=C)
        head = X.HEAD[kk][(ci * 7 + t) % len(X.HEAD[kk])].format(**fm)
        names = [n for n in (h, h + '2', h + '3') if T.msg(n) is not None]
        if kk == 'enemy' and C == '悉尼':
            msgs = split_story(X.SYDNEY.format(**fm)); msgs = [head] + msgs
        elif kk == 'enemy' and (C in capset):
            msgs = [head]                      # 首府陷落另有长文,这里只留一句标题
        else:
            pool = [b for tag, b in X.BODY[kk] if tag == 'any' or tag == ('port' if q.get('port') else 'inland')]
            msgs = [head, r.choice(pool).format(**fm)]
        put(T, names, msgs, COL[CAMP[s_]])
        stat['占'] = stat.get('占', 0) + 1

# ---------- 7. 胜利城标注 + 海面说明 ----------
for v in V:
    i = [k for k, q in enumerate(cities) if q['zh'] == v][0]
    o = T.by[f'城名{i}']; o.set('text', '★' + v + '★'); o.set('textSize', '24')
anchor = T.by['满B']
for pi, (x0, y0, lines) in enumerate(X.PANELS):
    for li, (tx, sz, c) in enumerate(lines):
        maptext(T, f'胜利说明{pi}_{li}', x0 * 20, y0 * 20 + li * 34, tx, sz, c, after=anchor)

# map_info
mi = T.by['map_info']
mi.set('description', X.DESCRIPTION); mi.set('introText', X.INTRO_TEXT)

import os
os.makedirs(os.path.dirname(DST), exist_ok=True)
T.save(DST)
print(stat, DST)
