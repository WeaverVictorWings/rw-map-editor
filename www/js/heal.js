// 补全地形标注：有些地图（用别的工具存过的）里 export_ground / export_items 只剩图片和图块属性，
// 地形定义（terraintypes 和每个图块的 terrain）被丢掉了，编辑器就没法自动过渡。
// 本机保存过一份完整的图块素材（第一次打开完整地图时取出的 template），名字和尺寸对得上就把地形定义抄过来。
import { Tileset } from './tmx.js';
import { kvGet } from './util.js';

export async function healTerrain(map) {
  const tpl = await kvGet('template');
  if (!tpl || !tpl.xml) return [];
  const doc = new DOMParser().parseFromString('<root>' + tpl.xml + '</root>', 'application/xml');
  if (doc.querySelector('parsererror')) return [];
  const done = [];
  for (const T of doc.querySelectorAll('root > tileset')) {
    const name = T.getAttribute('name');
    if (!/^export_(ground|items)$/.test(name || '')) continue;
    const tc = +T.getAttribute('tilecount'), cols = +T.getAttribute('columns');
    const tTypes = T.querySelector(':scope > terraintypes');
    if (!tTypes) continue;
    // 同名、同尺寸，并且自己没有地形定义的那一个
    const M = map.tilesets.find((t) => t.name === name && !t.source && !t.terrainNames.length && t.tilecount === tc && t.columns === cols);
    if (!M) continue;
    // 同类的另一个同名地块集已经有地形定义了：别重复补（游戏只认第一个）
    if (map.tilesets.some((t) => t !== M && t.name === name && t.terrainNames.length && t.tilecount === tc)) continue;
    const el = M.el, d = el.ownerDocument;
    const tt = d.importNode(tTypes, true);
    const firstTile = el.querySelector(':scope > tile');
    if (firstTile) el.insertBefore(tt, firstTile); else el.appendChild(tt);
    const have = new Map([...el.querySelectorAll(':scope > tile')].map((e) => [e.getAttribute('id'), e]));
    for (const t of T.querySelectorAll(':scope > tile')) {
      const terr = t.getAttribute('terrain'); if (!terr) continue;
      const id = t.getAttribute('id');
      let e = have.get(id);
      if (!e) { e = d.createElement('tile'); e.setAttribute('id', id); el.appendChild(e); have.set(id, e); }
      e.setAttribute('terrain', terr);
    }
    const nts = new Tileset(el);
    nts.image = M.image; nts.imgW = M.imgW || nts.imgW; nts.imgH = M.imgH || nts.imgH;
    if (!nts.image && nts.embeddedPng) await nts.loadImage();
    map.tilesets[map.tilesets.indexOf(M)] = nts;
    done.push(name);
  }
  if (done.length) map.buildGidIndex();
  return done;
}
