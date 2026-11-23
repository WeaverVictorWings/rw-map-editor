#!/usr/bin/env python3
"""美国内战 v72 → v73:
 1) 把 TFR 式的碎句消息(中位 10 字)沿链合并成每条约 40~80 字,折行不超过 42 字;
 2) 按势力强弱给各队追加火蜂战机与重型坦克(放在本队城市附近的空地上)。
地形、触发器逻辑、全知者设计都不变。
用法: python3 us_v73.py 输入.tmx 输出.tmx
"""
import sys, re, random, base64, zlib, subprocess, collections
sys.path.insert(0,'/home/claude/wg')
from texts_dead_us import DEAD_US, MORE_US
import numpy as np
import xml.etree.ElementTree as ET

src, dst = sys.argv[1], sys.argv[2]
tree = ET.parse(src); root = tree.getroot()
W = int(root.get('width')); H = int(root.get('height'))

# ---------------- 工具 ----------------
def props(o):
    pr = o.find('properties')
    return pr if pr is not None else None
def pget(o, k, d=None):
    pr = props(o)
    if pr is None: return d
    for p in pr.findall('property'):
        if p.get('name') == k: return p.get('value')
    return d
def pset(o, k, v):
    pr = props(o)
    for p in pr.findall('property'):
        if p.get('name') == k: p.set('value', v); return
    ET.SubElement(pr, 'property', {'name': k, 'value': v})
def split(v): return [x for x in (v or '').split(',') if x]

def wrap(t, w=30):
    if '\n' in t: t = t.replace('\n', '')
    parts = [p for p in re.findall(r'[^,。!?:;…、,!?:;，！？：；]*[,。!?:;…、,!?:;，！？：；]*', t) if p]
    lines, cur = [], ''
    for p in parts:
        while len(p) > w + 2:
            if cur: lines.append(cur); cur = ''
            lines.append(p[:w]); p = p[w:]
        if len(cur) + len(p) > w and cur: lines.append(cur); cur = ''
        cur += p
    if cur: lines.append(cur)
    return '\n'.join(lines)

# ---------------- 1) 消息链合并 ----------------
trig_group = [g for g in root.findall('objectgroup') if g.get('name') != 'UnitObjects']
all_trig = [o for g in trig_group for o in g.findall('object')]
by_name = {o.get('name'): o for o in all_trig if o.get('name')}
def is_msg(o): return pget(o, 'globalMessage') is not None and o.get('type') == 'unitAdd'
msgs = [o for o in all_trig if is_msg(o) and not (o.get('name') or '').startswith(('开场','灭'))]
n0 = len(msgs)

def referrers():
    ref = collections.defaultdict(set)
    for o in all_trig:
        for key in ('activatedBy', 'deactivatedBy'):
            for nm in split(pget(o, key)): ref[nm].add((o.get('name'), key))
    return ref
SAME = ('team', 'globalMessage_textColor', 'deactivatedBy', 'resetActivationAfter', 'allToActivate')
LIMIT = 84
merged = 0
# ---- 0) 按 delay 排时的消息序列(开场N / 开场N行k):同一基名内按序合并,每条最多 LIMIT 字 ----
_grp = collections.defaultdict(list)
for o in msgs:
    nm = o.get('name') or ''
    mm = re.match(r'^(.*?)(?:行(\d+))?$', nm)
    if pget(o, 'activatedBy') is None and pget(o, 'delay') is not None and mm:
        _grp[mm.group(1)].append((int(mm.group(2) or 1), o))
for base, items_ in _grp.items():
    items_.sort(key=lambda a: a[0])
    if len(items_) < 2: continue
    head = None
    for k, o in items_:
        ot = pget(o, 'globalMessage').replace('\n', '')
        if head is not None and all(pget(head, a) == pget(o, a) for a in ('team', 'globalMessage_textColor')) \
                and len(pget(head, 'globalMessage').replace('\n', '')) + len(ot) <= LIMIT:
            pset(head, 'globalMessage', pget(head, 'globalMessage').replace('\n', '') + ot)
            for g in trig_group:
                if o in list(g): g.remove(o)
            msgs.remove(o); all_trig.remove(o); del by_name[o.get('name')]; merged += 1
        else:
            head = o
