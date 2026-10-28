// 自动生成：scripts/build-sw.mjs —— 不要手改这个文件（改完网页资源后重新生成）
// 离线优先：所有资源走缓存，网络只用来补新东西；换版本时旧缓存自动清掉。
const CACHE = 'rw-map-editor-2.6.0-0c915b9e';
const ASSETS = [
  './icon-192.png',
  './icon-512.png',
  './icon.svg',
  './index.html',
  './js/actions.js',
  './js/app.js',
  './js/assetcheck.js',
  './js/assetfix.js',
  './js/assets.js',
  './js/autofixmap.js',
  './js/backup.js',
  './js/balance.js',
  './js/bottleneck.js',
  './js/brushtools.js',
  './js/charts.js',
  './js/check.js',
  './js/collision.js',
  './js/commands.js',
  './js/curves.js',
  './js/debugtrig.js',
  './js/detail.js',
  './js/detailui.js',
  './js/dialogs.js',
  './js/editor.js',
  './js/editorial.js',
  './js/erasebrush.js',
  './js/examples.js',
  './js/extras.js',
  './js/files.js',
  './js/finder.js',
  './js/gen.js',
  './js/heal.js',
  './js/help.js',
  './js/helpstatic.js',
  './js/hint.js',
  './js/history.js',
  './js/historyx.js',
  './js/i18n.js',
  './js/i18n/en.js',
  './js/i18n/es.js',
  './js/i18n/fr.js',
  './js/i18n/id.js',
  './js/i18n/ja.js',
  './js/i18n/pt.js',
  './js/i18n/ru.js',
  './js/i18n/tr.js',
  './js/i18n/uk.js',
  './js/i18n/zht.js',
  './js/icons.js',
  './js/imagemap.js',
  './js/importexport.js',
  './js/ini.js',
  './js/input.js',
  './js/io.js',
  './js/killzones.js',
  './js/layercmp.js',
  './js/layers.js',
  './js/mapinfo.js',
  './js/markers.js',
  './js/massedit.js',
  './js/measure.js',
  './js/mobile.js',
  './js/modedit.js',
  './js/modlogic.js',
  './js/modschema.js',
  './js/modtools.js',
  './js/modunits.js',
  './js/movebrush.js',
  './js/naval.js',
  './js/paint.js',
  './js/panels.js',
  './js/parity.js',
  './js/pasteblend.js',
  './js/pathannot.js',
  './js/pathing.js',
  './js/picture.js',
  './js/poolgen.js',
  './js/preview2.js',
  './js/project.js',
  './js/publish.js',
  './js/quickbar.js',
  './js/regions.js',
  './js/render.js',
  './js/replaceall.js',
  './js/share.js',
  './js/sharelayer.js',
  './js/shot.js',
  './js/sim.js',
  './js/snapgrid.js',
  './js/stamps.js',
  './js/stampstyle.js',
  './js/state.js',
  './js/stats.js',
  './js/teamchart.js',
  './js/teamhelp.js',
  './js/templates.js',
  './js/terraform.js',
  './js/terrain.js',
  './js/tiling.js',
  './js/timing.js',
  './js/tmx.js',
  './js/tools2.js',
  './js/traces2.js',
  './js/transform.js',
  './js/triggers.js',
  './js/triggraph.js',
  './js/tutorial.js',
  './js/ui.js',
  './js/unitprops.js',
  './js/unitsbrowse.js',
  './js/unitstats.js',
  './js/util.js',
  './js/version.js',
  './js/wizard.js',
  './js/workshop.js',
  './js/zip.js',
  './manifest.webmanifest',
  './style.css'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;             // 更新检查等外部请求不缓存
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(CACHE); c.put(req, r.clone()).catch(() => {});
        return r;
      } catch { return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error(); }
    })());
    return;
  }
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r && r.ok) { const c = await caches.open(CACHE); c.put(req, r.clone()).catch(() => {}); }
      return r;
    } catch { return Response.error(); }
  })());
});
