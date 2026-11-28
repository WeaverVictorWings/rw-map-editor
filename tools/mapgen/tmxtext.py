# -*- coding: utf-8 -*-
"""成图后改消息文本的小工具(不依赖生成器;一行一个对象或全挤一行都行)。
  T = Tmx(路径)           读入
  T.msg(name)             取消息触发器(globalMessage 所在对象)的属性字典,没有则 None
  T.set(name, text, color=None, warm=None)   改文本(自动按 26~28 字重排行)
  T.chain(names, texts, color, ...)          用一串已有触发器承载新的一串消息:多退少补,自动改接 activatedBy 和等待时间
  T.recolor(mapping)      批量换文字颜色 {'#6FB4FF':'#FF6A5A', ...}(两两对调用一次完成,不会换两遍)
  T.save(路径)
所有写出的文字走 reflow():整句成段、行宽 ≤ 30、尽量填满(避免一行十来个字就换行)。
"""
import re, html

ENDS = '。！？…」”）'
CLAUSE = '，、；：'


def _clen(s):
    return len(s)


_FW = {',': '，', ';': '；', ':': '：', '!': '！', '?': '？', '(': '（', ')': '）'}


def fw(t):
    """半角标点 → 全角(数字之间的 , : 保留,如 3,000、10:30)"""
    out = []
    for i, ch in enumerate(t):
        if ch in _FW:
            a = t[i - 1] if i else ''; b = t[i + 1] if i + 1 < len(t) else ''
            if ch in ',:' and a.isdigit() and b.isdigit():
                out.append(ch); continue
            out.append(_FW[ch])
        elif ch == '.' and i and ord(t[i - 1]) > 0x2e80:
            out.append('。')
        else:
            out.append(ch)
    return ''.join(out)


WIDTH, MAXW = 28, 30   # 行宽目标 / 上限,调用方可改


def reflow(text, width=None, maxw=None):
    width = width or WIDTH; maxw = maxw or MAXW
    """把一段话重排成若干行:先按句子,再按分句填满;一行不超过 maxw,尽量接近 width。
    文本里的显式换行当作段落分隔,各段分别排(调用方要整段重排就先自己去掉换行)。"""
    if '\n' in text.strip('\n'):
        return '\n'.join(reflow(x, width, maxw) for x in text.split('\n') if x.strip())
    t = fw(text.replace('\n', ''))
    if not t:
        return ''
    # 切成最小片段(以分句/句末标点结尾;后面紧跟收引号/括号的不在此处断开)
    pieces, cur = [], ''
    for i, ch in enumerate(t):
        cur += ch
        nxt = t[i + 1] if i + 1 < len(t) else ''
        if (ch in ENDS or ch in CLAUSE) and ch != '…' and nxt not in '”」）…，。！？、；：':
            pieces.append(cur); cur = ''
    if cur:
        pieces.append(cur)
    # 片段本身超长的(没有标点的长串)硬切
    flat = []
    for p in pieces:
        while _clen(p) > maxw:
            cut = maxw - 1
            soft = [i for i in range(8, maxw) if p[i] in '（“「' or p[i - 1] in '】）”」' and p[i] not in '，。！？、；：”」）…']
            if soft:
                cut = soft[-1]
            while cut > 8 and p[cut] in '，。！？、；：”」）…':
                cut -= 1
            flat.append(p[:cut]); p = p[cut:]
        flat.append(p)
    def lay(w):
        ls, ln = [], ''
        for p in flat:
            if _clen(ln) + _clen(p) <= w or not ln:
                ln += p
            else:
                ls.append(ln); ln = p
        if ln:
            ls.append(ln)
        return ls
    best = None
    for w in range(max(14, width - 8), maxw + 1):
        ls = lay(w)
        m_ = sum(map(_clen, ls)) / len(ls)
        sc = (len(ls), 0 if (len(ls) == 1 or _clen(ls[-1]) >= 8) else 1, round(sum((_clen(x) - m_) ** 2 for x in ls), 1))
        if best is None or sc < best[0]:
            best = (sc, ls)
    lines = best[1]
    # 末行太短(<8 字)且能并进上一行就并
    if len(lines) >= 2 and _clen(lines[-1]) < 8 and _clen(lines[-2]) + _clen(lines[-1]) <= maxw:
        lines[-2] += lines[-1]; lines.pop()
    # 行首不能是标点:挪回上一行末尾
    for i in range(1, len(lines)):
        while lines[i] and lines[i][0] in '，。、！？；：）」”…' and _clen(lines[i - 1]) < maxw:
            lines[i - 1] += lines[i][0]; lines[i] = lines[i][1:]
    return '\n'.join(l for l in lines if l)


