import fs from 'fs';
const K='/home/claude/rw-map-editor/kit/';
const {parseTmx,passability,unitsOf,LAND,NAVAL}=await import(K+'tmx.js');
for (const [a,b] of [['/home/claude/w8/asia/a1.tmx','/home/claude/wg/out3/大亚洲战争_v0.7.tmx'],['/home/claude/w8/out/大亚洲战争_v0.8.tmx','/home/claude/wg/out3/大亚洲战争_v0.7.tmx'],['/home/claude/w8/out/欧陆战争_v0.8.tmx','/home/claude/w8/in/eu_v0.7.tmx'],['/home/claude/w8/out/美国内战_v78.tmx','/home/claude/wg/out3/美国内战_v77.tmx']]) {
  const M=parseTmx(fs.readFileSync(a,'utf8')), O=parseTmx(fs.readFileSync(b,'utf8'));
  const sig=m=>unitsOf(m).map(o=>[o.props.unit,o.props.team,Math.round(o.x),Math.round(o.y)].join('|')).sort().join('\n');
  const P=passability(M),W=M.width; const naval=new Set(['battleShip','missileShip','gunBoat','destroyer','submarine','lightGunship','heavyMissileShip','seaFactory','navalFactory']);
  let wet=0,dry=0; for(const o of unitsOf(M)){const x=Math.floor((o.x+10)/20),y=Math.floor((o.y+10)/20); const p=P[y*W+x]; const isNav=/ship|boat|sub|sea|naval/i.test(o.props.unit||''); if(!isNav && !(p&LAND)) wet++; if(isNav && !(p&NAVAL)) dry++;}
  const ga=M.layers.ground.data, gb=O.layers.ground.data; let gd=0; for(let i=0;i<ga.length;i++) if(ga[i]!==gb[i]) gd++;
  console.log(a.split('/').pop(),'单位',unitsOf(M).length,'与原图相同',sig(M)===sig(O),'陆军在水里',wet,'舰船在陆上',dry,'地形改动格',gd);
}
