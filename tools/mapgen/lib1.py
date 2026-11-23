import json,math,os,sys,numpy as np,concurrent.futures as cf,urllib.request
from PIL import Image,ImageDraw
from scipy import ndimage as ndi
WG='/home/claude/wg/'
def proj(cfg):
    W=cfg['W']; l0,l1=cfg['lon0'],cfg['lon1']; dl=(l1-l0)/W; dlat=dl*math.cos(math.radians(cfg['latmid']))
    H=int(round((cfg['lat0']-cfg['lat1'])/dlat)); cfg['H']=H; cfg['dlat']=dlat
    ll2px=lambda lon,lat:((lon-l0)/dl,(cfg['lat0']-lat)/dlat)
    px2ll=lambda x,y:(l0+(x+.5)*dl,cfg['lat0']-(y+.5)*dlat)
    return ll2px,px2ll
Z=5; N=2**Z*256
def tile_xy(lon,lat):
    x=(lon+180)/360*N; y=(1-math.log(math.tan(math.radians(lat))+1/math.cos(math.radians(lat)))/math.pi)/2*N; return x,y
def fetch_elev(cfg,tag):
    out=WG+f'data/{tag}_elev.npy'
    if os.path.exists(out): return np.load(out)
    x0,y1_=tile_xy(cfg['lon0'],cfg['lat0']); x1,y0_=tile_xy(cfg['lon1'],cfg['lat1'])
    tx0,tx1=int(x0//256),int(x1//256); ty0,ty1=int(y1_//256),int(y0_//256)
    os.makedirs(WG+f'data/tiles',exist_ok=True)
    def get(a):
        x,y=a; p=WG+f'data/tiles/{Z}-{x}-{y}.png'
        if not os.path.exists(p):
            urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png',p)
        return a
    jobs=[(x,y) for x in range(tx0,tx1+1) for y in range(ty0,ty1+1)]
    with cf.ThreadPoolExecutor(8) as ex: list(ex.map(get,jobs))
    el=np.zeros(((ty1-ty0+1)*256,(tx1-tx0+1)*256),np.float32)
    for (x,y) in jobs:
        a=np.asarray(Image.open(WG+f'data/tiles/{Z}-{x}-{y}.png').convert('RGB')).astype(np.float32)
        el[(y-ty0)*256:(y-ty0+1)*256,(x-tx0)*256:(x-tx0+1)*256]=a[...,0]*256+a[...,1]+a[...,2]/256-32768
    ll2px,px2ll=proj(cfg); H,W=cfg['H'],cfg['W']
    ys,xs=np.mgrid[0:H,0:W]; lon=cfg['lon0']+(xs+.5)*(cfg['lon1']-cfg['lon0'])/W; lat=cfg['lat0']-(ys+.5)*cfg['dlat']
    mx=(lon+180)/360*N-tx0*256; my=(1-np.log(np.tan(np.radians(lat))+1/np.cos(np.radians(lat)))/math.pi)/2*N-ty0*256
    mx=np.clip(mx,0,el.shape[1]-1.001); my=np.clip(my,0,el.shape[0]-1.001)
    x0i=mx.astype(int); y0i=my.astype(int); fx=mx-x0i; fy=my-y0i
    E=(el[y0i,x0i]*(1-fx)*(1-fy)+el[y0i,x0i+1]*fx*(1-fy)+el[y0i+1,x0i]*(1-fx)*fy+el[y0i+1,x0i+1]*fx*fy)
    np.save(out,E.astype(np.float32)); return E.astype(np.float32)
def raster_countries(cfg,ll2px):
    gj=json.load(open(WG+'data/countries.geojson')); H,W=cfg['H'],cfg['W']
    names=[]; img=Image.new('I',(W,H),0); dr=ImageDraw.Draw(img)
    for f in gj['features']:
        p=f['properties']; g=f['geometry']; polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
        used=False; ids=len(names)+1
        for poly in polys:
            ring=poly[0]; xs=[c[0] for c in ring]; ys=[c[1] for c in ring]
            if max(xs)<cfg['lon0']-1 or min(xs)>cfg['lon1']+1 or max(ys)<cfg['lat1']-1 or min(ys)>cfg['lat0']+1: continue
            used=True; dr.polygon([ll2px(*c) for c in ring],fill=ids)
            for hole in poly[1:]: dr.polygon([ll2px(*c) for c in hole],fill=0)
        if used: names.append(p['ADMIN'])
    return np.array(img,np.int32),names
def raster_lakes(cfg,ll2px,minarea=3000):
    gj=json.load(open(WG+'data/lakes.geojson')); H,W=cfg['H'],cfg['W']; img=Image.new('L',(W,H),0); dr=ImageDraw.Draw(img)
    for f in gj['features']:
        g=f['geometry']; polys=g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
        for poly in polys:
            ring=poly[0]; xs=[c[0] for c in ring]; ys=[c[1] for c in ring]
            if max(xs)<cfg['lon0'] or min(xs)>cfg['lon1'] or max(ys)<cfg['lat1'] or min(ys)>cfg['lat0']: continue
            pts=[ll2px(*c) for c in ring]; dr.polygon(pts,fill=255)
            for hole in poly[1:]: dr.polygon([ll2px(*c) for c in hole],fill=0)
    m=np.array(img)>0; lab,n=ndi.label(m)
    if n:
        sz=ndi.sum(m,lab,range(1,n+1)); 
        for i,s in enumerate(sz):
            if s<cfg.get('lake_min',60): m[lab==i+1]=False
    return m
def terrain(cfg,E,cty,lake,px2ll):
    H,W=cfg['H'],cfg['W']; land=(cty>0)&~lake
    dist=ndi.distance_transform_edt(~land); Es=ndi.gaussian_filter(E,1.2)
    rng=np.random.default_rng(7); nz=ndi.gaussian_filter(rng.standard_normal((H,W)),6); nz/=nz.std()
    lat=np.array([px2ll(0,y)[1] for y in range(H)])[:,None]*np.ones((1,W)); lon=np.array([px2ll(x,0)[0] for x in range(W)])[None,:]*np.ones((H,1))
    T=np.zeros((H,W),np.uint8); T[(~land)&(dist<=8+2*nz)]=1; T[land]=3
    cfg['paint'](T,land,Es,nz,lat,lon)
    coast=land&ndi.binary_dilation(~land,iterations=2); T[coast&(T==3)]=2
    for v in (5,2):
        m=T==v; lab,n=ndi.label(m,structure=np.ones((3,3))); sz=ndi.sum(m,lab,range(1,n+1))
        for i,s in enumerate(sz):
            if s<40: T[lab==i+1]=4 if v==5 else 3
    return T,land
COL=np.array([(0,21,69),(18,83,178),(193,145,129),(49,98,33),(140,101,85),(181,197,213)],np.uint8)  # Deep,Shallow,Sand,Grass,Dirt,Snow (template rgb)
def write_terrain_png(T,path): Image.fromarray(COL[T]).save(path)
