import sys; sys.path.insert(0,'/home/claude/wg')
from lib1 import *
import asia_spec as S
cfg=dict(S.cfg); ll2px,px2ll=proj(cfg); print('H',cfg['H'])
E=fetch_elev(cfg,'asia4'); cty,names=raster_countries(cfg,ll2px); lake=raster_lakes(cfg,ll2px)
def blob(lon,lat,cx,cy,rx,ry,dz,k=0.35): return (((lon-cx)/rx)**2+((lat-cy)/ry)**2)+dz*k<1
def paint(T,land,Es,nz,lat,lon):
    dz=ndi.gaussian_filter(np.random.default_rng(4).standard_normal(lat.shape),20); dz/=dz.std()
    e=Es+nz*100
    T[land&(e>1400)]=4; T[land&(e>4600)]=5
    for (cx,cy,rx,ry) in [(83,39.5,8,3),(106,42.5,12,3.5),(60,41,9,3),(97,39.5,5,2.5)]:
        T[land&blob(lon,lat,cx,cy,rx,ry,dz)]=4
    T[land&(lat>47)&(lon>118)&(e<900)]=3
    for (cx,cy,rx,ry) in [(134,-24,15,7),(122,-26,9,6),(143,-27,5,5)]: T[land&blob(lon,lat,cx,cy,rx,ry,dz)&(T==3)]=4
    for (cx,cy,rx,ry) in [(129,-25,6,3.2),(136,-27.5,4.5,3),(123,-24,3.5,2.5)]: T[land&blob(lon,lat,cx,cy,rx,ry,dz)&(T!=1)]=2
cfg['paint']=paint
T,land=terrain(cfg,E,cty,lake,px2ll); T[lake&(cty>0)]=1
# ---- 河流改成窄水面(深水 2 格 + 浅滩边),定距留浅滩渡口;城市附近一律留渡口 ----
if getattr(S,'RIVER_WATER',False):
    import json as _j, math as _m
    from PIL import Image as _I, ImageDraw as _D
    gj=_j.load(open('data/rivers.geojson')); lines=[]
    for f in gj['features']:
        if f['properties'].get('name') in S.RIVERS or f['properties'].get('name') in ('Yangtze','Chang Jiang'):
            cs=f['geometry']['coordinates']; cs=cs if f['geometry']['type']=='MultiLineString' else [cs]
            for c in cs: lines.append([ll2px(*p[:2]) for p in c])
    for _l in S.EXTRA_RIVERS: lines.append([ll2px(*p) for p in _l])
    img=_I.new('L',(cfg['W'],cfg['H']),0); dr=_D.Draw(img)
    for l_ in lines: dr.line(l_,fill=255,width=S.RIVER_W)
    core=(np.array(img)>0)&land&~lake
    ys_,xs_=np.mgrid[0:cfg['H'],0:cfg['W']]; ford=np.zeros(core.shape,bool); rg=np.random.default_rng(23)
    for l_ in lines:
        acc=0; nxt=rg.uniform(10,24)
        for (x0,y0),(x1,y1) in zip(l_,l_[1:]):
            acc+=_m.hypot(x1-x0,y1-y0)
            if acc>=nxt: acc=0; nxt=rg.uniform(22,36); ford|=(xs_-x1)**2+(ys_-y1)**2<=3.3**2
    T[core]=1
    # ---- 河口接海:未与海相连的河流分量,把最近点用 4 格宽水道连到最近的海 ----
    lab_,n_=ndi.label(T<=1); sizes=ndi.sum(np.ones_like(lab_),lab_,range(1,n_+1)); sea_=int(np.argmax(sizes))+1
    seam=lab_==sea_; dist,(iy,ix)=ndi.distance_transform_edt(~seam,return_indices=True)
    for k in range(1,n_+1):
        if k==sea_ or sizes[k-1]<120: continue
        m=lab_==k
        if (m&lake).sum()>0.3*m.sum(): continue
        ys2,xs2=np.nonzero(m); j=int(np.argmin(dist[ys2,xs2])); y0,x0=int(ys2[j]),int(xs2[j])
        if dist[y0,x0]>80: print('河未接海(太远)',k,int(sizes[k-1]),round(float(dist[y0,x0]))); continue
        img2=_I.new('L',(cfg['W'],cfg['H']),0); _D.Draw(img2).line([(x0,y0),(int(ix[y0,x0]),int(iy[y0,x0]))],fill=255,width=S.RIVER_W)
        ch=(np.array(img2)>0)&land; T[ch&(T>1)]=1; print('河口接海',k,int(sizes[k-1]),'补',int(round(float(dist[y0,x0]))),'格')
    np.save('data/asia_riverfords.npy',ford); print('river core px',int(core.sum()),'fords',int(ford.sum()))
