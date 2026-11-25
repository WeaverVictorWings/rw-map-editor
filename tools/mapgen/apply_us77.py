# -*- coding: utf-8 -*-
# 美国内战 v76 → v77:只改文字(消息链重排、覆灭/胜利重写),颜色与触发结构不动
import sys, re, collections
sys.path.insert(0, '/home/claude/rw-map-editor/tools/mapgen'); sys.path.insert(0, '/home/claude/wg')
from tmxtext import Tmx, reflow, fw, secs_for
import us_text7 as X

SRC = '/home/claude/wg/out2/美国内战_v76.tmx'
DST = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/wg/out3/美国内战_v77.tmx'
T = Tmx(SRC)

by_act = collections.defaultdict(list)
for o in T.by.values():
    a = o.get('activatedBy')
    if o.get('globalMessage') is not None and a:
        by_act[a.strip()].append(o)


def follow(head):
    seq = [T.msg(head)]
    while True:
        nx = by_act.get(seq[-1].name, [])
        if not nx: break
        assert len(nx) == 1, (head, [o.name for o in nx])
        seq.append(nx[0])
    return seq


def groups(text, maxc=92):
    sents = re.findall(r'.+?(?:[。！？!?]+[”」）]*[。！？]*|$)', text)
    sents = [x for x in sents if x]
    out, cur = [], ''
    for s_ in sents:
        if cur and len(cur) + len(s_) > maxc:
            out.append(cur); cur = s_
        else:
            cur += s_
    if cur: out.append(cur)
    # 末段太短(<14)并进上一段
    if len(out) >= 2 and len(out[-1]) < 14 and len(out[-2]) + len(out[-1]) <= maxc + 20:
        out[-2] += out[-1]; out.pop()
    return out


stat = collections.Counter()
# 1. 覆灭:标题保留 + 三段不同视角
for s in range(21):
    seq = follow(f'灭{s}讯')
    head = seq[0].get('globalMessage').replace('\n', '')
    T.chain([o.name for o in seq], [head] + X.DEAD[s]); stat['灭'] += 1
# 2. 统一胜利:标题+口号一条,结尾一条
for s in range(21):
    seq = follow(f'国{s}_f讯')
    ttl, slg = X.VICT[s]
    T.chain([o.name for o in seq], [f'★{ttl}★' + slg, X.END]); stat['国f'] += 1
# 3. 其余消息链:整条拼起来再按整句重新分段(解决碎片化、一行十来个字就换行)
heads = []
for k in T.by:
    if re.fullmatch(r'(占\d+_\d+|势\d+_\d+|区\d+_\d+|国\d+_[012])讯', k) and T.msg(k) is not None:
        heads.append(k)
for h in heads:
    seq = follow(h)
    full = ''.join(o.get('globalMessage').replace('\n', '') for o in seq)
    gs = groups(fw(full))
    T.chain([o.name for o in seq], gs); stat[re.sub(r'\d+.*', '', h)] += 1
# 4. 开场:只重排
for k, o in list(T.by.items()):
    if re.fullmatch(r'开场\d+_\d+', k) and o.get('globalMessage') is not None:
        T.set(k, o.get('globalMessage').replace('\n', ''))
        stat['开场'] += 1
import os
os.makedirs(os.path.dirname(DST), exist_ok=True)
T.save(DST)
print(dict(stat), DST)
