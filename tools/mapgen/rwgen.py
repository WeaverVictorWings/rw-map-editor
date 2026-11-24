#!/usr/bin/env python3
"""rwgen - image -> Rusted Warfare TMX map (auto-tiled ground layer).

Needs a reference .tmx exported from the game: its embedded tilesets and terrain
transition tables are reused, so no game files are required.

    python3 rwgen.py picture.png --template ref.tmx -o out.tmx --width 1000 \
        --terrains "Shallow Water,Sand,Dirt,Grass,Tree,Dirt Cliff" \
        --smooth 1 --spawns 8 --preview out_preview.png

    python3 rwgen.py --check out.tmx --template ref.tmx      # re-read + seam test
"""
from __future__ import annotations

import argparse
import base64
import io
import re
import sys
import zlib
import xml.etree.ElementTree as ET
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

TILE = 20
DEFAULT_TERRAINS = "Shallow Water,Sand,Dirt,Grass,Tree"
# terrains where a command center / builders can stand
BUILDABLE = {"Sand", "Dirt", "Grass", "Snow", "Dune", "Ice"}
KEEP_TILESETS = ("export_ground", "export_items", "export_units")
CC_GID, BUILDER_GID = 2175, 2303  # export_units: commandCenter / builder


# --------------------------------------------------------------------------
# template: tilesets, terrain table, autotile lookup
# --------------------------------------------------------------------------
class Template:
    def __init__(self, path: str):
        self.path = path
        with open(path, encoding="utf-8") as f:
            self.raw = f.read()
        root = ET.parse(path).getroot()
        ts = {t.get("name"): t for t in root.findall("tileset")}
        if "export_ground" not in ts:
            sys.exit("template has no 'export_ground' tileset - use a tmx exported from the game")
        g = ts["export_ground"]
        self.first = int(g.get("firstgid"))
        self.cols = int(g.get("columns"))
        self.count = int(g.get("tilecount"))
        self.tnames = [t.get("name") for t in g.findall("terraintypes/terrain")]
        self.trep = [int(t.get("tile")) for t in g.findall("terraintypes/terrain")]
        self.K = len(self.tnames)

        png = None
        for p in g.findall("properties/property"):
            if p.get("name") == "embedded_png":
                png = base64.b64decode("".join((p.text or "").split()))
        if png is None:
            sys.exit("export_ground has no embedded_png property")
        self.img = Image.open(io.BytesIO(png)).convert("RGBA")

        # terrain tuple (tl,tr,bl,br) -> tile ids
        self.tuples: dict[tuple, list[int]] = {}
        self.ctab = np.full((self.count, 4), -1, np.int16)
        for t in g.findall("tile"):
            tr = t.get("terrain")
            if not tr:
                continue
            tup = tuple(int(x) for x in tr.split(","))
            if min(tup) < 0:
                continue
            tid = int(t.get("id"))
            self.tuples.setdefault(tup, []).append(tid)
            self.ctab[tid] = tup
        K = self.K
        self.lut = np.full((K, K, K, K), -1, np.int16)
        for tup, ids in self.tuples.items():
            self.lut[tup] = min(ids)

        # terrain graph (two terrains are neighbours when a mixed tile exists)
        adj = [[False] * K for _ in range(K)]
        for tup in self.tuples:
            s = set(tup)
            if len(s) == 2:
                a, b = s
                adj[a][b] = adj[b][a] = True
        self.dist = np.full((K, K), 99, np.int8)
        self.nxt = np.zeros((K, K), np.int8)
        for src in range(K):
            self.dist[src, src] = 0
            self.nxt[src, src] = src
            q = deque([src])
            first_hop = {src: src}
            while q:
                u = q.popleft()
                for v in range(K):
                    if adj[u][v] and self.dist[src, v] == 99:
                        self.dist[src, v] = self.dist[src, u] + 1
                        first_hop[v] = v if u == src else first_hop[u]
                        q.append(v)
            for v, h in first_hop.items():
                self.nxt[src, v] = h

        # average colour per tile (for previews) and per terrain
        arr = np.asarray(self.img, np.float64)
        self.tile_avg = np.zeros((self.count, 3), np.uint8)
        for tid in range(self.count):
            x, y = (tid % self.cols) * TILE, (tid // self.cols) * TILE
            c = arr[y:y + TILE, x:x + TILE].reshape(-1, 4)
            c = c[c[:, 3] > 0][:, :3]
            if len(c):
                self.tile_avg[tid] = c.mean(0)
        self.terrain_rgb = np.array([self.tile_avg[t] for t in self.trep], np.uint8)

    def terrain_index(self, name: str) -> int:
        for i, n in enumerate(self.tnames):
            if n.lower() == name.strip().lower():
                return i
        sys.exit("unknown terrain %r. available: %s" % (name, ", ".join(self.tnames)))


# --------------------------------------------------------------------------
# image -> terrain cells
# --------------------------------------------------------------------------
def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = (c @ m.T) / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]),
                     200 * (f[..., 1] - f[..., 2])], -1)


