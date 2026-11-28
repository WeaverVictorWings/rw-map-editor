import fs from 'fs';
const K='/home/claude/rw-map-editor/kit/';
const {parseTmx}=await import(K+'tmx.js'); const {Sim}=await import(K+'tsim.js');
const [f,camp]=process.argv.slice(2);
const m=parseTmx(fs.readFileSync(f,'utf8'));
const C=JSON.parse(fs.readFileSync('/home/claude/eu/v6/cities6.json','utf8'));
const cap=n=>C.find(c=>c.zh===n); const px=c=>[c.px*20+10,c.py*20+10];
const V=['莫斯科','明斯克','布达佩斯','圣彼得堡','伊斯坦布尔','柏林','华沙','基辅','慕尼黑','米兰'];
const team= camp==='RUS'?1:0;
function run(label,set,evs,secs=240){
  const s=new Sim(m); for(const n of set){ const [x,y]=px(cap(n)); if(!s.ccAt(x,y).length) s.units.push({type:'commandCenter',team,x,y}); s.capture(x,y,team);}
  s.run(secs,evs);
  const w=s.log.filter(l=>new RegExp(`^(终${camp}1$|守报${camp}\\d|清${camp}_\\d+$)`).test(l.name)).map(l=>l.t+'s '+l.name+(l.msg.startsWith('<<')?l.msg:''));
  console.log('==',label,'→',w.slice(0,7).join(' | ')||'(无)');
}
run('十城一直守住',V,[]);
run('只占对方五城(旧规则)',camp==='NATO'?V.slice(0,5):V.slice(5),[]);
run('只占九城',V.slice(0,9),[]);
run('60~70秒丢一城又夺回',V,[[60,S=>{const [x,y]=px(cap(V[7]));S.capture(x,y,1-team);}],[70,S=>{const [x,y]=px(cap(V[7]));S.capture(x,y,team);}]],300);
run('占齐对方五城但己方柏林被对方占着',V.slice(0,5).concat(V.slice(6)),[[0,S=>{const [x,y]=px(cap('柏林')); if(!S.ccAt(x,y).length) S.units.push({type:'commandCenter',team:1-team,x,y}); S.capture(x,y,1-team);}]]);
