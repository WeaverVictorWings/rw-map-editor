# -*- coding: utf-8 -*-
# 欧陆战争 v0.8:v0.7 → 十城胜利 + 文本重写 + 1 秒节奏 + 胜利城标注
import sys, re, json, random
sys.path.insert(0, '/home/claude/w8'); sys.path.insert(0, '/home/claude/w8/eu')
from common import *
import eu_text8 as X

SRC = '/home/claude/w8/in/eu_v0.7.tmx'
DST = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/w8/out/欧陆战争_v0.8.tmx'
BLUE, RED = '#6FB4FF', '#FF6A5A'
T = Tmx(SRC)
cities = json.load(open('/home/claude/eu/v6/cities6.json'))
NAME = {}
for k, o in T.by.items():
    m = re.fullmatch(r'队伍设置(\d+)-(.+)', k)
    if m: NAME[int(o.get('team'))] = m.group(2)
CAMP = {t: ('NATO' if t % 2 == 0 else 'RUS') for t in range(20)}
COL = {'NATO': BLUE, 'RUS': RED}
stat = {}

# ---------- 1. 十城胜利:每方再补 5 座(对方原来要打的那 5 座,也就是自己的家) ----------
for camp, other, teams in (('NATO', 'RUS', range(0, 20, 2)), ('RUS', 'NATO', range(1, 20, 2))):
    anchor = T.by[f'守{camp}4']
    srcpos = []
    for c in range(5):
        o = T.by[f'据{other}{c}_{1 if other == "RUS" else 0}']
        x, y = re.search(r'x="([\d.]+)" y="([\d.]+)"', o.seg).groups(); srcpos.append((x, y))
    for c in range(5):
        x, y = srcpos[c]; gi = 5 + c; names = []
        for t in teams:
            n = f'据{camp}{gi}_{t}'
            anchor = T.add(n, 'unitDetect', x, y, 220, 220, {'unitType': 'commandCenter', 'team': t, 'minUnits': 1, 'resetActivationAfter': '600'}, after=anchor)
            names.append(n)
        anchor = T.add(f'守{camp}{gi}', 'basic', x, y, 20, 20, {'activatedBy': ','.join(names), 'resetActivationAfter': '600'}, after=anchor)
    T.by[f'满{camp}'].set('activatedBy', ','.join(f'守{camp}{i}' for i in range(10)))
    stat[f'{camp}守城门'] = 10

# ---------- 2. 开场 / 战局 / 提示 ----------
items = []
for tx, c in X.INTRO:
    for m in split_story(tx): items.append((m, c))
timed(T, [f'开场{i}' for i in range(1, 18)], items, start=2, gap=1)
stat['开场条数'] = len(items)
for i, tx in enumerate(X.PHASE): T.set(f'战局{i + 1}', tx, GOLD)
for i, tx in enumerate(X.TIPS): T.set(f'提示{i + 1}', tx, '#FFFFFF')

# ---------- 3. 守城 / 结局 / 清场 ----------
for camp, other in (('NATO', 'RUS'), ('RUS', 'NATO')):
    for i, tx in enumerate(X.HOLD[camp]): T.set(f'守报{camp}{i}', tx, COL[camp])
    e, l = split_story(X.END[camp]), split_story(X.LOSE[other])
    msgs = [X.END_TITLE[camp]] + e + l + [X.THANKS]
    cols = [COL[camp]] * (1 + len(e)) + [COL[other]] * len(l) + [GOLD]
    put(T, [o.name for o in follow(T, f'终{camp}1')], msgs, cols)
    wait = len(msgs) + 6
    for k, o in T.by.items():
        if re.fullmatch(rf'清{camp}_\d+', k): o.set('warmup', f'{wait}s')
    stat[f'结局{camp}'] = f'{len(msgs)} 条,清场 {wait}s'

# ---------- 4. 覆灭 / 首都陷落(+ 占领链压成一段) ----------
for s in range(1, 21):
    t = s - 1
    nm = [o.name for o in follow(T, f'灭{s}报1')]
    title, body = X.DEAD[s]
    put(T, nm, [title] + split_story(body), COL[CAMP[t]])
    seq = follow(T, f'陷{s}报1')
    xian = [o.name for o in seq if o.name.startswith('陷')]
    zhan = [o for o in seq if o.name.startswith('占领')]
    hc = seq[0].get('globalMessage_textColor')
    title, body = X.FALL[s]
    msgs = [title] + split_story(body)
    put(T, xian, msgs, [hc] + [COL[CAMP[t]]] * (len(msgs) - 1))
    if zhan:
        head = zhan[0].get('globalMessage').replace('\n', '')
        rest = ''.join(o.get('globalMessage').replace('\n', '') for o in zhan[1:])
        rest = re.sub(r'^随军记者[:\uff1a]', '', rest)
        zc = [zhan[0].get('globalMessage_textColor')] + [COL['NATO' if '北约' in head else 'RUS']] * 3
        zm = [head] + split_story(rest)
        put(T, [o.name for o in zhan], zm, zc[:1] + zc[1:2] * (len(zm) - 1))

