"""局部放大(平滑径向放大)。栅格用 inv() 重采样,城市/河流坐标用 fwd() 同步搬位。"""
import numpy as np
def make(cfg, ll2px0, warps):
    ws=[]
    for (lon,lat,Rdeg,f) in warps:
        cx,cy=ll2px0(lon,lat); R=Rdeg/(cfg['lon1']-cfg['lon0'])*cfg['W']; ws.append((cx,cy,R,f))
    def fwd(x,y):
        x=np.asarray(x,float); y=np.asarray(y,float)
        for cx,cy,R,f in ws:
            dx=x-cx; dy=y-cy; g=1+(f-1)*np.exp(-(dx*dx+dy*dy)/R**2); x=cx+dx*g; y=cy+dy*g
        return x,y
    def inv(X,Y):
        X=np.asarray(X,float); Y=np.asarray(Y,float)
        for cx,cy,R,f in reversed(ws):
            dx=X-cx; dy=Y-cy; rr=np.hypot(dx,dy); r=rr.copy()
            for _ in range(40): r=rr/(1+(f-1)*np.exp(-(r/R)**2))
            g=1+(f-1)*np.exp(-(r/R)**2); X=cx+dx/g; Y=cy+dy/g
        return X,Y
    def ll2px(lon,lat):
        x,y=ll2px0(lon,lat); X,Y=fwd(x,y); return float(X),float(Y)
    def resample(A,order=0):
        from scipy import ndimage as ndi
        H,W=A.shape; yy,xx=np.mgrid[0:H,0:W]; sx,sy=inv(xx+.5,yy+.5)
        return ndi.map_coordinates(A,[sy-.5,sx-.5],order=order,mode='nearest')
    return ll2px,fwd,inv,resample
