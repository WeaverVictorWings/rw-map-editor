import sys,json,math,random,re,base64,zlib,subprocess,importlib,numpy as np
sys.path.insert(0,'/home/claude/wg'); sys.path.insert(0,'/home/claude/eu/v5'); sys.path.insert(0,'/home/claude/eu/v3')
from lib1 import *
from xml.sax.saxutils import quoteattr
import texts_asia as T5
spec=importlib.import_module(sys.argv[1]); TAG=spec.TAG; WGD='/home/claude/wg/'
cfg=spec.cfg; ll2px,px2ll=proj(cfg); H,W=cfg['H'],cfg['W']
import warpmod
ll2px,_fw,_iv,_rs=warpmod.make(cfg,ll2px,getattr(spec,'WARPS',[]))
T0=np.load(WGD+f'data/{TAG}_T.npy'); cty=np.load(WGD+f'data/{TAG}_cty.npy'); cnames=json.load(open(WGD+f'data/{TAG}_names.json'))
E=np.load(WGD+f'data/{TAG}_elev.npy')
subprocess.run(['node','/home/claude/eu/py/dumppass.mjs',WGD+f'out/{TAG}_base.tmx',WGD+f'out/{TAG}_pass0.u8'],check=True,capture_output=True)
P=np.fromfile(WGD+f'out/{TAG}_pass0.u8',np.uint8).reshape(H,W)
TS={}
for l in open('/home/claude/eu/TSChar.txt',encoding='utf8'):
    p=l.rstrip('\n').split('\t')
    if len(p)==2 and not l.startswith('#'): TS[p[0]]=p[1].split()[0]
simp=lambda t:''.join(TS.get(ch,ch) for ch in t)
NAT={s:v['zh'] for s,v in spec.SEATS.items()}; CAMP={s:('A' if s%2 else 'B') for s in NAT}
COLC={'A':'#6FB4FF','B':'#FF6A5A'}; OTHER={'A':'B','B':'A'}; CAMPN=spec.CAMPN
TEAMS={c:[s-1 for s in NAT if CAMP[s]==c] for c in 'AB'}
GOLD='#FFD24A'; NEUT='#D0D0D0'; MINT,VIOLET,PINK='#5EE6A8','#B38CFF','#FF8AD0'; STORY=[MINT,VIOLET,PINK]
print(TAG,W,H,'land ok',int((P==13).sum()))
# ---------------- cities ----------------
pl=json.load(open(WGD+'data/places_full.geojson'))['features']
cand=[]
for f in pl:
    p=f['properties']; lon,lat=p['LONGITUDE'],p['LATITUDE']
    if not(cfg['lon0']<lon<cfg['lon1'] and cfg['lat1']<lat<cfg['lat0']): continue
    x,y=ll2px(lon,lat); x=int(x); y=int(y)
    if not(6<=x<W-6 and 6<=y<H-6): continue
    nm=p['NAME']; zh=spec.ZH.get(nm) or simp(p.get('NAME_ZH') or nm)
    cand.append(dict(name=nm,zh=zh,px=x,py=y,pop=p.get('POP_MAX') or 0,adm0=p['ADM0NAME'],adm1=p.get('ADM1NAME'),ncap=(p.get('FEATURECLA') or '').startswith('Admin-0 capital'),cty=int(cty[y,x])))
def land_near(c):
    for r in range(0,7):
        for dy in range(-r,r+1):
            for dx in range(-r,r+1):
                if max(abs(dx),abs(dy))==r:
                    x,y=c['px']+dx,c['py']+dy
                    if 0<=x<W and 0<=y<H and (P[y-3:y+4,x-3:x+4]==13).all(): c['px'],c['py']=x,y; return True
    return False
cities=[]; byname={c['name']:c for c in cand}
def mk_city(c,slot,cap):
    q=dict(c); q['owner']=slot-1 if slot else -1; q['slot']=slot or 0; q['cap']=cap
    q['camp']=CAMP[slot] if slot else None; q['natcap']=cap or c['ncap']; return q
