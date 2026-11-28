# -*- coding: utf-8 -*-
# 三张图共用:长文切成若干条消息、按 1 秒节奏挂到触发链上、开场按 1 秒排开、地图文字
import sys, re
sys.path.insert(0, '/home/claude/rw-map-editor/tools/mapgen')
import tmxtext as tt
from tmxtext import Tmx, reflow, fw

tt.WIDTH, tt.MAXW = 33, 36   # 一行约 35 字

GOLD = '#FFD24A'


def clean(t):
    t = fw(t.strip())
    t = re.sub(r'[ \t]+', '', t)
    return t


def split_story(text, maxc=100):
    """长文 → 消息列表。段落(空行分隔)优先断开;段落太长按整句切,每条 ≤ maxc 字左右。"""
    paras = [clean(p).replace('\n', '') for p in re.split(r'\n\s*\n', text.strip()) if p.strip()]
    out = []
    for p in paras:
        if out and len(out[-1].replace('\n', '')) + len(p) <= maxc and len(p) <= 60:   # 短段(对话)并进上一条,保留换行
            out[-1] += '\n' + p; continue
        p = p.replace('\n', '')
        if len(p) <= maxc + 15:
            out.append(p); continue
        sents = [s for s in re.findall(r'.+?(?:[。！？]+[”」』）]*[。！？]*|$)', p) if s]
        cur = ''
        for s in sents:
            if cur and len(cur) + len(s) > maxc:
                out.append(cur); cur = s
            else:
                cur += s
        if cur:
            if out and len(cur) < 18 and len(out[-1]) + len(cur) <= maxc + 25:
                out[-1] += cur
            else:
                out.append(cur)
    return out


def total_len(text):
    return len(re.sub(r'\s', '', text))


def follow(T, head):
    """从 head 开始沿 activatedBy 往下走(只走消息触发器,且来源唯一)"""
    idx = {}
    for o in T.by.values():
        a = (o.get('activatedBy') or '').strip()
        if o.get('globalMessage') is not None and a and ',' not in a:
            idx.setdefault(a, []).append(o)
    seq = [T.msg(head)]
    while True:
        nx = [o for o in idx.get(seq[-1].name, []) if not o.dead]
        if not nx:
            break
        seq.append(nx[0])
    return seq


def put(T, names, msgs, colors):
    """用一串触发器承载 msgs(1 秒一条);colors 可以是单色或与 msgs 等长的列表"""
    objs = T.chain(names, msgs, gap='1s')
    if isinstance(colors, str):
        colors = [colors] * len(objs)
    for o, c in zip(objs, colors):
        o.set('globalMessage_textColor', c)
    return objs


def timed(T, names, items, start=2, gap=1):
    """开场类:items=[(文本,颜色)],第 i 条在 start+i*gap 秒出现(delay)。names 是现有开场对象,多退少补。"""
    objs = [T.msg(n) for n in names]
    base = names[0]
    while len(objs) < len(items):
        objs.append(T._clone_after(objs[-1], f'{base}+{len(objs)}'))
    for o in objs[len(items):]:
        o.dead = True
    for i, (o, (tx, c)) in enumerate(zip(objs, items)):
        o.set('globalMessage', reflow(tx)); o.set('globalMessage_textColor', c); o.set('delay', f'{start + i * gap}s')
    return objs[:len(items)]


def maptext(T, name, x, y, text, size=18, color='#FFFFFF', after=None):
    return T.add(name, 'maptext', x, y, 20, 20, {'text': text, 'textSize': size, 'textColor': color, 'resetActivationAfter': '2s'}, after=after)
