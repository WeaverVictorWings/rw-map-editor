import fs from 'fs';
const {parseTmx}=await import('/home/claude/rw-map-editor/kit/tmx.js');
const {Sim}=await import('/home/claude/rw-map-editor/kit/tsim.js');
const [tmx,cj,ga,gb]=process.argv.slice(2);
const m=parseTmx(fs.readFileSync(tmx,'utf8')); const C=JSON.parse(fs.readFileSync(cj,'utf8'));
const cap=n=>C.find(c=>c.zh===n); const px=c=>[c.px*20+10,c.py*20+10];
function run(label,names,pat,tm=0,secs=260){
  const s=new Sim(m); for(const n of names) s.capture(...px(cap(n)),tm);
  s.run(secs,[]);
  const w=s.log.filter(l=>pat.test(l.name)).map(l=>l.t+'s '+l.name);
  console.log('==',label,'→',w.join(' | ')||'(无)');
}
for(const [k,gs,p] of [['A',ga.split(','),/^(守报A\d|终A1)/],['B',gb.split(','),/^(守报B\d|终B1)/]]){
 const tm=k=='A'?0:1; run(k+' 五城守住',gs,p,tm); run(k+' 少一城',k=='A'?gs.slice(0,gs.length-1):gs.slice(1),p,tm);
}