def secs_for(text):
    n = len(text.replace('\n', ''))
    return max(3, min(10, int(n * 0.13 + 0.99)))


_PROP = re.compile(r'<property name="([^"]*)" value=("[^"]*"|\'[^\']*\')\s*/>')


def _esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;').replace('\n', '&#10;')


def _unesc(s):
    return s.replace('&#10;', '\n').replace('&#xA;', '\n').replace('&quot;', '"').replace('&apos;', "'").replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')


class Obj:
    def __init__(self, seg):
        self.seg = seg
        self.dead = False

    @property
    def name(self):
        m = re.match(r'<object\b[^>]*?\bname="([^"]*)"', self.seg)
        return m.group(1) if m else ''

    @property
    def oid(self):
        m = re.match(r'<object\b[^>]*?\bid="(\d+)"', self.seg)
        return int(m.group(1)) if m else 0

    def props(self):
        return {a: _unesc(b[1:-1]) for a, b in _PROP.findall(self.seg)}

    def get(self, k, d=None):
        m = re.search(r'<property name="%s" value=("[^"]*"|\'[^\']*\')\s*/>' % re.escape(k), self.seg)
        return _unesc(m.group(1)[1:-1]) if m else d

    def set(self, k, v):
        pat = re.compile(r'<property name="%s" value=("[^"]*"|\'[^\']*\')\s*/>' % re.escape(k))
        new = '<property name="%s" value="%s"/>' % (k, _esc(v))
        if pat.search(self.seg):
            self.seg = pat.sub(lambda m: new, self.seg, count=1)
        elif '</properties>' in self.seg:
            self.seg = self.seg.replace('</properties>', new + '</properties>', 1)
        else:
            self.seg = re.sub(r'/>\s*$', '><properties>%s</properties></object>' % new, self.seg, count=1)

    def delete(self, k):
        self.seg = re.sub(r'<property name="%s" value=("[^"]*"|\'[^\']*\')\s*/>' % re.escape(k), '', self.seg)


