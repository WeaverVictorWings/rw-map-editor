// RWKit · 防覆盖/备份/陈旧输出检测。所有写文件都走 safeWrite。
import fs from 'node:fs'; import path from 'node:path';
export function backupName(file) { const d = path.dirname(file), b = path.basename(file, path.extname(file)), e = path.extname(file); let i = 1; while (fs.existsSync(path.join(d, '.rwbak', `${b}.v${i}${e}`))) i++; return path.join(d, '.rwbak', `${b}.v${i}${e}`); }
export function safeWrite(file, data, { overwrite = false, expectSize } = {}) {
  if (fs.existsSync(file)) {
    if (!overwrite) throw new Error(`拒绝覆盖已有文件 ${file}(要覆盖请显式 overwrite)`);
    const bk = backupName(file); fs.mkdirSync(path.dirname(bk), { recursive: true }); fs.copyFileSync(file, bk);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); return file;
}
// 输出是否比输入旧(检查前提醒重新导出)
export function staleCheck(outFile, ...srcs) { const o = fs.statSync(outFile).mtimeMs; const newer = srcs.filter((s) => fs.existsSync(s) && fs.statSync(s).mtimeMs > o); return newer.length ? [{ sev: 'warn', code: 'S01', msg: `输出 ${path.basename(outFile)} 比 ${newer.map((s) => path.basename(s)).join('、')} 旧,检查的可能是过期版本,请先重新导出` }] : []; }
// 危险尺寸:脚本默认尺寸与既有 tmx 不一致时报错(曾因默认 1240×800 覆盖 1090×670 的底图)
export function sizeGuard(model, want) { if (!want) return []; return (model.width !== want.w || model.height !== want.h) ? [{ sev: 'error', code: 'S02', msg: `地图尺寸 ${model.width}×${model.height} 与期望 ${want.w}×${want.h} 不一致(可能用了脚本默认尺寸)` }] : []; }