def build_color_lut(palette_rgb: np.ndarray, palette_ids: list[int]) -> np.ndarray:
    """5-bit-per-channel lookup: rgb555 -> terrain id (nearest in Lab)."""
    g = np.arange(32) * 8 + 4
    r, gg, b = np.meshgrid(g, g, g, indexing="ij")
    grid = np.stack([r, gg, b], -1).reshape(-1, 3)
    d = ((srgb_to_lab(grid)[:, None, :] - srgb_to_lab(palette_rgb)[None, :, :]) ** 2).sum(-1)
    return np.asarray(palette_ids, np.int8)[d.argmin(1)]


def classify(img: Image.Image, lut: np.ndarray) -> np.ndarray:
    a = np.asarray(img.convert("RGB"))
    key = ((a[..., 0] >> 3).astype(np.int32) << 10) | ((a[..., 1] >> 3).astype(np.int32) << 5) | (a[..., 2] >> 3)
    return lut[key]


def image_to_cells(img: Image.Image, W: int, H: int, lut: np.ndarray) -> np.ndarray:
    sw, sh = img.size
    if W * H >= sw * sh:  # upscale: classify first, then nearest-resize the class map
        cls = Image.fromarray(classify(img, lut).astype(np.uint8), "L")
        return np.asarray(cls.resize((W, H), Image.NEAREST)).astype(np.int8)
    return classify(img.resize((W, H), Image.BOX), lut)


def smooth_cells(cells: np.ndarray, passes: int) -> np.ndarray:
    im = Image.fromarray(cells.astype(np.uint8), "L")
    for _ in range(passes):
        im = im.filter(ImageFilter.ModeFilter(3))
    return np.asarray(im).astype(np.int8)


# --------------------------------------------------------------------------
# cells -> corner (vertex) terrains -> tile ids
# --------------------------------------------------------------------------
def cells_to_vertices(cells: np.ndarray, dist: np.ndarray) -> np.ndarray:
    H, W = cells.shape
    P = np.pad(cells, 1, mode="edge")
    c = [P[0:H + 1, 0:W + 1], P[0:H + 1, 1:W + 2], P[1:H + 2, 0:W + 1], P[1:H + 2, 1:W + 2]]
    best_cost, best = None, None
    for k in range(4):  # medoid of the four surrounding cells
        cost = np.zeros(c[0].shape, np.int16)
        for m in range(4):
            if m != k:
                cost += dist[c[k], c[m]]
        if best_cost is None:
            best_cost, best = cost, c[k].copy()
        else:
            better = cost < best_cost
            best_cost = np.where(better, cost, best_cost)
            best = np.where(better, c[k], best)
    return best.astype(np.int8)


def corner_view(V):
    return V[:-1, :-1], V[:-1, 1:], V[1:, :-1], V[1:, 1:]


def lipschitz_repair(V, tpl: Template, max_iter=60):
    """Make every pair of vertices that share a tile at most one terrain-step apart."""
    H1, W1 = V.shape
    for it in range(max_iter):
        P = np.pad(V, 1, mode="edge")
        best = np.zeros(V.shape, np.int8)
        tgt = V.copy()
        for dy in range(3):
            for dx in range(3):
                if dy == 1 and dx == 1:
                    continue
                N = P[dy:dy + H1, dx:dx + W1]
                D = tpl.dist[V, N]
                m = D > best
                best = np.where(m, D, best)
                tgt = np.where(m, N, tgt)
        viol = best > 1
        if not viol.any():
            return V, it
        V = np.where(viol, tpl.nxt[V, tgt], V).astype(np.int8)
    return V, max_iter


