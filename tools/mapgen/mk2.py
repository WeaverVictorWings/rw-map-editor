# ---------------- triggers (adapted from build8) ----------------
import asm_g as asm
CT=0
trig=[]; tid=[20000]; row=[0]
def T(name,typ,x,y,w,h,props):
    tid[0]+=1; trig.append(dict(id=tid[0],name=name,type=typ,x=int(x),y=int(y),w=int(w),h=int(h),props=props))
def nxt(): row[0]+=20; return (-60,row[0])
FULL=(0,0,W*20,H*20)
def rect(q,r=5): return ((q['px']-r)*20,(q['py']-r)*20,(2*r+1)*20,(2*r+1)*20)
import re as _re
def _wrap1(t,w):
    parts=[p for p in _re.findall(r'[^,。!?:;…,!?:;、，！？：；]*[,。!?:;…,!?:;、，！？：；]*',t) if p]
    lines=[];cur=''
    for p in parts:
        while len(p)>w+2:
            if cur: lines.append(cur);cur=''
            lines.append(p[:w]);p=p[w:]
        if len(cur)+len(p)>w and cur: lines.append(cur);cur=''
        cur+=p
    if cur: lines.append(cur)
    return lines
def _wrap(t,w=30):
    out=[]
    for ln in t.split('\n'): out+=(_wrap1(ln,w) if len(ln)>w+2 else [ln])
    return '\n'.join(out)
def msg(name,text,color,act=None,warm='1s',allr=False,delay=None,extra=None):
    assert len(text)<=140,(len(text),text)
    text=_wrap(text)
    x,y=nxt(); p={'globalMessage':text,'team':'-1','globalMessage_textColor':color}
    if act: p['activatedBy']=act
    if allr: p['allToActivate']='true'
    if warm: p['warmup']=warm
    if delay: p['delay']=delay
    if extra: p.update(extra)
    T(name,'unitAdd',x,y,20,20,p)
def label(name,text,x,y,size,color,extra=None):
    p={'text':text,'textSize':str(size),'textColor':color,'resetActivationAfter':'2s'}
    if extra: p.update(extra)
    T(name,'maptext',x,y,20,20,p)
def narrative(base,header,hcol,lines,scol,act,allr=False,deact=None,first='1s',step='3s'):
    seq=([(header,hcol)] if header else [])+[(l,scol) for l in lines]; prev=act
    for i_,(t_,c_) in enumerate(seq):
        n=f'{base}{i_+1}'; msg(n,t_,c_,prev,first if i_==0 else step,allr and i_==0,extra={'deactivatedBy':deact} if deact else None); prev=n
    return prev
DISP={s:('中国' if s in (1,3,5,7,9) else NAT[s]) for s in NAT}
caps={q['slot']:q for q in cities if q['cap']}; assert len(caps)==len(NAT)
BYZH={q['zh']:q for q in cities}
GOALN=spec.GOALN; GQ={c:[BYZH[n] for n in v] for c,v in GOALN.items()}
HOLD='180s'
T('map_info','map_info',0,0,20,20,{'type':'skirmish','winCondition':'mainBuildings','loseCondition':'commandCenter','fog':'map','shareFogWithAllies':'true','title':spec.TITLE,'description':spec.DESC,'introText':f'-{spec.TITLE}- 阵营对抗'})
trig[-1]['type']=''
for s in NAT:
    T(f'队伍设置{s}-{NAT[s]}','team_info',-60,2000+20*(s-1),20,20,{'team':str(s-1),'credits':str([3500,5000,6500,8500,10500][spec.POWER[s]-1]),'allyGroup':'1' if CAMP[s]=='A' else '2'}); trig[-1]['type']='team_info'
LBL={'cap':20,'major':15,'minor':11}; LOFF={'cap':10,'major':8,'minor':7}
RADIUS={'cap':120,'major':100,'minor':50}
def key_city(q): return q['cap'] or q['tier']=='major'
def team_set(q,R,k=3):
    x,y=q['px'],q['py']; own=q['owner']
    TS=set(o['owner'] for o in cities if o['owner']>=0 and (o['px']-x)**2+(o['py']-y)**2<=R*R)|({own} if own>=0 else set())
    dist={}
    for o in cities:
        if o['owner']>=0: dist[o['owner']]=min(dist.get(o['owner'],1e18),(o['px']-x)**2+(o['py']-y)**2)
    for camp in 'AB':
        cand=sorted((d,t) for t,d in dist.items() if CAMP[t+1]==camp); TS|={t for _,t in cand[:k]}
    return sorted(TS)
