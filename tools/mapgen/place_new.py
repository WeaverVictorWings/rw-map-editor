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
