#!/usr/bin/env python3
"""把中文语境里的半角标点换成全角(只处理紧挨着汉字的那种)。
用法:fw-punct.py 文件...   默认安全模式(代码里不会被误伤):, ! ? ; 紧跟汉字之后;( ) 紧贴汉字;: 仅当后面直接是汉字。
--all  连冒号也换(只用于 md/tsv 之类纯文本)。"""
import re, sys
CJK = r'[\u3400-\u9fff\u3000-\u303f\uff00-\uffef」』】》”’]'
def conv(s, all_=False):
    s = re.sub(r'(?<=' + CJK + r'),', '\uff0c', s)
    s = re.sub(r'(?<=' + CJK + r')!', '\uff01', s)
    s = re.sub(r'(?<=' + CJK + r')\?', '\uff1f', s)
    s = re.sub(r'(?<=' + CJK + r');', '\uff1b', s)
    s = re.sub(r'(?<=' + CJK + r')\(([^()\n]*?)\)', '\uff08\\1\uff09', s)
    s = re.sub(r':(?=[\u3400-\u9fff])', '\uff1a', s)
    if all_:
        s = re.sub(r'(?<=' + CJK + r'):', '\uff1a', s)
    return s
if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]; all_ = '--all' in sys.argv
    for f in a:
        t = open(f, encoding='utf8').read(); n = conv(t, all_)
        if n != t: open(f, 'w', encoding='utf8').write(n); print('改', f)