# ---- 日本/朝鲜半岛/台湾:平滑径向放大(栅格重采样),随后凿开保证通航的海峡 ----
import warpmod
ll2pxW,fwdW,invW,resW=warpmod.make(cfg,ll2px,S.WARPS)
T=resW(T,0).astype(T.dtype); cty=resW(cty,0).astype(cty.dtype); lake=resW(lake.astype(np.uint8),0)>0; E=resW(E.astype(np.float32),1)
from PIL import Image as _I2, ImageDraw as _D2
_img=_I2.new('L',(cfg['W'],cfg['H']),0); _dr=_D2.Draw(_img)
for _nm,_pts,_w in S.STRAITS:
    _dr.line([ll2pxW(*p) for p in _pts],fill=255,width=_w)
_cut=(np.array(_img)>0)&(T>=2)
T[_cut]=1; print('凿开海峡格数',int(_cut.sum()))
# ---- 清理零碎小岛 + 各陆块之间强制隔出深水(浅水也会被地面单位走过,所以必须有深水带) ----
_KEEP=[(126.55,33.38),(127.8,26.4)]  # 济州、冲绳(其余小岛删除)
_L=T>=2; _lab,_n=ndi.label(_L); _sz=ndi.sum(_L,_lab,range(1,_n+1)); _keep=set()
for _lo,_la in _KEEP:
    _x,_y=[int(v) for v in ll2pxW(_lo,_la)]
    _w=_lab[max(0,_y-6):_y+7,max(0,_x-6):_x+7]; _keep|=set(np.unique(_w[_w>0]).tolist())
_small=np.zeros(T.shape,bool)
for _i in range(1,_n+1):
    if _sz[_i-1]<150 and _i not in _keep: _small|=(_lab==_i)
T[_small]=0
# 台湾左下:澎湖形状的方块岛一并删除(落在台湾西海岸外)
print('删小岛格数',int(_small.sum()))
_lab,_n=ndi.label(T>=2); _sz=ndi.sum(T>=2,_lab,range(1,_n+1))
_reg=[i for i in range(1,_n+1) if _sz[i-1]>=150]
_dist={i:ndi.distance_transform_edt(_lab!=i) for i in _reg}
_shave=np.zeros(T.shape,bool); _zone=np.zeros(T.shape,bool)
GAP=int(getattr(S,'MIN_GAP',12))
for i in _reg:
    for j in _reg:
        if i>=j: continue
        close=(_dist[i]+_dist[j])<=GAP+2
        if not close.any(): continue
        _shave|=((_lab==j)&(_dist[i]<=GAP/2))|((_lab==i)&(_dist[j]<=GAP/2))
        _zone|=close&(_dist[i]<=GAP/2+1)&(_dist[j]<=GAP/2+1)
T[_shave|(_zone&(T<=1))]=0
print('隔水:削陆',int(_shave.sum()),'清浅水',int((_zone&(T<=1)).sum()))
# ---- 贴图边且不通主海的死海 → 填成陆地 ----
_lab,_n=ndi.label(T<=1,structure=np.ones((3,3))); _sz=np.bincount(_lab.ravel()); _sea=int(np.argmax(_sz[1:]))+1
_edge=np.zeros(T.shape,bool); _edge[0,:]=_edge[-1,:]=_edge[:,0]=_edge[:,-1]=True
for _k in range(1,_n+1):
    if _k!=_sea and _sz[_k]>200 and (_edge&(_lab==_k)).any(): T[_lab==_k]=3; print('填死海',_k,int(_sz[_k]))
np.save('data/asia_elev.npy',E); np.save('data/asia_T.npy',T); np.save('data/asia_cty.npy',cty); json.dump(names,open('data/asia_names.json','w'))
write_terrain_png(T,'out/asia_terrain.png'); print(np.bincount(T.ravel(),minlength=6),cfg['H'],cfg['W'])