for s,v in spec.SEATS.items():
    c=byname[v['cap']]
    if v.get('zh_city'): c=dict(c); c['zh']=v['zh_city']
    assert land_near(c),v['cap']; cities.append(mk_city(c,s,True))
def far(c,d): return all((c['px']-q['px'])**2+(c['py']-q['py'])**2>=d*d for q in cities)
done_names={q['name'] for q in cities}
nown=0;nneu=0
for c in sorted(cand,key=lambda c:-c['pop']):
    if c['name'] in done_names or c['name'] in spec.SKIP: continue
    slot=spec.owner_of(c)
    if c['cty']==0: continue
    if slot is None:
        if nneu>=spec.NEUT_N or c['pop']<spec.NEUT_POP: continue
        d=spec.DMIN_N
    else:
        if nown>=spec.OWN_N or c['pop']<spec.OWN_POP: continue
        if sum(1 for q in cities if q['slot']==slot)>=getattr(spec,'QUOTA',{}).get(slot,999): continue
        d0=getattr(spec,'DMIN_SEAT',{}).get(slot,spec.DMIN); d=d0 if c['pop']<1_500_000 else d0+4
    if not far(c,d) or not land_near(c): continue
    if not far(c,d): continue
    cities.append(mk_city(c,slot,False)); done_names.add(c['name'])
    if slot is None: nneu+=1
    else: nown+=1
# force-add
for nm in spec.FORCE:
    if nm in done_names: continue
    if nm not in byname: continue
    c=byname[nm]; slot=spec.owner_of(c)
    if not land_near(c): print('FORCE 无法落地',nm); continue
    cities=[q for q in cities if (q['px']-c['px'])**2+(q['py']-c['py'])**2>=18**2 or q['cap']]
    cities.append(mk_city(c,slot,False))
# unique zh
seen={}
for q in cities:
    if q['zh'] in seen: q['zh']=q['zh']+'二' ; 
    seen[q['zh']]=1
for q in cities:
    q['tier']='cap' if q['cap'] else ('major' if q['pop']>=1_000_000 or q['natcap'] else 'minor')
    q['camp']=CAMP[q['slot']] if q['slot'] else None
print('cities',len(cities),'owned',sum(1 for q in cities if q['owner']>=0),'neutral',sum(1 for q in cities if q['owner']<0))
# ---------------- rock: rivers + ridges ----------------
rng=np.random.default_rng(11)
img=Image.new('L',(W,H),0); dr=ImageDraw.Draw(img)
gj=json.load(open(WGD+'data/rivers.geojson')); lines=[]
for f in gj['features']:
    if f['properties'].get('name') in spec.RIVERS:
        cs=f['geometry']['coordinates']; cs=cs if f['geometry']['type']=='MultiLineString' else [cs]
        for c in cs: lines.append([ll2px(*p[:2]) for p in c])
for s in lines: dr.line(s,fill=255,width=4)
river=np.array(img)>0
if getattr(spec,'RIVER_WATER',False): river[:]=False; lines=[]     # 河流已在地形里做成水面,这里不再放岩石
ridge=np.zeros((H,W),bool)
if spec.RIDGE:
    Es=ndi.gaussian_filter(E,2.0); loc=Es-ndi.gaussian_filter(E,10)
    ridge=(Es>spec.RIDGE[0])&(loc>spec.RIDGE[1])&(cty>0)
    if getattr(spec,'RIDGE_THIN',False):                              # 只留细长弧线:骨架 → 滤掉短段 → 加宽到约 3 格
        from skimage.morphology import skeletonize
        sk=skeletonize(ridge); lb,nb=ndi.label(sk,structure=np.ones((3,3))); szb=ndi.sum(sk,lb,range(1,nb+1))
        keep=np.zeros_like(sk)
        for i_,s__ in enumerate(szb):
            if s__>=getattr(spec,'RIDGE_MINLEN',45): keep|=(lb==i_+1)
        ridge=ndi.binary_dilation(keep,iterations=1)
    else:
        ridge=ndi.binary_dilation(ridge,iterations=1)