def vertices_to_tiles(V, tpl: Template):
    """Returns tile-id array (H,W). Falls back to nearest tuple where no exact tile exists."""
    tl, tr, bl, br = corner_view(V)
    T = tpl.lut[tl, tr, bl, br].astype(np.int32)
    bad = T < 0
    nbad = int(bad.sum())
    if nbad:
        keys = np.array(list(tpl.tuples.keys()), np.int8)
        ids = np.array([min(v) for v in tpl.tuples.values()], np.int32)
        ys, xs = np.nonzero(bad)
        cur = np.stack([tl[ys, xs], tr[ys, xs], bl[ys, xs], br[ys, xs]], -1)
        cost = (cur[:, None, :] != keys[None, :, :]).sum(-1)
        T[ys, xs] = ids[cost.argmin(1)]
    return T, nbad


def autotile(cells, tpl: Template, log=print):
    V = cells_to_vertices(cells, tpl.dist)
    for rnd in range(30):
        V, its = lipschitz_repair(V, tpl)
        tl, tr, bl, br = corner_view(V)
        bad = tpl.lut[tl, tr, bl, br] < 0
        nb = int(bad.sum())
        log("  autotile round %d: repair passes=%d, tiles w/o exact match=%d" % (rnd, its, nb))
        if nb == 0:
            break
        ys, xs = np.nonzero(bad)  # saddle corners: pull the top-right vertex to top-left
        V[ys, xs + 1] = V[ys, xs]
    T, left = vertices_to_tiles(V, tpl)
    if left:
        log("  fallback to nearest tile for %d tiles" % left)
    return V, T, left


# --------------------------------------------------------------------------
# spawns
# --------------------------------------------------------------------------
def place_spawns(V, tpl: Template, n: int, clear: int, seed: int):
    from scipy.ndimage import distance_transform_edt
    ok = np.zeros(tpl.K, bool)
    for i, nm in enumerate(tpl.tnames):
        ok[i] = nm in BUILDABLE
    tl, tr, bl, br = corner_view(V)
    land = ok[tl] & ok[tr] & ok[bl] & ok[br]
    dt = distance_transform_edt(np.pad(land, 1))[1:-1, 1:-1]
    ys, xs = np.nonzero(dt >= clear)
    if len(ys) == 0:
        return [], land
    rng = np.random.default_rng(seed)
    if len(ys) > 40000:
        sel = rng.choice(len(ys), 40000, replace=False)
        ys, xs = ys[sel], xs[sel]
    pts = np.stack([xs, ys], 1).astype(np.float64)
    chosen = [int(rng.integers(len(pts)))]
    mind = ((pts - pts[chosen[0]]) ** 2).sum(1)
    while len(chosen) < min(n, len(pts)):
        j = int(mind.argmax())
        chosen.append(j)
        mind = np.minimum(mind, ((pts - pts[j]) ** 2).sum(1))
    return [(int(pts[j][0]), int(pts[j][1])) for j in chosen], land


def objects_xml(spawns):
    out = ['\n<objectgroup name="UnitObjects">\n']
    for t, (tx, ty) in enumerate(spawns):
        out.append(
            '<object name="commandCenter (t:%d)" x="%.1f" y="%.1f" width="30" height="30" rotation="-90.0" gid="%d">\n'
            '<properties>\n<property name="unit" value="commandCenter"/>\n<property name="team" value="%d"/>\n</properties>\n</object>\n'
            % (t, tx * TILE - 5, ty * TILE + 15, CC_GID, t))
    for t, (tx, ty) in enumerate(spawns):
        for dx in (0, TILE):
            out.append(
                '<object name="builder (t:%d)" x="%.1f" y="%.1f" width="20" height="20" rotation="90.0" gid="%d">\n'
                '<properties>\n<property name="unit" value="builder"/>\n<property name="team" value="%d"/>\n</properties>\n</object>\n'
                % (t, tx * TILE + dx, ty * TILE + 80, BUILDER_GID, t))
    out.append("</objectgroup>\n")
    return "".join(out)