changed = True
while changed:
    changed = False
    ref = referrers()
    parent_of = {}
    for o in list(msgs):
        a = split(pget(o, 'activatedBy'))
        if len(a) != 1: continue
        P = by_name.get(a[0])
        if P is None or not is_msg(P) or P is o: continue
        # P 只能有 o 一个后继(别的触发器不能再引用 P)
        if {r for r in ref[P.get('name')]} != {(o.get('name'), 'activatedBy')}: continue
        if any(pget(P, k) != pget(o, k) for k in SAME): continue
        pt = pget(P, 'globalMessage').replace('\n', ''); ot = pget(o, 'globalMessage').replace('\n', '')
        _term = pt.rstrip()[-1:] in '。!?」…"”.)' if pt.strip() else True
        if len(pt) + len(ot) > LIMIT and (_term or len(pt) + len(ot) > 150): continue
        # 合并 o 进 P
        pset(P, 'globalMessage', pt + ot)
        for r_name, key in ref[o.get('name')]:
            R = by_name.get(r_name)
            if R is None: continue
            lst = [P.get('name') if x == o.get('name') else x for x in split(pget(R, key))]
            seen = []; [seen.append(x) for x in lst if x not in seen]
            pset(R, key, ','.join(seen))
        for g in trig_group:
            if o in list(g): g.remove(o)
        msgs.remove(o); all_trig.remove(o); del by_name[o.get('name')]
        merged += 1; changed = True
        break   # 重新计算引用表

# ---- 开场:所有势力介绍压缩到约两分钟内放完,整句断行,每行≤30字 ----
def pitems(o): return {p.get('name'): p.get('value') for p in o.find('properties').findall('property')}
op = [o for o in all_trig if is_msg(o) and (o.get('name') or '').startswith('开场')]
blocks = collections.defaultdict(list)
for o in op:
    mm = re.match(r'^开场(\d+)(?:行(\d+))?$', o.get('name'))
    blocks[int(mm.group(1))].append((int(mm.group(2) or 1), o))
tmpl_parent = {}
for g in trig_group:
    for o in g.findall('object'): tmpl_parent[o] = g
nid = int(root.get('nextobjectid'))
t_cur = 3.0; new_open = 0
def sentence_chunks(text, per=4):
    lines = wrap(text).split('\n'); out = []; i = 0
    while i < len(lines):
        j = min(len(lines), i + per)
        if j < len(lines):
            k = j
            while k > i + 1 and (lines[k-1].rstrip()[-1:] not in '。!?」…' or lines[k][:1] in '」』”)'):
                k -= 1
            if k > i + 1: j = k
        if j < len(lines) and lines[j][:1] in '」』”)': j += 1
        out.append(lines[i:j]); i = j
    return out
for bi in sorted(blocks):
    items_ = sorted(blocks[bi], key=lambda a: a[0]); head = items_[0][1]
    para = ''.join(pget(o, 'globalMessage').replace('\n', '') for _, o in items_)
    base = pitems(head); par = tmpl_parent[head]; hx, hy = head.get('x'), head.get('y')
    for _, o in items_:
        par.remove(o); all_trig.remove(o)
    for ci_, ch in enumerate(sentence_chunks(para)):
        o = ET.SubElement(par, 'object', {'id': str(nid), 'name': f'开场{bi}_{ci_+1}', 'type': 'unitAdd', 'x': hx, 'y': hy, 'width': '20', 'height': '20'}); nid += 1
        pr = ET.SubElement(o, 'properties')
        for k_, v_ in base.items():
            if k_ in ('globalMessage', 'delay', 'activatedBy', 'warmup'): continue
            ET.SubElement(pr, 'property', {'name': k_, 'value': v_})
        ET.SubElement(pr, 'property', {'name': 'globalMessage', 'value': '\n'.join(ch)})
        ET.SubElement(pr, 'property', {'name': 'delay', 'value': f'{t_cur:.1f}s'})
        t_cur += 1.7 * len(ch) + 1.2; new_open += 1