for ci,q in enumerate(cities):
    x,y=q['px'],q['py']; r=(x-1)*20,(y-1)*20,60,60; cx,cy=x*20,y*20
    T(f'检测{ci}','unitDetect',*r,{'unitType':'commandCenter','maxUnits':'0','resetActivationAfter':'600'})
    T(f'刷新{ci}','unitAdd',cx,cy,20,20,{'spawnUnits':'commandCenter','team':'-1','resetActivationAfter':'10s','activatedBy':f'检测{ci}'})
    T(f'补刷{ci}','unitAdd',cx,cy,20,20,{'spawnUnits':'commandCenter','team':'-1','resetActivationAfter':'10s','activatedBy':f'检测{ci}','warmup':'8s'})
    q['ci']=ci; kind='cap' if q['cap'] else q['tier']
    label(f'城名{ci}',q['zh'],cx,max(20,int((y-LOFF[kind])*20)),LBL[kind],GOLD if key_city(q) else NEUT)
    q['TS']=team_set(q,RADIUS[kind],4 if q['cap'] else 3)
for q in cities:
    if q['cap']: continue
    ci=q['ci']; x,y=q['px'],q['py']; r=(x-1)*20,(y-1)*20,60,60; TS=q['TS']; own=q['owner']
    if own>=0: T(f'锁{ci}','basic',x*20,y*20,20,20,{'activatedBy':f'检测{ci}'})
    for t in TS:
        s_=t+1; c=COLC[CAMP[s_]]
        p={'unitType':'commandCenter','minUnits':'1','team':str(t)}
        if t==own: p.update({'activatedBy':f'锁{ci}','allToActivate':'true'})
        T(f'占{ci}_{t}','unitDetect',*r,p)
        if own<0: kk,fm='neutral',dict(A=DISP[s_],C=q['zh'])
        elif t==own: kk,fm='back',dict(A=DISP[s_],C=q['zh'])
        elif CAMP[s_]==CAMP[own+1]: kk,fm='ally',dict(A=DISP[s_] if DISP[s_]!=DISP[own+1] else NAT[s_],O=DISP[own+1] if DISP[s_]!=DISP[own+1] else NAT[own+1],C=q['zh'])
        else: kk,fm='enemy',dict(A=DISP[s_],O=DISP[own+1],C=q['zh'])
        _H=T5.HEAD[kk]; _A=T5.AFTER[kk]
        msg(f'占{ci}_{t}讯',_H[(ci+t)%len(_H)].format(**fm),c,f'占{ci}_{t}','1s')
        _ix=[(ci*3+t+7*k)%len(_A) for k in range(6)]; _pk=[]
        for _j in _ix:
            if _j not in _pk: _pk.append(_j)
            if len(_pk)==4: break
        while len(_pk)<4: _pk.append((_pk[-1]+1)%len(_A))
        msg(f'占{ci}_{t}讯2',_A[_pk[0]].format(**fm)+_A[_pk[1]].format(**fm),c,f'占{ci}_{t}讯','2s'); msg(f'占{ci}_{t}讯3',_A[_pk[2]].format(**fm)+_A[_pk[3]].format(**fm),c,f'占{ci}_{t}讯2','3s')
for s_,q in caps.items(): label(f'势名{s_}',' '.join(NAT[s_]),q['px']*20,(q['py']-20)*20,20,COLC[CAMP[s_]])
occ2=set((o['x'],o['y']) for o in objs)
def spawn_pt(q):
    for r in range(11,18):
        for a in range(0,360,12):
            x=int(q['px']+r*math.cos(math.radians(a))); y=int(q['py']+r*math.sin(math.radians(a)))
            if 3<=x<W-3 and 3<=y<H-3 and (P[y-2:y+3,x-2:x+3]==13).all() and not rock[y-2:y+3,x-2:x+3].any() and not any((x+i,y+j) in occ2 for i in range(-2,3) for j in range(-2,3)): return x*20,y*20
    return q['px']*20,q['py']*20
SP={s:spawn_pt(caps[s]) for s in NAT}
n0={s:sum(1 for q in cities if q['slot']==s) for s in NAT}
MS=[('heavyTank*8,mechMissile*4,mechGun*4,fireBee*4',3000,3),('heavyTank*14,mechLaser*8,mechHeavyMissile*6,fireBee*8',6000,8),('heavyTank*22,mechLaser*12,mechHeavyMissile*10,fireBee*14',12000,16)]
for s in NAT:
    t=s-1; c=COLC[CAMP[s]]
    for k,(sp_,cr,add_) in enumerate(MS):
        m=n0[s]+add_; nm=f'国{s}_{k}'
        T(nm,'unitDetect',*FULL,{'unitType':'commandCenter','minUnits':str(m),'team':str(t),'resetActivationAfter':'200'})
        msg(nm+'讯',T5.MILE[k][0].format(N=DISP[s],m=m)+'\n'+T5.MILE[k][1],c,nm,'2s')
        x,y=nxt(); T(nm+'兵','unitAdd',SP[s][0],SP[s][1],20,20,{'spawnUnits':sp_,'team':str(t),'activatedBy':nm,'warmup':'3s'})
        x,y=nxt(); T(nm+'钱','changeCredits',x,y,20,20,{'team':str(t),'add':str(cr),'activatedBy':nm,'warmup':'3s'})
_g=[]; 
for tx,c in spec.INTRO:
    if _g and _g[-1][1]==c and len(_g[-1][0])<3 and c!=GOLD: _g[-1][0].append(tx)
    else: _g.append(([tx],c))