# --------------------------------------------------------------------------
# tmx writing / checking
# --------------------------------------------------------------------------
def layer_xml(name, W, H, gids):
    data = base64.b64encode(zlib.compress(np.ascontiguousarray(gids, "<u4").tobytes(), 9)).decode()
    return ('  <layer name="%s" width="%d" height="%d">\n    <data encoding="base64" compression="zlib">\n%s\n  </data>\n  </layer>\n'
            % (name, W, H, data))


def write_tmx(tpl: Template, path, W, H, ground_gids, spawns):
    raw = tpl.raw
    m = re.search(r"<map\b[^>]*>", raw)
    tag = m.group(0)
    tag2 = re.sub(r'(\s)width="\d+"', r'\1width="%d"' % W, tag, count=1)
    tag2 = re.sub(r'(\s)height="\d+"', r'\1height="%d"' % H, tag2, count=1)
    head_end = raw.index("<layer ")
    head = raw[:head_end]
    for b in reversed(list(re.finditer(r"<tileset\b.*?</tileset>", head, flags=re.S))):
        name = re.search(r'name="([^"]*)"', b.group(0)).group(1)
        if name not in KEEP_TILESETS:
            head = head[:b.start()] + head[b.end():]
    head = head.replace(tag, tag2, 1)
    body = (layer_xml("Ground", W, H, ground_gids)
            + layer_xml("Items", W, H, np.zeros((H, W), np.uint32))
            + objects_xml(spawns))
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(head + body + "</map>\n")


def read_layer(root, name, W, H):
    for layer in root.findall("layer"):
        if layer.get("name") == name:
            d = layer.find("data")
            raw = zlib.decompress(base64.b64decode("".join(d.text.split())))
            return np.frombuffer(raw, "<u4").reshape(H, W)
    raise KeyError(name)


def check_tmx(path, tpl: Template, log=print):
    root = ET.parse(path).getroot()
    W, H = int(root.get("width")), int(root.get("height"))
    g = read_layer(root, "Ground", W, H)
    items = read_layer(root, "Items", W, H)
    ids = (g & 0x1FFFFFFF).astype(np.int64) - tpl.first
    unknown = int(((ids < 0) | (ids >= tpl.count)).sum())
    ids = np.clip(ids, 0, tpl.count - 1)
    C = tpl.ctab[ids]  # (H,W,4)
    noinfo = int((C[..., 0] < 0).sum())
    hs = int((C[:, :-1, 1] != C[:, 1:, 0]).sum() + (C[:, :-1, 3] != C[:, 1:, 2]).sum())
    vs = int((C[:-1, :, 2] != C[1:, :, 0]).sum() + (C[:-1, :, 3] != C[1:, :, 1]).sum())
    objs = root.findall("objectgroup/object")
    units = {}
    for o in objs:
        p = {x.get("name"): x.get("value") for x in o.findall("properties/property")}
        units[p.get("unit")] = units.get(p.get("unit"), 0) + 1
    log("check %s: %dx%d tiles | unknown gid=%d, no-terrain-info tiles=%d | seam mismatches h=%d v=%d | items non-empty=%d | objects=%s"
        % (path, W, H, unknown, noinfo, hs, vs, int((items != 0).sum()), units))
    tilesets = [t.get("name") for t in root.findall("tileset")]
    log("  tilesets: %s | layers: %s" % (tilesets, [l.get("name") for l in root.findall("layer")]))
    return unknown == 0 and hs == 0 and vs == 0


# --------------------------------------------------------------------------
# previews
# --------------------------------------------------------------------------
def render_preview(T, tpl: Template, spawns, out, max_side=1200):
    H, W = T.shape
    img = Image.fromarray(tpl.tile_avg[T], "RGB")
    s = max(1, max_side // max(W, H))
    if s > 1:
        img = img.resize((W * s, H * s), Image.NEAREST)
    elif max(W, H) > max_side:
        k = max_side / max(W, H)
        img = img.resize((max(1, int(W * k)), max(1, int(H * k))), Image.BOX)
        s = k
    d = ImageDraw.Draw(img)
    for t, (x, y) in enumerate(spawns):
        cx, cy, r = (x + .5) * s, (y + .5) * s, max(4, 3 * s)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(255, 255, 255), fill=(220, 30, 30))
        d.text((cx + r + 2, cy - r), str(t), fill=(255, 255, 255))
    img.save(out)


