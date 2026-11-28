import sys,re,collections
sys.path.insert(0,'/home/claude/w8')
from common import *
T=Tmx(sys.argv[1])
ms=[o for o in T.by.values() if o.get('globalMessage') is not None and not o.dead]
L=[len(l) for o in ms for l in o.get('globalMessage').split('\n')]
bad=[o.name for o in ms if re.search(r'\{[A-Za-z]\}|[,:;!?()]',o.get('globalMessage'))]
lead=[o.name for o in ms if any(l and l[0] in '，。！？、；：”」）…' for l in o.get('globalMessage').split('\n'))]
rep=[o.name for o in ms if re.search(r'记者|随军|电台·|【.{0,6}日记】',o.get('globalMessage'))]
print('消息',len(ms),'最长行',max(L),'≤8字行',sum(1 for x in L if x<=8),'/',len(L),'占位符/半角',bad[:5],'行首标点',lead[:5],'记者类',len(rep),rep[:5])
w=collections.Counter((o.get('warmup') or '') for o in ms if o.get('activatedBy'))
print('链内间隔分布',w.most_common(6))