# ---------- 5. 里程碑 / 地区统一 ----------
for s in range(1, 21):
    for k in range(3):
        m = T.by[f'国{s}_{k}'].get('minUnits')
        put(T, [o.name for o in follow(T, f'国{s}_{k}讯')], split_story(X.MILE[s][k].replace('{m}', m)), COL[CAMP[s - 1]])
for k, o in list(T.by.items()):
    mm = re.fullmatch(r'区(\d+)_(\d+)讯', k)
    if not mm: continue
    t = int(mm.group(2)); reg = re.search(r'统一了(.+?)[!!]', o.get('globalMessage').replace('\n', '')).group(1)
    n = T.by[f'区{mm.group(1)}_{t}'].get('minUnits')
    put(T, [x.name for x in follow(T, k)], split_story(X.REGION[reg].format(A=NAME[t], n=n)), COL[CAMP[t]])

# ---------- 6. 胜利城(非首都)补检测 + 长文;城市故事链(述)重排 ----------
VC = {50: '圣彼得堡', 124: '伊斯坦布尔', 80: '慕尼黑', 118: '米兰'}
for ci, nm in VC.items():
    own = cities[ci]['owner']
    have = [t for t in range(20) if f'占{ci}_{t}' in T.by]
    src = [x for x in have if T.by[f'占{ci}_{x}'].get('activatedBy') is None][0]
    for t in range(20):
        if t in have or t == own or CAMP[t] == CAMP[own]: continue
        d = T._clone_after(T.by[f'占{ci}_{src}'], f'占{ci}_{t}'); d.set('team', str(t))
        m = T._clone_after(T.by[f'占{ci}_{src}讯'], f'占{ci}_{t}讯'); m.set('activatedBy', f'占{ci}_{t}')
        stat['胜利城补检测'] = stat.get('胜利城补检测', 0) + 1
# 述:胜利城的故事链删掉(改由各队占领链播长文),其余重排成段
for ci in sorted({int(re.match(r'述(\d+)_', k).group(1)) for k in T.by if k.startswith('述')}):
    names = sorted([k for k in T.by if re.fullmatch(rf'述{ci}_\d+', k)], key=lambda s: int(s.split('_')[1]))
    if ci in VC:
        for n in names: T.kill(n)
        continue
    txt = ''.join(T.by[n].get('globalMessage').replace('\n', '') for n in names)
    put(T, names, split_story(txt), T.by[names[0]].get('globalMessage_textColor'))

# ---------- 7. 普通城市易手 ----------
for k, o in list(T.by.items()):
    mm = re.fullmatch(r'占(\d+)_(\d+)讯', k)
    if not mm: continue
    ci, t = int(mm.group(1)), int(mm.group(2)); own = cities[ci]['owner']; C = cities[ci]['zh']
    names = [x.name for x in follow(T, k)]
    head = o.get('globalMessage').replace('\n', '')
    enemy = own >= 0 and CAMP[t] != CAMP[own]
    if ci in VC and enemy:
        title, body = X.VCITY[C]
        head = f'【攻陷】{NAME[t]}攻入{NAME[own]}的{C},城头换了旗帜'   # 补出来的检测是克隆的,标题要按实际进攻方重写
        msgs = [head, title] + split_story(body.format(A=NAME[t]))
    elif enemy and own >= 0 and t != own:
        r = random.Random(ci * 97 + t * 13 + 3)
        msgs = [head, r.choice(X.BODY_ENEMY)]
    else:
        msgs = [head]
    put(T, names, msgs, COL[CAMP[t]])
    stat['占'] = stat.get('占', 0) + 1

# ---------- 8. 胜利城标注 + 海面说明 + 地图信息 ----------
for k, o in T.by.items():
    if re.fullmatch(r'城名\d+', k) and o.get('text') in X.V_NATO + X.V_RUS:
        o.set('text', '★' + o.get('text') + '★'); o.set('textSize', '22')
anchor = T.by['满RUS']
for pi, (x0, y0, lines) in enumerate(X.PANELS):
    for li, (tx, sz, c) in enumerate(lines):
        maptext(T, f'胜利说明{pi}_{li}', x0 * 20, y0 * 20 + li * 34, tx, sz, c, after=anchor)
mi = T.by['map_info']; mi.set('description', X.DESCRIPTION); mi.set('introText', X.INTRO_TEXT)

import os
os.makedirs(os.path.dirname(DST), exist_ok=True)
T.save(DST)
print(stat, DST)
