import fs from 'fs';
const K='/home/claude/rw-map-editor/kit/';
const {parseTmx,passability,LAND,NAVAL}=await import(K+'tmx.js'); const {waterComponents}=await import(K+'terrain.js');
const [f0,f1]=process.argv.slice(2);
const C=JSON.parse(fs.readFileSync('/home/claude/wg/out/asia_cities.json','utf8')); const city=n=>C.find(q=>q.zh===n);
for (const f of [f0,f1]) { const M=parseTmx(fs.readFileSync(f,'utf8')); const P=passability(M),W=M.width,H=M.height;
 const lab=new Int32Array(W*H).fill(-1); let n=0; for(let i=0;i<W*H;i++) if(lab[i]<0&&(P[i]&LAND)){const q=[i];lab[i]=n;for(let h=0;h<q.length;h++){const k=q[h],x=k%W,y=(k/W)|0;for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const X=x+dx,Y=y+dy;if(X<0||Y<0||X>=W||Y>=H)continue;const j=Y*W+X;if(lab[j]<0&&(P[j]&LAND)){lab[j]=n;q.push(j);}}}n++;}
 const L=nm=>{const q=city(nm);for(let r=0;r<4;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){const v=lab[(q.py+dy)*W+q.px+dx];if(v>=0)return v;}return -1};
 const same=(a,b)=>L(a)===L(b)?'通':'断';
 console.log(f.split('/').pop(),'东京-高知',same('东京','高知'),'东京-福冈',same('东京','福冈'),'东京-札幌',same('东京','札幌'),'雅加达-棉兰',same('雅加达','棉兰'),'雅加达-帝力',same('雅加达','帝力'),'望加锡-古晋',same('望加锡','古晋'),'东京-首尔',same('东京','首尔'),'雅加达-吉隆坡',same('雅加达','吉隆坡'),'水域块',waterComponents(M,50).comps.length);
}