for i,(ls,c) in enumerate(_g): msg(f'开场{i+1}','\n'.join(ls),c,None,None,delay=f'{3+3*i}s')
for i,(sec,tx) in enumerate(spec.PHASE): msg(f'战局{i+1}',tx,GOLD,None,f'{sec}s')
for i,(sec,tx) in enumerate(spec.TIPS): msg(f'提示{i+1}',tx,'white',None,f'{sec}s')
END='胜A,胜B'
import texts_dead_asia as TD
def dead_lines(s): return TD.DEAD[s][:-1]+TD.MORE[s]+TD.DEAD[s][-1:]
def fall_lines(s,q): return TD.FALL[s]
for s in NAT:
    t=s-1
    T(f'活{s}','unitDetect',*FULL,{'unitType':'commandCenter','team':str(t),'minUnits':'1','delay':'15s','allToActivate':'true'})
    T(f'亡{s}','unitDetect',*FULL,{'unitType':'commandCenter','team':str(t),'maxUnits':'0','warmup':'45s'})
    T(f'灭{s}','basic',0,0,20,20,{'activatedBy':f'活{s},亡{s}','allToActivate':'true','deactivatedBy':END})
    narrative(f'灭{s}报',f'【{NAT[s]}覆灭】最后的指挥中心已被摧毁',COLC[CAMP[s]],dead_lines(s),COLC[CAMP[s]],f'灭{s}',deact=END)
for s,q in caps.items():
    x,y,w,h=rect(q); camp=CAMP[s]; en=OTHER[camp]
    for t in TEAMS[en]: T(f'据落{s}_{t}','unitDetect',x,y,w,h,{'unitType':'commandCenter','team':str(t),'minUnits':'1'})
    T(f'陷{s}','basic',x,y,20,20,{'activatedBy':','.join(f'据落{s}_{t}' for t in TEAMS[en])})
    narrative(f'陷{s}报',f'【首府陷落】{q["zh"]}失守',COLC[en],fall_lines(s,q),COLC[CAMP[s]],f'陷{s},活{s}',allr=True,deact=END)
RS='600'
ALL10=GQ['A']+GQ['B']
for camp in 'AB':
    srcs=[]
    for j,q in enumerate(ALL10):
        x,y,w,h=rect(q); key=f'{camp}{j}'
        for t in TEAMS[camp]: T(f'据{key}_{t}','unitDetect',x,y,w,h,{'unitType':'commandCenter','team':str(t),'minUnits':'1','resetActivationAfter':RS})
        T(f'守{key}','basic',x,y,20,20,{'activatedBy':','.join(f'据{key}_{t}' for t in TEAMS[camp]),'resetActivationAfter':RS}); srcs.append(f'守{key}')
    T(f'满{camp}','basic',0,0,20,20,{'activatedBy':','.join(srcs),'allToActivate':'true','resetActivationAfter':RS})
    msg(f'守报{camp}0','【坚守】十座代表城市已全部在手!三分钟倒计时开始!',COLC[camp],f'满{camp}','1s')
    for k,(sec,tx) in enumerate([('60s','【坚守】已守住一分钟。敌军正在集结,反扑随时会来。'),('120s','【坚守】已守住两分钟!再坚持一分钟,战争就将结束。'),('170s','【坚守】最后十秒!守住阵地,一步也不要退!')]):
        msg(f'守报{camp}{k+1}',tx,COLC[camp],f'满{camp}',sec)
    T(f'胜{camp}','basic',0,0,20,20,{'activatedBy':f'满{camp}','warmup':HOLD})
    V=[f'【{CAMPN[camp]}胜利】十座代表城市尽在掌握。','、'.join(GOALN['A']+GOALN['B'])+'。','三分钟的坚守结束,对面的指挥部,没有再发来任何新的命令。','战争结束了,谈判桌已经摆好。']
    last=narrative(f'终{camp}',None,None,V,COLC[camp],f'胜{camp}',step='1s')
    msg(f'尾{camp}0','【提示】战场即将清理,感谢每一位玩家的参与。',GOLD,last,'3s')
    for t in TEAMS[OTHER[camp]]: T(f'清{camp}_{t}','unitRemove',*FULL,{'team':str(t),'activatedBy':f'胜{camp}','warmup':'40s'})
for zh,lon,lat in spec.SEAS:
    x,y=ll2px(lon,lat)
    if 2<y<H-2 and 2<x<W-2: label('海名_'+zh,' '.join(zh),int(x)*20,int(y)*20,18,'#8FA8C0')
for a,(zh,lon,lat) in spec.CTRY.items():
    x,y=ll2px(lon,lat); label('国名_'+zh,zh,int(x)*20,int(y)*20,16,NEUT)
print(len(trig),'triggers',len(objs),'units')
OUT=WGD+f'out/{spec.TITLE}_v0.4.tmx'
asm.assemble(trig,OUT,items,objs,WGD+f'out/{TAG}_base.tmx')
json.dump(dict(trig=trig),open(WGD+f'out/{TAG}_trig.json','w'),ensure_ascii=False)
print('wrote',OUT)