if getattr(spec,'RANGES',None):
    _ri=Image.new('L',(W,H),0); _rd=ImageDraw.Draw(_ri)
    for _nm,_pts in spec.RANGES: _rd.line([ll2px(*p) for p in _pts],fill=255,width=4)
    ridge|=(np.array(_ri)>0)&(cty>0)
rock=river|ridge
ys,xs=np.mgrid[0:H,0:W]; gap=np.zeros((H,W),bool)
for s in lines:
    acc=0;nxt=rng.uniform(14,34)
    for (x0,y0),(x1,y1) in zip(s,s[1:]):
        acc+=math.hypot(x1-x0,y1-y0)
        if acc>=nxt: acc=0;nxt=rng.uniform(30,42); gap|=(xs-x1)**2+(ys-y1)**2<=4.2**2
# ridge passes: every ~36 px of ridge via grid sampling
lab,n=ndi.label(ridge,structure=np.ones((3,3)))
for i in range(1,n+1):
    yy,xx=np.where(lab==i)
    if len(yy)<40: continue
    k=max(1,len(yy)//52)
    for j in rng.choice(len(yy),k,replace=False): gap|=(xs-xx[j])**2+(ys-yy[j])**2<=5.5**2
for q in cities:
    r=13 if q['cap'] else 11; gap|=(xs-q['px'])**2+(ys-q['py'])**2<=r*r
rock&=~gap; rock&=(P==13)
lab,n=ndi.label(rock,structure=np.ones((3,3))); sz=ndi.sum(rock,lab,range(1,n+1))
for i,s_ in enumerate(sz):
    if s_<12: rock[lab==i+1]=False
# connectivity: carve straight passes so every city reaches the main landmass component of its island
def comps(m): return ndi.label(m,structure=np.array([[0,1,0],[1,1,1],[0,1,0]]))
for it in range(40):
    okm=(P==13)&~rock; lab,n=comps(okm)
    cl=[lab[q['py'],q['px']] for q in cities]; cnt=np.bincount([c for c in cl if c>0],minlength=n+1)
    # components that hold cities but are small relative: try to merge pairs of comps that are close and both hold >=1 city
    pairs=[]
    ids=[i for i in range(1,n+1) if cnt[i]>0]
    if len(ids)<=1: break
    # connect each non-largest comp to nearest city of another comp if a rock-only gap (<=14px) separates
    changed=False
    for i in ids:
        mine=[q for q,c in zip(cities,cl) if c==i]
        best=None
        for q in mine:
            for q2,c2 in zip(cities,cl):
                if c2==i or c2<=0: continue
                d=math.hypot(q['px']-q2['px'],q['py']-q2['py'])
                if best is None or d<best[0]: best=(d,q,q2)
        if best and best[0]<=120:
            d,q,q2=best; n_=int(d)+1
            xsl=np.linspace(q['px'],q2['px'],n_).astype(int); ysl=np.linspace(q['py'],q2['py'],n_).astype(int)
            before=rock.sum()
            for x_,y_ in zip(xsl,ysl): rock[max(0,y_-2):y_+3,max(0,x_-2):x_+3]=False
            if rock.sum()<before: changed=True
    if not changed: break
okm=(P==13)&~rock; lab,n=comps(okm)
cl=[lab[q['py'],q['px']] for q in cities]; main=np.bincount(cl).argmax()
print('city components',len(set(cl)),'cities off-main',sum(1 for c in cl if c!=main))
np.save(WGD+f'out/{TAG}_rock.npy',rock)
# ---------------- placement ----------------
ok=(P==13)&~rock; water=(P==6); nav=(P&2)>0
nd=ndi.distance_transform_edt(~water); ndn=ndi.distance_transform_edt(~nav)
wl,_=ndi.label(water); wsz=np.bincount(wl.ravel())
occ=np.zeros((H,W),bool)
def free(x,y,r,m=0):
    if x-r-m<0 or y-r-m<0 or x+r+m>=W or y+r+m>=H: return False
    return bool(ok[y-r:y+r+1,x-r:x+r+1].all() and not occ[y-r-m:y+r+1+m,x-r-m:x+r+1+m].any())
def take(x,y,r): occ[y-r:y+r+1,x-r:x+r+1]=True
items=np.zeros((H,W),np.uint32); items[rock]=415
objs=[]; oid=[1000]
def add(unit,team,x,y,name=None):
    oid[0]+=1; o=dict(id=oid[0],unit=unit,team=team,x=int(x),y=int(y))
    if name: o['name']=name
    objs.append(o)
for q in cities:
    x,y=q['px'],q['py']; done=False
    for r in range(0,12):
        for dy in range(-r,r+1):
            for dx in range(-r,r+1):
                if max(abs(dx),abs(dy))==r and free(x+dx,y+dy,3): q['px'],q['py']=x+dx,y+dy; done=True; break
            if done: break
        if done: break
    assert done,q['zh']
    take(q['px'],q['py'],3)
occ[:]=False
def ring(cx,cy,r0,r1,rng):
    a=rng.uniform(0,2*math.pi); r=rng.uniform(r0,r1); return int(round(cx+r*math.cos(a))),int(round(cy+r*math.sin(a)))
def put_pool(cx,cy,team,w,h,ext,rng):
    for _ in range(120):
        ang=rng.uniform(0,2*math.pi); r=rng.uniform(4.5,8.5)
        x0=int(round(cx+r*math.cos(ang)))-w//2; y0=int(round(cy+r*math.sin(ang)))-h//2
        if x0<1 or y0<1 or x0+w+1>=W or y0+h+1>=H: continue
        if not ok[y0:y0+h,x0:x0+w].all() or occ[y0-1:y0+h+1,x0-1:x0+w+1].any(): continue
        if abs(x0+w/2-cx)<3.6 and abs(y0+h/2-cy)<3.6: continue
        items[y0:y0+h,x0:x0+w]=372; occ[y0-1:y0+h+1,x0-1:x0+w+1]=True
        for j in range(h):
            for i in range(w): add(ext,team,x0+i,y0+j)
        return True
    return False
def place_unit(u,team,cx,cy,rng,r0=3,r1=8):
    for _ in range(120):
        ux,uy=ring(cx,cy,r0,r1,rng)
        if 0<=ux<W and 0<=uy<H and ok[uy,ux] and not occ[uy,ux]: occ[uy,ux]=True; add(u,team,ux,uy); return True
    return False
def place_big(u,team,cx,cy,rng,r0,r1,name=None):
    for _ in range(120):
        fx,fy=ring(cx,cy,r0,r1,rng)
        if free(fx,fy,1,1): take(fx,fy,1); add(u,team,fx,fy,name); return (fx,fy)
    return None
SPEC_=['mechArtillery','mechLaser','mechMissile','mechMinigun','mechHeavyMissile']
def seafac(q,team,rng,nships,ship='battleShip',minc=10000,rmax=40):
    x,y=q['px'],q['py']; best=None
    for r in range(7,rmax):
        for ang in range(0,360,9):
            xx=int(round(x+r*math.cos(math.radians(ang)))); yy=int(round(y+r*math.sin(math.radians(ang))))
            if 12<=xx<W-12 and 12<=yy<H-12 and min(cities,key=lambda c:(c['px']-xx)**2+(c['py']-yy)**2) is q and 1.0<=ndn[yy,xx]<=2.0 and nd[yy,xx]<=4.0 and free(xx,yy,1):
                box=water[yy-8:yy+9,xx-8:xx+9]
                if box.mean()<0.32 or nav[yy-2:yy+3,xx-2:xx+3].mean()<0.16: continue   # 17x17 内水≥32%,且紧邻 5x5 内可航行格≥16%(RWKit F01)
                ys_,xs_=np.where(box)
                if wsz[wl[yy-8+ys_[0],xx-8+xs_[0]]]>=minc:
                    k_=np.argmin((ys_-8)**2+(xs_-8)**2); best=(xx,yy,yy-8+ys_[k_],xx-8+xs_[k_]); break
        if best: break
    if not best: return False
    take(best[0],best[1],1); add('seaFactory',team,best[0],best[1])
    wy,wx=best[2],best[3]; got=0
    for (dx,dy) in ((0,0),(2,0),(-2,0),(0,2)):
        if got>=nships: break
        X,Y=wx+dx,wy+dy
        if 0<=X<W and 0<=Y<H and water[Y,X] and wsz[wl[Y,X]]>=minc and not occ[Y,X]: occ[Y,X]=True; add(ship,team,X,Y); got+=1
    return True
PW=spec.POWER
SPECS=['mechArtillery','mechLaser','mechMissile','mechMinigun','mechHeavyMissile','mechGun']
def place_group(u,team,n,cx,cy,rng,r0=6,r1=13,step=4):
    for k in range(n,0,-1):
        for _ in range(140):
            fx,fy=ring(cx,cy,r0,r1,rng); xs_=[fx+step*i for i in range(k)]
            if all(free(x_,fy,1,1) for x_ in xs_):
                for x_ in xs_: take(x_,fy,1); add(u,team,x_,fy)
                return k
    return 0
def pools(x,y,t,rng,spec_list):
    for (w,h,e) in spec_list: put_pool(x,y,t,w,h,e,rng)
for ci,q in enumerate(cities):
    rng=random.Random(3000+ci); x,y=q['px'],q['py']; t=q['owner']; own=t>=0; tier=q['tier']
    take(x,y,3); add('commandCenter',t if own else -2,x,y,q['zh'])
    q['border']=False; q['port']=False
    if own:
        q['border']=min((math.hypot(x-r['px'],y-r['py']) for r in cities if r['camp'] and r['camp']!=q['camp']),default=999)<45
    if not own:
        pls=[(2,2,'extractorT1')]*(2 if (q['cap'] or q['pop']>2_000_000) else 1)
        pools(x,y,-2,rng,pls)
        for u in ['heavyTank']*(3 if q['pop']>1_000_000 else 2)+['mechGun']*4+(['fireBee'] if q['pop']>1_000_000 else []): place_unit(u,-2,x,y,rng,3,9)
        if q['pop']>2_000_000: place_group('landFactory',-2,1,x,y,rng)
        continue
    p=PW[q['slot']]; i=p-1
    if tier=='cap':
        pools(x,y,t,rng,[(2,4,'extractorT2')]*(1+p//4)+[(2,2,'extractorT1')]*2)
        place_group('experimentalLandFactory',t,[0,0,0,3,3][i],x,y,rng)
        place_group('airFactory',t,[1,1,1,1,2][i],x,y,rng)
        place_group('landFactory',t,[1,1,1,2,3][i],x,y,rng)
        if p>=5: place_group('mechFactory',t,3,x,y,rng)
        for k in range(2):
            for dx,dy in ((-5,0),(5,0),(0,5),(0,-5),(5,5),(-5,-5)):
                fx,fy=x+dx,y+dy
                if free(fx,fy,1): take(fx,fy,1); add('fabricatorT2',t,fx,fy); break
        for k in range(4): place_unit('builder',t,x,y,rng,3,9)
        for k in range([6,8,10,12,15][i]): place_unit('heavyTank',t,x,y,rng,3,11)
        for u in SPECS: place_unit(u,t,x,y,rng,3,10)
        for k in range([1,2,3,4,5][i]): place_unit('fireBee',t,x,y,rng,3,10)
    elif tier=='major':
        pools(x,y,t,rng,[(2,3,'extractorT2')]+([(2,2,'extractorT1')] if rng.random()<0.4 else []))
        if p>=4 and q['pop']>5_500_000: place_group('experimentalLandFactory',t,3,x,y,rng)
        if p>=3 and q['pop']>2_500_000: place_group('landFactory',t,1,x,y,rng)
        if p>=3 and q['pop']>3_000_000: place_group('airFactory',t,[1,1,1,1,2][i],x,y,rng)
        for dx,dy in ((-5,0),(5,0),(0,5),(0,-5)):
            if free(x+dx,y+dy,1): take(x+dx,y+dy,1); add('fabricatorT2',t,x+dx,y+dy); break
        place_unit('builder',t,x,y,rng,3,8)
        for k in range([2,3,4,5,6][i]+(1 if q['border'] else 0)): place_unit('heavyTank',t,x,y,rng,3,10)
        for u in ['mechGun','mechMinigun']+rng.sample(SPECS,1+(1 if p>=4 else 0)): place_unit(u,t,x,y,rng,3,9)
        for k in range([0,0,1,1,2][i]): place_unit('fireBee',t,x,y,rng,3,9)
    else:
        pools(x,y,t,rng,[(2,2,'extractorT1')])
        if p>=4 and rng.random()<0.12: place_group('landFactory',t,1,x,y,rng,6,10)
        for u in ['heavyTank']*([1,1,1,2,2][i]+(1 if q['border'] else 0))+['mechGun']+([rng.choice(SPECS)] if p>=3 else [])+(['fireBee'] if (p>=4 and rng.random()<0.35) else []): place_unit(u,t,x,y,rng,3,8)
# ---- 舰队:按各国真实规模放在己方沿海城市附近的水面上(不放海军工厂) ----
FLEET=spec.FLEET
def place_ship(u,team,q,rng):
    for r in range(8,46):
        for _ in range(14):
            ang=rng.uniform(0,2*math.pi); xx=int(round(q['px']+r*math.cos(ang))); yy=int(round(q['py']+r*math.sin(ang)))
            if 6<=xx<W-6 and 6<=yy<H-6 and water[yy-2:yy+3,xx-2:xx+3].all() and wsz[wl[yy,xx]]>=30000 and not occ[yy-2:yy+3,xx-2:xx+3].any():
                if min(cities,key=lambda c:(c['px']-xx)**2+(c['py']-yy)**2) is not q: continue
                occ[yy-2:yy+3,xx-2:xx+3]=True; add(u,team,xx,yy); return True
    return False
fleet_log={}
for s,ships in FLEET.items():
    ports=[q for q in cities if q['slot']==s and nd[q['py'],q['px']]<=16]
    ports.sort(key=lambda q:(not q['cap'],-q['pop']))
    if not ports: print('无港口',s,spec.SEATS[s]['zh']); continue
    rng=random.Random(777+s); got=0; k=0
    for u,n in ships:
        for _ in range(n):
            q=ports[k%min(len(ports),3)]; k+=1
            if place_ship(u,s-1,q,rng): got+=1; q['port']=True
            else:
                for q2 in ports:
                    if place_ship(u,s-1,q2,rng): got+=1; q2['port']=True; break
    fleet_log[s]=(got,sum(n for _,n in ships))
print('舰队',{spec.SEATS[s]['zh']:v for s,v in fleet_log.items()})
rng=np.random.default_rng(5); blocked=ndi.binary_dilation(occ|rock,iterations=1)
for gid,tv,p in ((380,3,0.018),(390,2,0.02),(386,4,0.01)):
    m=(T0==tv)&ok&~blocked&(rng.random((H,W))<p); items[m&(items==0)]=gid
print('objs',len(objs),'seaFactory',sum(1 for o in objs if o['unit']=='seaFactory'))
np.save(WGD+f'out/{TAG}_items.npy',items); json.dump(dict(objs=objs),open(WGD+f'out/{TAG}_objs.json','w'),ensure_ascii=False); json.dump(cities,open(WGD+f'out/{TAG}_cities.json','w'),ensure_ascii=False)
exec(open(WGD+'mk2.py',encoding='utf8').read())