print(f'开场:{len(op)} 条碎片 → {new_open} 条整句消息,全部放完约 {t_cur:.0f} 秒')
# ---- 覆灭:每个势力重写为约200字的多条消息 ----
DEATH_T = {}
for o in list(all_trig):
    nm = o.get('name') or ''
    m_ = re.fullmatch(r'灭(\d+)', nm)
    if m_ and o.get('type') == 'unitDetect': pass
for o in list(all_trig):
    nm = o.get('name') or ''
    if re.fullmatch(r'灭\d+讯(?:行\d+)?', nm) and is_msg(o):
        if nm.endswith('讯'): DEATH_T[int(nm[1:-1])] = o
        else: tmpl_parent[o].remove(o); all_trig.remove(o)
for n_, head in DEATH_T.items():
    lines = DEAD_US[n_][:-1] + MORE_US[n_] + DEAD_US[n_][-1:]
    base = pitems(head); par = tmpl_parent[head]
    prevname = head.get('name')
    full = ['【覆灭】'] + lines
    nm_head = full[0]
    pset(head, 'globalMessage', pget(head, 'globalMessage'))
    hn = {0: '宪政政府', 1: '美利坚联邦', 2: '人民解放军', 3: '爱国者阵线', 4: '民族社会主义运动', 5: '核武之师', 6: '西部军政府', 7: '卡斯卡迪亚临时政府', 8: '西北联合政府', 9: '加利福尼亚', 10: '布里格姆军', 11: '联邦空军司令部', 12: '西南边境司令部', 13: '德克萨斯', 14: '南方联盟', 15: '南方联邦', 16: '佐治亚', 17: '佛罗里达', 18: '纽约州', 19: '密歇根', 20: '联合国维和军'}[n_]
    pset(head, 'globalMessage', f'【{hn}覆灭】最后的指挥中心已被摧毁')
    for k_, ln in enumerate(lines):
        nm = f'灭{n_}讯行{k_+2}'
        o = ET.SubElement(par, 'object', {'id': str(nid), 'name': nm, 'type': 'unitAdd', 'x': head.get('x'), 'y': str(int(head.get('y')) + 20 * (k_ + 1)), 'width': '20', 'height': '20'}); nid += 1
        pr = ET.SubElement(o, 'properties')
        for k2, v2 in base.items():
            if k2 in ('globalMessage', 'activatedBy', 'warmup'): continue
            ET.SubElement(pr, 'property', {'name': k2, 'value': v2})
        ET.SubElement(pr, 'property', {'name': 'globalMessage', 'value': ln})
        ET.SubElement(pr, 'property', {'name': 'activatedBy', 'value': prevname})
        ET.SubElement(pr, 'property', {'name': 'warmup', 'value': '3s'})
        prevname = nm
root.set('nextobjectid', str(nid))
print('覆灭文本:', {n_: len(''.join(DEAD_US[n_] + MORE_US[n_])) + 17 for n_ in DEATH_T})
all_msgs = [o for o in all_trig if is_msg(o)]
for o in [x for x in all_msgs if not (x.get('name') or '').startswith(('开场','灭'))]:
    pset(o, 'globalMessage', wrap(pget(o, 'globalMessage')))
msgs = all_msgs
lens = [max(len(x) for x in pget(o, 'globalMessage').split('\n')) for o in msgs]
tot = [len(pget(o, 'globalMessage').replace('\n', '')) for o in msgs]
print(f'消息 {n0} → {len(msgs)}(合并 {merged} 次);单行最长 {max(lens)};每条字数中位 {sorted(tot)[len(tot)//2]}')

