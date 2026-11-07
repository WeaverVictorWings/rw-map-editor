# window.rwApi（3.3）
编辑器载入后 `window.rwApiReady === true`。未载入地图时所有函数抛出“还没有载入地图”。
loadText(tmx) · exportText('full'|'lite'|'none') · check() · components() · calibrate(pts[{lon,lat,tx,ty}]) · ll2tile/tile2ll ·
paintIsland({rings,scale,fill,beach,smooth,gap}) · parsePolygons(text) · placeCities(csv,{snap,minGap}) · measureAt · strait ·
removeFragments · edgeWall · blendBand · isolateAt · rules.get/set/check · markAsCities · generateCapture · removeCapture · passTable · loadEstimate
CLI：`node scripts/rw-cli.mjs check|export lite|shot map.tmx`（见脚本头注释）。
3.3.1 增加：resolveTerrain · coastSmooth · replaceKeep · importTerrain · widthHint · addCityPools · shotRegions（均为异步）。
