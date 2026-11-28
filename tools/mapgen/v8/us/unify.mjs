import fs from 'fs';
const K='/home/claude/rw-map-editor/kit/';
const {parseTmx}=await import(K+'tmx.js'); const {Sim}=await import(K+'tsim.js');
const m=parseTmx(fs.readFileSync(process.argv[2],'utf8'));
const s=new Sim(m);
// 把全图指挥中心都给 team 1(宪政政府,序号 0),模拟统一
s.run(1); for(const u of s.units) if(u.type==='commandCenter') u.team=1;
for (let i=0;i<200;i++) s.units.push({type:'commandCenter',team:1,x:10,y:10});
s.run(80);
console.log(s.log.filter(l=>/^(国0_f|终局清除)/.test(l.name)).map(l=>l.t+'s '+l.name+(l.msg.startsWith('<<')?l.msg:'')).slice(0,14).join('\n'));
