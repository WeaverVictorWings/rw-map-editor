import numpy as np,sys,json
sys.path.insert(0,'/home/claude/wg')
from lib1 import proj
import asia_spec as S, warpmod
from scipy import ndimage as ndi
from scipy.spatial import cKDTree
cfg=dict(S.cfg); ll0,_=proj(cfg); H,W=cfg['H'],cfg['W']
ll2px,fwd,inv,res=warpmod.make(cfg,ll0,S.WARPS)
P=np.fromfile('out/asia_pass0.u8',np.uint8).reshape(H,W); water=(P==6)|(P==7); land=(P==13)
def px(lo,la): x,y=ll2px(lo,la); return int(x),int(y)
lab,n=ndi.label(land); sz=np.bincount(lab.ravel())
def comp(lo,la):
    x,y=px(lo,la)
    for r in range(0,14):
        sub=lab[max(0,y-r):y+r+1,max(0,x-r):x+r+1]; v=sub[sub>0]
        if v.size: return int(np.bincount(v).argmax())
    return 0
pts={'北海道':(142.8,43.3),'本州(东京)':(139.7,36),'本州(广岛)':(132.5,34.8),'四国':(133.5,33.8),'九州':(131,33),'济州岛':(126.55,33.38),'朝鲜半岛':(127,37.5),'中国大陆':(116,36),'台湾':(121,23.8),'海南':(109.8,19.1),'澳大利亚':(135,-25),'苏门答腊':(101.5,-0.5),'爪哇':(110,-7.4),'加里曼丹':(114,0),'吕宋':(121,16),'棉兰老':(125,7.5),'苏拉威西':(120.5,-2.5),'斯里兰卡':(80.7,7.6),'马来半岛':(101,5),'新几内亚':(140,-5),'冲绳':(127.8,26.5),'塔斯马尼亚(若在图内)':(146.8,-42)}
ids={k:comp(*v) for k,v in pts.items()}
print('陆地块号',{k:i for k,i in ids.items()})
need=['北海道','本州(东京)','四国','九州','济州岛','朝鲜半岛','台湾','海南','澳大利亚','苏门答腊','爪哇','加里曼丹','吕宋','棉兰老','苏拉威西','斯里兰卡','马来半岛','新几内亚']
print('块号(应互不相同)',{k:ids[k] for k in need}); print('应各自独立的块数:',len({ids[k] for k in need}),'/',len(need),'  本州东京与广岛同块:',ids['本州(东京)']==ids['本州(广岛)'],'  朝鲜半岛与大陆同块(应True):',ids['朝鲜半岛']==ids['中国大陆'])
d=ndi.distance_transform_edt(water)
def snap(x,y):
    x=min(max(x,0),W-1); y=min(max(y,0),H-1)
    for r in range(0,80):
        sub=d[max(0,y-r):y+r+1,max(0,x-r):x+r+1]
        if sub.size and sub.max()>=6: i=np.unravel_index(sub.argmax(),sub.shape); return (max(0,x-r)+i[1],max(0,y-r)+i[0])
    return (x,y)
pairs={'日本海↔太平洋':((135,40),(145,36)),'日本海↔东海':((135,40),(124,29)),'濑户内海↔太平洋':((133,34.1),(134,32)),'黄海↔东海':((123,36),(124,29)),'东海↔太平洋(琉球)':((124,28),(135,28)),'南海↔太平洋(菲律宾)':((116,15),(130,16)),'爪哇海↔印度洋(巽他/龙目)':((106.5,-4.5),(106.0,-10.5)),'爪哇海↔南海':((110,-3),(108,4)),'印度洋↔南海(马六甲)':((90,12),(112,12)),'阿拉伯海↔孟加拉湾':((70,14),(90,12)),'澳洲环航(西南→东南)':((112,-38),(155,-38)),'澳洲环航(西北→东北)':((112,-15),(155,-12))}
for k,(a,b) in pairs.items():
    s=snap(*px(*a)); t=snap(*px(*b)); best=0
    for w in range(2,40):
        lb,_=ndi.label(d>=w/2)
        if lb[s[1],s[0]]>0 and lb[s[1],s[0]]==lb[t[1],t[0]]: best=w
        else: break
    print(f'  航道 {k}: 最窄≈{best}格')
rock=np.load('out/asia_rock.npy') if len(sys.argv)>1 else None
if rock is not None:
    lb,nb=ndi.label(rock,structure=np.ones((3,3))); sb=np.bincount(lb.ravel())[1:]
    print('岩石格数',int(rock.sum()),'段数',nb,'最长段',sorted(sb)[-4:])
