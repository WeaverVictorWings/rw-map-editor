// 版本号与更新检查、反馈入口
import { toast, confirmBox } from './ui.js';
export const VERSION = '3.0.0';
export const REPO = 'WeaverVictorWings/rw-map-editor';
export const openUrl = (u) => window.open(u, '_blank', 'noopener');
export const feedback = () => openUrl(`https://github.com/${REPO}/issues/new/choose`);

const num = (s) => (String(s || '').match(/\d+(?:\.\d+)*/) || [''])[0];
function newer(a, b) { // a 比 b 新？
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; }
  return false;
}
// manual = 用户点了“检查更新”（没新版也要告诉他）
export async function checkUpdate(manual = false) {
  if (!manual) {
    try { if (localStorage.getItem('rwNoUpdate') === '1') return; const last = +localStorage.getItem('rwUpdAt') || 0; if (Date.now() - last < 864e5) return; localStorage.setItem('rwUpdAt', String(Date.now())); } catch { /* 无痕模式 */ }
  }
  let rel;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!r.ok) throw new Error(r.status);
    rel = await r.json();
  } catch { if (manual) toast('检查更新失败（可能没联网）'); return; }
  const v = num(rel.name) || num(rel.tag_name);
  if (!v || !newer(v, VERSION)) { if (manual) toast('已是最新版本'); return; }
  if (await confirmBox('发现新版本', `有新版本 ${v}，要去下载吗？`, '去下载', '以后再说')) openUrl(rel.html_url || `https://github.com/${REPO}/releases/latest`);
}