# ---------------- 2) 追加初始兵力 ----------------
tmp = '/tmp/us_v73_pass.u8'
subprocess.run(['node', '/home/claude/eu/py/dumppass.mjs', src, tmp], check=True, capture_output=True)
Pm = np.fromfile(tmp, np.uint8).reshape(H, W)
items = None
for lay in root.findall('layer'):
    if lay.get('name') == 'Items':
        d = lay.find('data'); raw = zlib.decompress(base64.b64decode(d.text.strip()))
        items = np.frombuffer(raw, dtype='<u4').reshape(H, W)
units_g = [g for g in root.findall('objectgroup') if g.get('name') == 'UnitObjects'][0]
occ = np.zeros((H, W), bool)
BIG = ('Factory', 'fabricator', 'laser', 'repair', 'outpost', 'extractor', 'laboratory', 'nuke', 'turret', 'Defence')
cities = collections.defaultdict(list); power_units = collections.Counter()
for o in units_g.findall('object'):
    u = pget(o, 'unit'); t = pget(o, 'team')
    if not u: continue
    x, y = int(round(float(o.get('x')) / 20)), int(round(float(o.get('y')) / 20))
    if 0 <= x < W and 0 <= y < H:
        r = 1 if any(b in u for b in BIG) else 0
        occ[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1] = True
    if u == 'commandCenter' and t not in (None, '-1', '-2'): cities[int(t)].append((x, y))
    if t is not None and t.lstrip('-').isdigit(): power_units[(int(t), u)] += 1

# 势力档位 → 追加数量(火蜂, 重型坦克, 重型机甲)。档位按原版势力体量与定位,逐队写明
ADD = {
    0: (12, 16, 3), 1: (12, 16, 3),                                    # 联邦 / 宪政政府:两大主力
    8: (6, 9, 2), 10: (6, 9, 2), 7: (8, 5, 2),                         # 德州 / 加州 / 联邦空军司令部(空军偏多)
    15: (4, 7, 2), 18: (4, 7, 2), 5: (4, 7, 2), 3: (4, 6, 2),
    2: (3, 5, 1), 9: (3, 5, 1), 11: (3, 5, 1), 12: (3, 5, 1), 14: (3, 5, 1),
    16: (3, 5, 1), 17: (3, 5, 1), 19: (3, 5, 1), 20: (3, 5, 1), 6: (3, 5, 1), 13: (3, 5, 1),
    4: (2, 3, 1),
}
rng = random.Random(7300)
nid = int(root.get('nextobjectid')); added = collections.Counter()
def free(x, y): return 2 <= x < W - 2 and 2 <= y < H - 2 and Pm[y, x] == 13 and not occ[y, x] and (items is None or items[y, x] == 0)
for t, (nb, nt, nm_) in ADD.items():
    cs = cities.get(t, [])
    if not cs: print('队', t, '无城市,跳过'); continue
    todo = ['fireBee'] * nb + ['heavyTank'] * nt + ['mechHeavyMissile'] * nm_
    rng.shuffle(todo); k = 0
    for u in todo:
        placed = False
        for _ in range(240):
            cx, cy = cs[k % len(cs)]; k += 1
            a = rng.uniform(0, 6.283); r = rng.uniform(4, 11)
            x = int(round(cx + r * np.cos(a))); y = int(round(cy + r * np.sin(a)))
            if free(x, y):
                occ[y, x] = True
                o = ET.SubElement(units_g, 'object', {'id': str(nid), 'x': str(x * 20), 'y': str(y * 20), 'width': '20', 'height': '20'})
                nid += 1; pr = ET.SubElement(o, 'properties')
                ET.SubElement(pr, 'property', {'name': 'unit', 'value': u}); ET.SubElement(pr, 'property', {'name': 'team', 'value': str(t)})
                added[t] += 1; placed = True; break
        if not placed: print('放不下', t, u)
root.set('nextobjectid', str(nid))
print('追加单位', dict(sorted(added.items())), '合计', sum(added.values()))
tree.write(dst, encoding='utf-8', xml_declaration=True)
print('写出', dst)
