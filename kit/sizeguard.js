// RWKit · 尺寸守卫(浏览器可用,不依赖 node:fs)
// 危险尺寸:脚本默认尺寸与既有 tmx 不一致时报错(曾因默认 1240×800 覆盖 1090×670 的底图)
export function sizeGuard(model, want) { if (!want) return []; return (model.width !== want.w || model.height !== want.h) ? [{ sev: 'error', code: 'S02', msg: `地图尺寸 ${model.width}×${model.height} 与期望 ${want.w}×${want.h} 不一致(可能用了脚本默认尺寸)` }] : []; }
