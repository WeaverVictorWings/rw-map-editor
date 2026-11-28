# -*- coding: utf-8 -*-
# 美国内战 v78:v77 → 文本重写 + 首都陷落补全(每个势力打下任何首都都有长文)+ 1 秒节奏
import sys, re
sys.path.insert(0, '/home/claude/w8'); sys.path.insert(0, '/home/claude/w8/us')
from common import *
import us_text8 as X

SRC = '/home/claude/wg/out3/美国内战_v77.tmx'
DST = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/w8/out/美国内战_v78.tmx'
T = Tmx(SRC)
GT = {int(re.match(r'队伍设置(\d+)', k).group(1)) - 1: o.get('team') for k, o in T.by.items() if k.startswith('队伍设置')}
COLR = {s: T.by[f'国{s}_0讯'].get('globalMessage_textColor') for s in range(21)}
S = X.SHORT
stat = {}

# 1. 开场(1 秒一条)
op = sorted([k for k in T.by if re.fullmatch(r'开场\d+_\d+', k)], key=lambda s: [int(x) for x in re.findall(r'\d+', s)])
items = []
for tx, c in X.INTRO:
    for m in split_story(tx): items.append((m, c))
timed(T, op, items, start=2, gap=1); stat['开场条数'] = len(items)

# 2. 覆灭
for s in range(21):
    seq = follow(T, f'灭{s}讯'); title, body = X.DEAD[s]
    msgs = [title] + split_story(body)
    put(T, [o.name for o in seq], msgs, [seq[0].get('globalMessage_textColor')] + [COLR[s]] * (len(msgs) - 1))

# 3. 统一
END = '烈焰终熄,美国重归一统。—— 美国内战 · 你赢了!'
for s in range(21):
    seq = follow(T, f'国{s}_f讯')
    msgs = [f'★{S[s]}统一美国★'] + split_story(X.UNIFY[s]) + [END]
    put(T, [o.name for o in seq], msgs, seq[0].get('globalMessage_textColor'))
    stat['统一结局最长条数'] = max(stat.get('统一结局最长条数', 0), len(msgs))
# 统一后清场:原来等 38 秒;改成结局播完(标题前 2 秒 + 每条 1 秒)再等 6 秒
wait = stat['统一结局最长条数'] + 2 + 6
for k, o in T.by.items():
    if k.startswith('终局清除'):
        o.set('warmup', f'{wait}s')
stat['清场'] = f'{wait}s'

# 4. 里程碑 / 地区统一 / 势力动态(后者原文保留,重排)
for s in range(21):
    for k in range(3):
        m = T.by[f'国{s}_{k}'].get('minUnits')
        put(T, [o.name for o in follow(T, f'国{s}_{k}讯')], split_story(X.MILE[s][k].replace('{m}', m)), COLR[s])
for k in list(T.by):
    mm = re.fullmatch(r'区(\d+)_(\d+)讯', k)
    if mm:
        r, t = int(mm.group(1)), int(mm.group(2)); n = T.by[f'区{r}_{t}'].get('minUnits')
        put(T, [o.name for o in follow(T, k)], split_story(X.REGION[r].format(A=S[t], n=n)), COLR[t])
    mm = re.fullmatch(r'势(\d+)_(\d+)讯', k)
    if mm:
        seq = follow(T, k); txt = ''.join(o.get('globalMessage').replace('\n', '') for o in seq)
        put(T, [o.name for o in seq], split_story(txt), seq[0].get('globalMessage_textColor'))

# 5. 首都陷落:补齐所有势力的占领检测,统一播长文
CAPOWN = {0: 0, 23: 1, 42: 2, 48: 3, 52: 4, 56: 5, 61: 6, 67: 7, 72: 8, 79: 9, 84: 10, 88: 11, 93: 12, 98: 13,
          107: 14, 112: 15, 117: 16, 123: 17, 128: 18, 133: 19, 137: 20}
for ci, own in CAPOWN.items():
    have = [t for t in range(21) if f'占{ci}_{t}' in T.by]
    src = [x for x in have if x != own][0]   # 美国图的检测都带 锁N(先拆指挥中心),克隆照抄即可
    for t in range(21):
        if t in have or t == own: continue
        d = T._clone_after(T.by[f'占{ci}_{src}'], f'占{ci}_{t}'); d.set('team', GT[t])
        m = T._clone_after(T.by[f'占{ci}_{src}讯'], f'占{ci}_{t}讯'); m.set('activatedBy', f'占{ci}_{t}')
        stat['首都补检测'] = stat.get('首都补检测', 0) + 1
for k in list(T.by):
    mm = re.fullmatch(r'占(\d+)_(\d+)讯', k)
    if not mm: continue
    ci, t = int(mm.group(1)), int(mm.group(2)); seq = follow(T, k)
    if ci in CAPOWN and t != CAPOWN[ci]:
        C, story = X.CAPITAL[ci]; O = S[CAPOWN[ci]]
        msgs = [f'【首都陷落】{S[t]}攻占了{O}的首都{C}'] + split_story(story.format(A=S[t], O=O))
        stat['首都长文'] = stat.get('首都长文', 0) + 1
    else:
        txt = ''.join(o.get('globalMessage').replace('\n', '') for o in seq)
        msgs = split_story(txt)
    put(T, [o.name for o in seq], msgs, COLR[t])

import os
os.makedirs(os.path.dirname(DST), exist_ok=True)
T.save(DST)
print(stat, DST)
