import fs from 'fs';
const K='/home/claude/rw-map-editor/kit/';
const {parseTmx}=await import(K+'tmx.js'); const {Sim}=await import(K+'tsim.js');
const [f,camp]=process.argv.slice(2);
const m=parseTmx(fs.readFileSync(f,'utf8'));
const C=JSON.parse(fs.readFileSync('/home/claude/wg/out/asia_cities.json','utf8'));
const cap=n=>C.find(c=>c.zh===n); const px=c=>[c.px*20+10,c.py*20+10];
const V=['北京','上海','广州','伊斯兰堡','平壤','东京','首尔','新德里','马尼拉','悉尼'];
const team= camp==='B'?1:0;
function run(label,evs,secs=240){
  const s=new Sim(m); for(const n of V){ const [x,y]=px(cap(n)); if(!s.ccAt(x,y).length) s.units.push({type:'commandCenter',team,x,y}); s.capture(x,y,team);} 
  s.run(secs,evs);
  const w=s.log.filter(l=>new RegExp(`^(终${camp}1|守报${camp}\\d|清${camp}_\\d+$|尾)`).test(l.name)).map(l=>l.t+'s '+l.name+(l.msg.startsWith('<<')?l.msg:''));
  const left=s.units.filter(u=>u.type==='commandCenter'&&u.team%2!==team%2).length;
  console.log('==',label,'→',w.slice(0,12).join(' | ')||'(无)','| 对方剩余指挥中心',left);
}
run('十城一直守住',[]);
run('只占九城',[[0,S=>{const [x,y]=px(cap('悉尼'));S.capture(x,y,team?0:1);}]]);
run('60~70秒北京丢了又夺回',[[60,S=>{const [x,y]=px(cap('北京'));S.capture(x,y,team?0:1);}],[70,S=>{const [x,y]=px(cap('北京'));S.capture(x,y,team);}]],300);