class Tmx:
    def __init__(self, path):
        self.text = open(path, encoding='utf-8').read()
        self.parts = []
        last = 0
        for m in re.finditer(r'<object\b[^>]*?(?:/>|>[\s\S]*?</object>)', self.text):
            self.parts.append(self.text[last:m.start()])
            self.parts.append(Obj(m.group(0)))
            last = m.end()
        self.parts.append(self.text[last:])
        self.by = {}
        for p in self.parts:
            if isinstance(p, Obj) and p.name:
                self.by.setdefault(p.name, p)
        mm = re.search(r'nextobjectid="(\d+)"', self.text)
        self.nextid = int(mm.group(1)) if mm else max(o.oid for o in self.by.values()) + 1

    # ---- 查询 ----
    def msg(self, name):
        o = self.by.get(name)
        return o if o is not None and o.get('globalMessage') is not None else None

    def referrers(self, name):
        out = []
        for p in self.parts:
            if isinstance(p, Obj) and not p.dead:
                for key in ('activatedBy', 'deactivatedBy'):
                    v = p.get(key)
                    if v and name in [x.strip() for x in v.split(',')]:
                        out.append((p, key))
        return out

    # ---- 修改 ----
    def set(self, name, text, color=None, warm=None):
        o = self.msg(name)
        if o is None:
            raise KeyError(name)
        o.set('globalMessage', reflow(text))
        if color:
            o.set('globalMessage_textColor', color)
        if warm:
            o.set('warmup', warm)

    def recolor(self, mapping):
        for p in self.parts:
            if isinstance(p, Obj) and p.get('globalMessage_textColor') in mapping:
                p.set('globalMessage_textColor', mapping[p.get('globalMessage_textColor')])

    def _clone_after(self, src, newname):
        seg = src.seg
        seg = re.sub(r'(<object\b[^>]*?\bid=")\d+(")', lambda m: m.group(1) + str(self.nextid) + m.group(2), seg, count=1)
        seg = re.sub(r'(<object\b[^>]*?\bname=")[^"]*(")', lambda m: m.group(1) + newname + m.group(2), seg, count=1)
        self.nextid += 1
        o = Obj(seg)
        y = re.search(r'\by="(-?\d+)', seg)
        if y:
            o.seg = re.sub(r'\by="(-?\d+)(\.\d+)?"', lambda m: 'y="%d"' % (int(m.group(1)) + 20), o.seg, count=1)
        i = self.parts.index(src)
        self.parts.insert(i + 1, '\n')
        self.parts.insert(i + 2, o)
        self.by[newname] = o
        return o

    def add(self, name, typ, x, y, w=20, h=20, props=None, after=None):
        """新建一个对象,插在 after(对象)后面;不给 after 就插在最后一个触发器后面"""
        seg = '<object name="%s" type="%s" id="%d" x="%s" y="%s" width="%s" height="%s"><properties>%s</properties></object>' % (
            name, typ, self.nextid, x, y, w, h,
            ''.join('<property name="%s" value="%s"/>' % (k, _esc(str(v))) for k, v in (props or {}).items()))
        self.nextid += 1
        o = Obj(seg)
        if after is None:
            after = [p for p in self.parts if isinstance(p, Obj) and re.search(r'type="(unitAdd|unitDetect|basic|mapText|maptext|unitRemove|changeCredits)"', p.seg)][-1]
        i = self.parts.index(after)
        self.parts.insert(i + 1, '\n'); self.parts.insert(i + 2, o)
        self.by[name] = o
        return o

    def kill(self, name):
        o = self.by.pop(name); o.dead = True

    def chain(self, names, texts, color=None, first_warm=None, gap=None):
        """names: 现有的一串消息触发器(按播放顺序);texts: 新文本列表。多退少补。
        后面的触发器等待时间 = 前一条的阅读时间(按字数)。链尾的被引用者改接到新的链尾。"""
        objs = [self.msg(n) for n in names]
        assert all(o is not None for o in objs), [n for n, o in zip(names, objs) if o is None]
        old_tail = objs[-1]
        old_tail_name = old_tail.name
        base = names[0]
        # 补:克隆最后一个
        while len(objs) < len(texts):
            nn = f'{base}+{len(objs)}'
            objs.append(self._clone_after(objs[-1], nn))
        # 退:多出来的删掉,它们的引用者改接到新链尾(下面统一处理)
        extra = objs[len(texts):]
        objs = objs[:len(texts)]
        removed_names = [o.name for o in extra]
        for o in extra:
            o.dead = True
        new_tail = objs[-1]
        # 链尾改名引用:原来接 old_tail_name 的(链外的),改接 new_tail
        if new_tail.name != old_tail_name:
            for r, key in self.referrers(old_tail_name):
                if r in objs:
                    continue
                vals = [new_tail.name if x.strip() == old_tail_name else x.strip() for x in r.get(key).split(',')]
                r.set(key, ','.join(dict.fromkeys(vals)))
        for i, (o, t) in enumerate(zip(objs, texts)):
            o.set('globalMessage', reflow(t))
            if color:
                o.set('globalMessage_textColor', color)
            if i > 0:
                o.set('activatedBy', objs[i - 1].name)
                o.set('warmup', gap or f'{secs_for(texts[i - 1])}s')
                if o.get('allToActivate') is not None:
                    o.delete('allToActivate')
            elif first_warm:
                o.set('warmup', first_warm)
        return objs

    def save(self, path):
        body = ''.join(p if isinstance(p, str) else ('' if p.dead else p.seg) for p in self.parts)
        body = re.sub(r'nextobjectid="\d+"', 'nextobjectid="%d"' % self.nextid, body, count=1)
        body = re.sub(r'\n[ \t]*\n', '\n', body)
        open(path, 'w', encoding='utf-8').write(body)