def render_crop(T, tpl: Template, x0, y0, w, h, out):
    canvas = Image.new("RGBA", (w * TILE, h * TILE))
    for j in range(h):
        for i in range(w):
            y, x = y0 + j, x0 + i
            if 0 <= y < T.shape[0] and 0 <= x < T.shape[1]:
                tid = int(T[y, x])
                sx, sy = (tid % tpl.cols) * TILE, (tid // tpl.cols) * TILE
                canvas.paste(tpl.img.crop((sx, sy, sx + TILE, sy + TILE)), (i * TILE, j * TILE))
    canvas.convert("RGB").save(out)


# --------------------------------------------------------------------------
def parse_colors(items):
    out = {}
    for s in items or []:
        name, _, hexv = s.partition("=")
        hexv = hexv.strip().lstrip("#")
        out[name.strip().lower()] = tuple(int(hexv[i:i + 2], 16) for i in (0, 2, 4))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("image", nargs="?")
    ap.add_argument("--template", required=True, help="reference .tmx exported from the game")
    ap.add_argument("-o", "--out", default="out.tmx")
    ap.add_argument("--width", type=int, help="map width in tiles")
    ap.add_argument("--height", type=int, help="map height in tiles (default: keep aspect)")
    ap.add_argument("--terrains", default=DEFAULT_TERRAINS, help="comma list of terrain names to classify colours into")
    ap.add_argument("--color", action="append", help='override a terrain colour, e.g. "Dirt Cliff=#6e4d41"')
    ap.add_argument("--smooth", type=int, default=1, help="3x3 majority-filter passes to remove speckle")
    ap.add_argument("--spawns", type=int, default=0, help="auto-place N start positions (command center + 2 builders)")
    ap.add_argument("--spawn-clear", type=int, default=4, help="min open radius (tiles) around a start position")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--preview", help="write a downscaled preview png")
    ap.add_argument("--crop", help="x,y,w,h (tiles): also render a 1:1 crop to <preview>_crop.png")
    ap.add_argument("--check", metavar="TMX", help="re-read a tmx and test autotile seams, then exit")
    a = ap.parse_args()

    tpl = Template(a.template)
    if a.check:
        sys.exit(0 if check_tmx(a.check, tpl) else 1)
    if not a.image or not a.width:
        ap.error("image and --width are required")

    img = Image.open(a.image).convert("RGB")
    W = a.width
    H = a.height or max(1, round(W * img.size[1] / img.size[0]))
    names = [n for n in a.terrains.split(",") if n.strip()]
    ids = [tpl.terrain_index(n) for n in names]
    over = parse_colors(a.color)
    rgb = np.array([over.get(tpl.tnames[i].lower(), tuple(tpl.terrain_rgb[i])) for i in ids], np.uint8)
    print("palette:", ", ".join("%s%s" % (tpl.tnames[i], tuple(int(x) for x in c)) for i, c in zip(ids, rgb)))
    print("source %dx%d -> map %dx%d tiles (%dx%d px)" % (*img.size, W, H, W * TILE, H * TILE))

    lut = build_color_lut(rgb, ids)
    cells = image_to_cells(img, W, H, lut)
    if a.smooth:
        cells = smooth_cells(cells, a.smooth)
    V, T, left = autotile(cells, tpl)
    spawns = []
    if a.spawns:
        spawns, _ = place_spawns(V, tpl, a.spawns, a.spawn_clear, a.seed)
        print("spawns placed: %d of %d requested" % (len(spawns), a.spawns))
    write_tmx(tpl, a.out, W, H, (T + tpl.first).astype(np.uint32), spawns)
    print("wrote", a.out)
    ok = check_tmx(a.out, tpl)
    if a.preview:
        render_preview(T, tpl, spawns, a.preview)
        print("preview ->", a.preview)
        if a.crop:
            x0, y0, w, h = (int(v) for v in a.crop.split(","))
            cp = re.sub(r"(\.\w+)?$", "_crop.png", a.preview, count=1)
            render_crop(T, tpl, x0, y0, w, h, cp)
            print("crop ->", cp)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
