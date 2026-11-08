"""Generates one GLB per reconstructed campus building from reconstruction/specs.json.

Footprints and heights come from OSM; facade treatments come from the per-building
recipe in reconstruction/observations.json (written from official photos). All
buildings are assembled from one library of reusable components:

  window_module, curtain_wall, fin, louver_blade, door_assembly, parapet,
  fascia, floating_roof, column, rotunda, glass_tower, hip_roof, mosaic_panel,
  truss_cantilever, pyramid_lantern

Each GLB is in building-local metres: x = east, y = up, z = -north, origin at the
footprint centroid, y = 0 at the ground floor. The game seats it on the terrain.
Materials are physically based (Principled BSDF): glass is metallic/low roughness,
masonry rough, metals mid-roughness. Texture scale is 1 UV unit = 1 m.

Run headless:
  blender -b --factory-startup --python blender/build_buildings.py -- reconstruction/specs.json public/models/buildings [slug]
"""
import json
import math
import os
import sys

import bmesh
import bpy
import mathutils
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SPECS, OUTDIR = argv[0], argv[1]
ONLY = argv[2] if len(argv) > 2 else None
os.makedirs(OUTDIR, exist_ok=True)

# Ground-level solids that stand outside the OSM footprint (the game's colliders come from
# the footprint): posts as (x, y, r) and closed rings, in map metres. Written to solids.json.
CUR = {"ring": [], "off": (0.0, 0.0), "posts": [], "rings": []}


def _inside(p, ring):
    q = False
    j = len(ring) - 1
    for i in range(len(ring)):
        a, b = ring[i], ring[j]
        if (a[1] > p[1]) != (b[1] > p[1]) and p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]:
            q = not q
        j = i
    return q


def solid_post(p, r):
    if CUR["ring"] and not _inside(p, CUR["ring"]):
        ox, oy = CUR["off"]
        CUR["posts"].append([round(p[0] + ox, 2), round(p[1] + oy, 2), round(r, 2)])


def solid_ring(pts):
    if CUR["ring"] and any(not _inside(q, CUR["ring"]) for q in pts):
        ox, oy = CUR["off"]
        CUR["rings"].append([[round(q[0] + ox, 2), round(q[1] + oy, 2)] for q in pts])


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


# ---------------------------------------------------------------- materials
PALETTE = {
    "white": ("eeeeea", 0.0, 0.45), "tan": ("cbb99b", 0.0, 0.9), "tanAggregate": ("c4bcab", 0.0, 0.95),
    "limestone": ("d9cdb4", 0.0, 0.85), "stoneGray": ("cfcac0", 0.0, 0.85), "violetTile": ("4a4fa6", 0.0, 0.35),
    "whiteStucco": ("eceae4", 0.0, 0.8), "charcoal": ("2f3236", 0.5, 0.4), "silver": ("b9bfc4", 0.9, 0.35),
    "redBrick": ("8c4636", 0.0, 0.9), "darkMetal": ("3b3f45", 0.6, 0.45), "beigeStucco": ("e3cfa8", 0.0, 0.85),
    "canyonBrick": ("5d5552", 0.0, 0.9), "brick": ("8a5a44", 0.0, 0.9), "concrete": ("c4bba9", 0.0, 0.95), "greyStucco": ("cdc6b8", 0.0, 0.85), "creamMetal": ("e3dcc8", 0.3, 0.5),
}
GLASS = {"teal": "4f7685", "dark": "27313a", "darkBlue": "1f3448", "green": "6d9a92", "blue": "2c5c8d", "warm": "5e6a70"}
MATS = {}


def mat(name, color, metal=0.0, rough=0.5, alpha=1.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb(color), 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    MATS[name] = m
    return m


def wall_mat(key):
    c, m, r = PALETTE.get(key, PALETTE["tan"])
    return mat("Wall_" + key, c, m, r)


def glass_mat(key):
    # Moderate metalness keeps the glass tint readable instead of mirroring the sky.
    return mat("Glass_" + key, GLASS.get(key, GLASS["dark"]), 0.35, 0.08)


FRAME = lambda: mat("Frame_Dark", "2a2c2e", 0.7, 0.35)
WHITE = lambda: mat("Trim_White", "f2f2ef", 0.1, 0.4)
CONC = lambda: mat("Concrete", "c9c4ba", 0.0, 0.9)
ROOF = lambda: mat("Roof_Membrane", "b9b7b2", 0.0, 0.85)
SHINGLE = lambda: mat("Roof_Shingle", "5a5d62", 0.0, 0.9)
WOOD = lambda: mat("Wood_Soffit", "9a6a42", 0.0, 0.6)
STEEL = lambda: mat("Steel_Truss", "8e979f", 0.8, 0.4)
BEAM = lambda: mat("Steel_Beam", "7d868f", 0.7, 0.4)


# ---------------------------------------------------------------- mesh assembly
class Builder:
    """Accumulates quads per material into one bmesh per material, then one object per material."""

    def __init__(self):
        self.parts = {}

    def bm(self, m):
        if m.name not in self.parts:
            self.parts[m.name] = (m, bmesh.new())
        return self.parts[m.name][1]

    def quad(self, m, a, b, c, d):
        bm = self.bm(m)
        vs = [bm.verts.new(P(*p)) for p in (a, b, c, d)]
        f = bm.faces.new(vs)
        uv = bm.loops.layers.uv.verify()
        # Planar UVs in metres: horizontal faces use x/z, walls use along-edge/height.
        n = (Vector(P(*b)) - Vector(P(*a))).cross(Vector(P(*d)) - Vector(P(*a)))
        for loop in f.loops:
            co = loop.vert.co
            if abs(n.z) > max(abs(n.x), abs(n.y)):
                loop[uv].uv = (co.x, co.y)
            elif abs(n.x) > abs(n.y):
                loop[uv].uv = (co.y, co.z)
            else:
                loop[uv].uv = (co.x, co.z)
        return f

    def box(self, m, c, size, yaw=0.0):
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        cs, sn = math.cos(yaw), math.sin(yaw)
        def p(x, y, z):
            return (c[0] + x * cs - z * sn, c[1] + y, c[2] + x * sn + z * cs)
        v = [p(x, y, z) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)]
        for i in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)):
            self.quad(m, *[v[k] for k in i])

    def finish(self, name):
        root = bpy.data.objects.new(name, None)
        bpy.context.scene.collection.objects.link(root)
        for mname, (m, bm) in self.parts.items():
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.001)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            me = bpy.data.meshes.new(name + "_" + mname)
            bm.to_mesh(me)
            bm.free()
            me.materials.append(m)
            o = bpy.data.objects.new(name + "_" + mname, me)
            bpy.context.scene.collection.objects.link(o)
            o.parent = root
        return root


def P(x, y, z):
    """Building-local (x east, y up, z = -north) -> Blender (x, -z... ) handled by the glTF exporter's +Y up."""
    return (x, -z, y)


# ---------------------------------------------------------------- geometry helpers
def ccw(ring):
    a = sum((ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]) for i, j in ((i, (i - 1) % len(ring)) for i in range(len(ring))))
    return ring if a > 0 else ring[::-1]


def edges(ring):
    out = []
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        l = math.hypot(b[0] - a[0], b[1] - a[1])
        if l < 0.3:
            continue
        u = ((b[0] - a[0]) / l, (b[1] - a[1]) / l)
        out.append({"a": a, "b": b, "len": l, "u": u, "n": (u[1], -u[0])})
    return out


def offset_ring(ring, d):
    """Offset a CCW ring outward by d (negative = inward), mitered."""
    n = len(ring)
    out = []
    for i in range(n):
        p, c, q = ring[i - 1], ring[i], ring[(i + 1) % n]
        def nrm(a, b):
            l = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
            return ((b[1] - a[1]) / l, -(b[0] - a[0]) / l)
        n1, n2 = nrm(p, c), nrm(c, q)
        bx, by = n1[0] + n2[0], n1[1] + n2[1]
        bl = math.hypot(bx, by) or 1
        bx, by = bx / bl, by / bl
        cos = max(0.35, bx * n1[0] + by * n1[1])
        out.append((c[0] + bx * d / cos, c[1] + by * d / cos))
    return out


def W(p, y):
    """Map point (east, north) at height y -> local (x, y, z)."""
    return (p[0], y, -p[1])


def sub_edge(e, t0, t1, out=0.0):
    a = (e["a"][0] + e["u"][0] * t0 + e["n"][0] * out, e["a"][1] + e["u"][1] * t0 + e["n"][1] * out)
    b = (e["a"][0] + e["u"][0] * t1 + e["n"][0] * out, e["a"][1] + e["u"][1] * t1 + e["n"][1] * out)
    return {"a": a, "b": b, "len": t1 - t0, "u": e["u"], "n": e["n"], "s0": 0.0}


def wall_strip(B, m, e, y0, y1, t0=0.0, t1=None, out=0.0):
    t1 = e["len"] if t1 is None else t1
    a = (e["a"][0] + e["u"][0] * t0 + e["n"][0] * out, e["a"][1] + e["u"][1] * t0 + e["n"][1] * out)
    b = (e["a"][0] + e["u"][0] * t1 + e["n"][0] * out, e["a"][1] + e["u"][1] * t1 + e["n"][1] * out)
    B.quad(m, W(a, y0), W(b, y0), W(b, y1), W(a, y1))


def polygon_cap(B, m, ring, y, down=False, holes=()):
    """Flat cap over `ring`, leaving `holes` (courtyards) open."""
    bm = B.bm(m)
    loops = [list(ring)] + [list(h) for h in holes]
    flat = [p for l in loops for p in l]
    vs = [bm.verts.new(P(*W(p, y))) for p in flat]
    tris = mathutils.geometry.tessellate_polygon([[Vector((p[0], p[1], 0)) for p in l] for l in loops])
    for t in tris:
        a, b, c = (vs[i] for i in t)
        # Wind every triangle to face up (or down).
        cross = (b.co - a.co).cross(c.co - a.co)
        up = cross.z > 0  # Blender is z-up
        if up == down:
            a, c = c, a
        try:
            bm.faces.new((a, b, c))
        except ValueError:
            pass
    uv = bm.loops.layers.uv.verify()
    for face in bm.faces:
        for loop in face.loops:
            loop[uv].uv = (loop.vert.co.x, loop.vert.co.y)


# ---------------------------------------------------------------- components
def window_module(B, e, t, y, w, h, glass, frame, depth=0.15, mullions=2):
    """Punched window: glass just proud of the wall face inside a projecting
    surround (head, jambs, sill) of depth `depth`, with mullions."""
    n = e["n"]
    c = (e["a"][0] + e["u"][0] * t, e["a"][1] + e["u"][1] * t)
    yaw = math.atan2(-e["u"][1], e["u"][0])
    gc = (c[0] + n[0] * 0.08, c[1] + n[1] * 0.08)  # clear of brick bays (0.03)
    B.box(glass, W(gc, y + h / 2), (w, h, 0.02), yaw)
    fc = (c[0] + n[0] * depth / 2, c[1] + n[1] * depth / 2)
    fw = 0.09
    for side in (-1, 1):
        jc = (fc[0] + e["u"][0] * side * (w / 2 + fw / 2), fc[1] + e["u"][1] * side * (w / 2 + fw / 2))
        B.box(frame, W(jc, y + h / 2), (fw, h + 2 * fw, depth), yaw)
    B.box(frame, W(fc, y + h + fw / 2), (w + 2 * fw, fw, depth), yaw)
    for k in range(1, mullions):
        mc = (gc[0] + e["u"][0] * (-w / 2 + w * k / mullions) + n[0] * 0.02, gc[1] + e["u"][1] * (-w / 2 + w * k / mullions) + n[1] * 0.02)
        B.box(frame, W(mc, y + h / 2), (0.05, h, 0.05), yaw)
    mid = (gc[0] + n[0] * 0.02, gc[1] + n[1] * 0.02)
    B.box(frame, W(mid, y + h * 0.55), (w, 0.05, 0.05), yaw)
    sill = (c[0] + n[0] * (depth / 2 + 0.03), c[1] + n[1] * (depth / 2 + 0.03))
    B.box(WHITE(), W(sill, y - 0.05), (w + 0.25, 0.1, depth + 0.08), yaw)


def curtain_wall(B, e, y0, y1, glass, frame, bay=1.5, floor_h=4.0, t0=0.0, t1=None):
    t1 = e["len"] if t1 is None else t1
    wall_strip(B, glass, e, y0, y1, t0, t1, out=-0.05)
    yaw = math.atan2(-e["u"][1], e["u"][0])
    n = max(1, round((t1 - t0) / bay))
    for k in range(n + 1):
        t = t0 + (t1 - t0) * k / n
        c = (e["a"][0] + e["u"][0] * t, e["a"][1] + e["u"][1] * t)
        B.box(frame, W(c, (y0 + y1) / 2), (0.06, y1 - y0, 0.12), yaw)
    y = y0
    while y <= y1 + 0.01:
        a = (e["a"][0] + e["u"][0] * t0, e["a"][1] + e["u"][1] * t0)
        b = (e["a"][0] + e["u"][0] * t1, e["a"][1] + e["u"][1] * t1)
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        B.box(frame, W(mid, y), (t1 - t0, 0.08, 0.12), yaw)
        y += floor_h


def fin(B, e, t, y0, y1, depth, width, m):
    c = (e["a"][0] + e["u"][0] * t + e["n"][0] * depth / 2, e["a"][1] + e["u"][1] * t + e["n"][1] * depth / 2)
    B.box(m, W(c, (y0 + y1) / 2), (width, y1 - y0, depth), math.atan2(-e["u"][1], e["u"][0]))


def louver_blade(B, e, y, depth, m, thick=0.06):
    c = ((e["a"][0] + e["b"][0]) / 2 + e["n"][0] * depth / 2, (e["a"][1] + e["b"][1]) / 2 + e["n"][1] * depth / 2)
    B.box(m, W(c, y), (e["len"], thick, depth), math.atan2(-e["u"][1], e["u"][0]))


def door_assembly(B, e, t, y, glass, frame, double=True):
    """Aluminium storefront entry: frame, glass leaves, push bars, canopy."""
    w = 1.9 if double else 1.0
    yaw = math.atan2(-e["u"][1], e["u"][0])
    c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.02, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.02)
    B.box(frame, W(c, y + 1.3), (w + 0.2, 2.6, 0.1), yaw)
    g = (c[0] + e["n"][0] * 0.04, c[1] + e["n"][1] * 0.04)
    B.box(glass, W(g, y + 1.2), (w, 2.3, 0.03), yaw)
    if double:
        B.box(frame, W(g, y + 1.2), (0.06, 2.3, 0.05), yaw)
    B.box(mat("Steel_Brushed", "c8cbcd", 1.0, 0.3), W((g[0] + e["n"][0] * 0.05, g[1] + e["n"][1] * 0.05), y + 1.0), (w * 0.8, 0.04, 0.04), yaw)
    cn = (c[0] + e["n"][0] * 1.0, c[1] + e["n"][1] * 1.0)
    B.box(WHITE(), W(cn, y + 3.0), (w + 1.6, 0.2, 2.0), yaw)


def parapet(B, ring, top, h, m):
    for e in edges(ring):
        wall_strip(B, m, e, top, top + h)
        wall_strip(B, m, {"a": e["b"], "b": e["a"], "len": e["len"], "u": (-e["u"][0], -e["u"][1]), "n": (-e["n"][0], -e["n"][1])}, top, top + h, out=0.25)
    inner = offset_ring(ring, -0.25)
    for i in range(len(ring)):
        a, b, ia, ib = ring[i], ring[(i + 1) % len(ring)], inner[i], inner[(i + 1) % len(ring)]
        B.quad(m, W(a, top + h), W(b, top + h), W(ib, top + h), W(ia, top + h))


def slab_ring(B, ring, outer_ring, y, t, m):
    """Flat slab between ring and an outer ring (fascia, roof plane edge)."""
    for i in range(len(ring)):
        a, b, A, Bp = ring[i], ring[(i + 1) % len(ring)], outer_ring[i], outer_ring[(i + 1) % len(ring)]
        B.quad(m, W(a, y + t), W(b, y + t), W(Bp, y + t), W(A, y + t))
        B.quad(m, W(a, y), W(A, y), W(Bp, y), W(b, y))
    for e in edges(outer_ring):
        wall_strip(B, m, e, y, y + t)


def column(B, p, y0, y1, size, m, round_=False):
    B.box(m, W(p, (y0 + y1) / 2), (size, y1 - y0, size))
    if y0 < 0.6 and y1 - y0 > 1.5:
        solid_post(p, max(size / 2, 0.2))


def rotunda(B, c, r, y0, y1, glass, m):
    """White curved drum with horizontal glass bands (residence hall entrances)."""
    seg = 24
    for k in range(seg // 2 + 1):
        a0, a1 = math.pi * k / (seg // 2), math.pi * (k + 1) / (seg // 2)
        if k == seg // 2:
            break
        p0 = (c[0] + math.cos(a0) * r, c[1] + math.sin(a0) * r)
        p1 = (c[0] + math.cos(a1) * r, c[1] + math.sin(a1) * r)
        y = y0
        band = 0
        while y < y1 - 0.1:
            h = min(1.2, y1 - y) if band % 2 == 0 else min(1.6, y1 - y)
            mm = m if band % 2 == 0 else glass
            B.quad(mm, W(p0, y), W(p1, y), W(p1, y + h), W(p0, y + h))
            y += h
            band += 1
        B.quad(m, W(c, y1), W(p1, y1), W(p0, y1), W(c, y1 + 0.001))


def hip_roof(B, ring, y, rise, m):
    """Hip roof by insetting the ring to a ridge ring (as far as it stays valid)."""
    lo, hi = 0.0, 30.0
    best = None
    for _ in range(14):
        mid = (lo + hi) / 2
        r = offset_ring(ring, -mid)
        ok = all(((ring[(i + 1) % len(ring)][0] - ring[i][0]) * (r[(i + 1) % len(r)][0] - r[i][0]) + (ring[(i + 1) % len(ring)][1] - ring[i][1]) * (r[(i + 1) % len(r)][1] - r[i][1])) > 0 for i in range(len(ring)))
        if ok:
            lo, best = mid, r
        else:
            hi = mid
    if not best:
        polygon_cap(B, m, ring, y)
        return
    top = y + min(rise, lo * 0.5)
    eave = offset_ring(ring, 0.5)
    for i in range(len(ring)):
        a, b, ia, ib = eave[i], eave[(i + 1) % len(ring)], best[i], best[(i + 1) % len(ring)]
        B.quad(m, W(a, y), W(b, y), W(ib, top), W(ia, top))
    polygon_cap(B, m, best, top)


def sloped_plane(B, top_m, under_m, e, ring, y_back, y_front, over_front, over_side, thick=0.45, over_back=0.6):
    """A single tilted roof plane over the whole footprint, aligned on the front
    edge e: a rectangle from the back of the building (y_back) to `over_front`
    metres beyond the front wall (y_front), `over_side` beyond each end, with a
    thick edge band and a separate underside material."""
    u, n, a = e["u"], e["n"], e["a"]
    us = [(p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1] for p in ring]
    ns = [(p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] for p in ring]
    u0, u1 = min(us) - over_side, max(us) + over_side
    n0, n1 = min(ns) - over_back, over_front
    def at(su, sn):
        return (a[0] + u[0] * su + n[0] * sn, a[1] + u[1] * su + n[1] * sn)
    def h(sn):
        return y_back + (y_front - y_back) * (sn - n0) / (n1 - n0)
    c = [(u0, n0), (u1, n0), (u1, n1), (u0, n1)]
    top = [W(at(*q), h(q[1]) + thick) for q in c]
    bot = [W(at(*q), h(q[1])) for q in c]
    B.quad(top_m, *top)
    B.quad(under_m, bot[3], bot[2], bot[1], bot[0])
    for i in range(4):
        j = (i + 1) % 4
        B.quad(top_m, bot[i], bot[j], top[j], top[i])
    return at, h, (u0, u1, n0, n1)


def steel_member(B, m, p0, y0, p1, y1, size=0.22):
    """A straight steel member between two points (box rotated to the segment)."""
    dx, dz, dy = p1[0] - p0[0], -(p1[1] - p0[1]), y1 - y0
    L = math.sqrt(dx * dx + dy * dy + dz * dz)
    if L < 0.05:
        return
    bm = B.bm(m)
    d = Vector((dx, dy, dz)) / L
    side = d.cross(Vector((0, 1, 0)))
    if side.length < 1e-3:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    c0 = Vector(W(p0, y0))
    hs = size / 2
    corners = []
    for t in (0.0, L):
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            corners.append(c0 + d * t + side * sx * hs + up * sy * hs)
    q = [tuple(v) for v in corners]
    for i in range(4):
        j = (i + 1) % 4
        B.quad(m, q[i], q[j], q[4 + j], q[4 + i])


def screen_balcony(B, e, t0, t1, y, depth, height, color="e2552a"):
    """Projecting balcony wrapped in a perforated coloured metal screen
    (Callier Center): slab, front and end screens, a thin top rail."""
    scr = mat("Screen_Orange", color, 0.5, 0.45)
    n, u, a = e["n"], e["u"], e["a"]
    def at(t, o):
        return (a[0] + u[0] * t + n[0] * o, a[1] + u[1] * t + n[1] * o)
    p = [at(t0, 0), at(t1, 0), at(t1, depth), at(t0, depth)]
    B.quad(CONC(), W(p[3], y), W(p[2], y), W(p[1], y), W(p[0], y))
    B.quad(CONC(), W(p[0], y - 0.3), W(p[1], y - 0.3), W(p[2], y - 0.3), W(p[3], y - 0.3))
    for q0, q1 in ((p[3], p[2]), (p[0], p[3]), (p[2], p[1])):
        B.quad(scr, W(q0, y - 0.3), W(q1, y - 0.3), W(q1, y + height), W(q0, y + height))
        B.quad(scr, W(q1, y - 0.3), W(q0, y - 0.3), W(q0, y + height), W(q1, y + height))


def exterior_stair(B, e, t, y_top, width=1.8, color="c0282d"):
    """A straight open stair running along the wall from the ground up to y_top,
    with solid painted stringers and treads (Callier's red stair)."""
    st = mat("Stair_Red", color, 0.4, 0.5)
    n, u, a = e["n"], e["u"], e["a"]
    steps = max(4, round(y_top / 0.18))
    run = 0.28
    yaw = math.atan2(-u[1], u[0])
    for k in range(steps):
        tt = t - k * run
        c = (a[0] + u[0] * tt + n[0] * (width / 2 + 0.2), a[1] + u[1] * tt + n[1] * (width / 2 + 0.2))
        yk = y_top - k * y_top / steps
        B.box(st, W(c, yk - 0.05), (run + 0.02, 0.1, width), yaw)
    for off in (0.15, width + 0.25):
        p0 = (a[0] + u[0] * t + n[0] * off, a[1] + u[1] * t + n[1] * off)
        p1 = (a[0] + u[0] * (t - steps * run) + n[0] * off, a[1] + u[1] * (t - steps * run) + n[1] * off)
        steel_member(B, st, p0, y_top, p1, 0.0, 0.3)


def shed_canopy(B, e, y, reach, drop, m):
    """A sloped metal canopy along one wall (the Library's ground-floor roof)."""
    a, b, n = e["a"], e["b"], e["n"]
    A = (a[0] + n[0] * reach, a[1] + n[1] * reach)
    Bp = (b[0] + n[0] * reach, b[1] + n[1] * reach)
    B.quad(m, W(a, y), W(b, y), W(Bp, y - drop), W(A, y - drop))
    B.quad(m, W(A, y - drop - 0.15), W(Bp, y - drop - 0.15), W(b, y - 0.15), W(a, y - 0.15))
    B.quad(m, W(A, y - drop - 0.15), W(A, y - drop), W(Bp, y - drop), W(Bp, y - drop - 0.15))
    k = max(1, round(e["len"] / 6))
    for i in range(k + 1):
        t = e["len"] * i / k
        p = (a[0] + e["u"][0] * t + n[0] * (reach - 0.3), a[1] + e["u"][1] * t + n[1] * (reach - 0.3))
        column(B, p, 0, y - drop - 0.1, 0.16, FRAME())


# ---------------------------------------------------------------- building recipe
def build(spec):
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    ring0 = ccw([tuple(p) for p in spec["outer"]])
    cx = sum(p[0] for p in ring0) / len(ring0)
    cy = sum(p[1] for p in ring0) / len(ring0)
    ring = [(p[0] - cx, p[1] - cy) for p in ring0]
    # Simplify tiny edges.
    ring = [p for i, p in enumerate(ring) if math.hypot(p[0] - ring[i - 1][0], p[1] - ring[i - 1][1]) > 0.3]
    holes = [[(p[0] - cx, p[1] - cy) for p in h] for h in spec.get("holes", [])]
    CUR.update({"ring": list(ring), "off": (cx, cy), "posts": [], "rings": []})
    r = spec["recipe"]
    H = float(spec["h"])
    floors = spec.get("levels") or max(1, round(H / 4.0))
    fh = min(5.0, max(3.0, (H - 0.8) / floors))
    B = Builder()
    wall = wall_mat(r.get("wall", "tan"))
    glass = glass_mat(r.get("glass", "dark"))
    frame = FRAME()
    es = edges(ring)
    acc = 0.0
    for e in es:
        e["s0"] = acc
        acc += e["len"]
    longest = max(es, key=lambda e: e["len"])
    if spec.get("front"):
        (fax, fay), (fbx, fby) = spec["front"]
        fm = ((fax + fbx) / 2 - cx, (fay + fby) / 2 - cy)
        cand = [e for e in es if e["len"] > 6]
        if cand:
            # The ring was re-oriented and simplified: pick the edge whose midpoint is nearest the front midpoint.
            longest = min(cand, key=lambda e: math.hypot((e["a"][0] + e["b"][0]) / 2 - fm[0], (e["a"][1] + e["b"][1]) / 2 - fm[1]))
    facade = r.get("facade", "punched")
    ground = r.get("ground", "punched")

    if r.get("type") == "garage":
        return None  # garages keep the game's procedural open-deck model (with fins)

    # Ground floor
    g_top = fh if ground != "recessedColumns" else fh
    recess = r.get("recess", 0.0) if ground == "recessedColumns" else 0.0
    inner = offset_ring(ring, -recess) if recess else ring
    for e in edges(inner):
        if ground in ("curtain", "storefront", "recessedColumns"):
            curtain_wall(B, e, 0, g_top, glass, frame, bay=1.6, floor_h=g_top)
        elif ground == "stoneBase":
            wall_strip(B, wall_mat("limestone"), e, -0.5, g_top)
        else:
            wall_strip(B, wall, e, -0.5, g_top)
    if recess:
        col_m = wall_mat(r["groundMat"]) if r.get("groundMat") else wall
        slab_ring(B, inner, ring, g_top - 0.05, 0.05, WOOD() if r.get("timber") else col_m)
        if r.get("timber"):
            # Timber slat soffit (Sciences Building): slats along each wall under the overhang.
            for e in es:
                for k in range(int(recess / 0.25)):
                    o = -0.15 - k * 0.25
                    a = (e["a"][0] + e["n"][0] * o, e["a"][1] + e["n"][1] * o)
                    b = (e["b"][0] + e["n"][0] * o, e["b"][1] + e["n"][1] * o)
                    c = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
                    B.box(WOOD(), W(c, g_top - 0.14), (e["len"], 0.1, 0.12), math.atan2(-e["u"][1], e["u"][0]))
        for e in es:
            n = max(1, round(e["len"] / 7.5))
            for k in range(n + 1):
                t = e["len"] * k / n
                p = (e["a"][0] + e["u"][0] * t - e["n"][0] * 0.6, e["a"][1] + e["u"][1] * t - e["n"][1] * 0.6)
                column(B, p, 0, g_top, 0.6 if not r.get("groundMat") else 0.9, col_m)

    # Upper floors
    y0 = g_top
    for e in es:
        if facade in ("curtainWall",):
            curtain_wall(B, e, y0, H, glass, frame, bay=1.5, floor_h=fh)
        elif facade == "fins":
            curtain_wall(B, e, y0 if ground != "curtain" else 0, H, glass, frame, bay=r.get("finSpacing", 1.8), floor_h=fh)
            sp = r.get("finSpacing", 1.8)
            n = int(e["len"] / sp)
            fm = wall if r.get("wall") != "white" else WHITE()
            for k in range(1, n):
                fin(B, e, k * sp, 0, H + 0.4, r.get("finDepth", 0.6), 0.2, fm)
        elif facade == "louvered" and r.get("screenOut"):
            # Student Services: the sunscreen is a white exoskeleton standing off the glass
            # (columns to the ground, a louver tray at every floor), and the top floor is a
            # plain white band with a teal glass ribbon above the screen.
            so = r["screenOut"]
            top = H - fh
            curtain_wall(B, e, y0, top, glass, WHITE(), bay=1.5, floor_h=fh)
            wall_strip(B, WHITE(), e, top, top + fh * 0.35)
            wall_strip(B, WHITE(), e, H - fh * 0.2, H)
            curtain_wall(B, e, top + fh * 0.35, H - fh * 0.2, glass_mat("teal"), WHITE(), bay=1.5, floor_h=fh, t0=0.0)
            if e["len"] > 12:
                se = sub_edge(e, -0.5, e["len"] + 0.5, so)
                yaw = math.atan2(-e["u"][1], e["u"][0])
                n = max(2, round(e["len"] / 7.5))
                for k in range(n + 1):
                    t = -0.5 + (e["len"] + 1.0) * k / n
                    c = (e["a"][0] + e["u"][0] * t + e["n"][0] * so, e["a"][1] + e["u"][1] * t + e["n"][1] * so)
                    column(B, c, 0, top + 0.3, 0.35, WHITE())
                y = fh
                while y < top + 0.1:
                    # Tray: a deep shelf from the glass out to the columns, with blades below it.
                    c = ((se["a"][0] + se["b"][0]) / 2 - e["n"][0] * so / 2, (se["a"][1] + se["b"][1]) / 2 - e["n"][1] * so / 2)
                    B.box(WHITE(), W(c, y), (se["len"], 0.12, so + 0.3), yaw)
                    for j, d in enumerate((0.45, 0.9, 1.35)):
                        if y - d > y0 - 0.1:
                            louver_blade(B, sub_edge(e, -0.5, e["len"] + 0.5, so - 0.75), y - d, 0.6 - 0.1 * j, mat("Louver_White", "e9ebea", 0.3, 0.4), 0.05)
                    y += fh
        elif facade == "louvered":
            curtain_wall(B, e, y0, H, glass, WHITE(), bay=1.5, floor_h=fh)
            y = y0 + fh * 0.75
            while y < H:
                louver_blade(B, e, y, 1.1, WHITE())
                louver_blade(B, e, y + 0.35, 0.8, WHITE(), 0.04)
                y += fh
            for k in range(1, int(e["len"] / 3)):
                fin(B, e, k * 3.0, y0 + fh * 0.6, H, 1.2, 0.08, WHITE())
        elif facade == "bands":
            y = y0
            sw = r.get("bandWall", 0.45)  # share of each floor that is solid band
            while y < H - 0.1:
                wall_strip(B, wall, e, y, y + fh * sw, out=0.0)
                curtain_wall(B, e, y + fh * sw, min(H, y + fh * (1 if sw < 0.5 else 1)), glass, frame, bay=1.5, floor_h=fh)
                y += fh
        elif facade == "precastFrames":
            wall_strip(B, glass, e, y0, H, out=-0.9)
            bay = r.get("bay", 4.5)
            n = max(1, int(e["len"] / bay))
            for k in range(n + 1):
                fin(B, e, e["len"] * k / n, y0, H, 0.9, 0.45, wall)
            y = y0
            while y < H:
                fin_e = e
                c = ((e["a"][0] + e["b"][0]) / 2 + e["n"][0] * 0.0, (e["a"][1] + e["b"][1]) / 2 + e["n"][1] * 0.0)
                B.box(wall, W(c, y + fh - 0.5), (e["len"], 1.0, 1.8), math.atan2(-e["u"][1], e["u"][0]))
                y += fh
        elif facade == "mosaic" and e is longest:
            wall_strip(B, wall, e, y0, H)
            import random
            rnd = random.Random(7)
            cols, rows = max(4, int(e["len"] / 2)), max(3, int((H - y0) / 2))
            for i in range(cols):
                for j in range(rows):
                    t = (i + 0.5) * e["len"] / cols
                    c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.06, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.06)
                    shade = rnd.choice(["1f4fb6", "2d66d1", "5a86df", "173c8f", "7c9fe6"])
                    B.box(mat("Mosaic_" + shade, shade, 0.4, 0.15), W(c, y0 + (j + 0.5) * (H - y0) / rows), (e["len"] / cols - 0.06, (H - y0) / rows - 0.06, 0.05), math.atan2(-e["u"][1], e["u"][0]))
        elif facade in ("blank", "metalPanel", "louverScreen", "tileWithBays"):
            wall_strip(B, wall, e, y0, H)
            if facade == "louverScreen":
                y = y0 + 0.3
                while y < H:
                    louver_blade(B, e, y, 0.35, mat("Louver_Silver", "c3c8cc", 0.9, 0.3), 0.04)
                    y += 0.3
            if facade == "tileWithBays" and e["len"] > 8:
                # Most of each facade is teal curtain wall; the violet tile frames it (NSERL photo).
                curtain_wall(B, e, y0, H, glass, frame, bay=1.4, floor_h=fh, t0=e["len"] * 0.3, t1=e["len"] * 0.95)
        else:  # punched / hall
            wall_strip(B, wall, e, y0 if ground != "punched" else -0.5, H)
            if r.get("brickBays"):
                # Brick bays: alternate ~10 m stretches measured along the whole facade
                # (curved footprints are many short edges), laid just proud of the panels.
                s0 = e["s0"]
                t = 0.0
                while t < e["len"] - 0.05:
                    seg = 10 - ((s0 + t) % 10)
                    if int((s0 + t) // 10) % 2 == 1:
                        wall_strip(B, wall_mat(r.get("bayMat", "brick")), e, -0.5, H - 0.3, t, min(e["len"], t + seg), out=0.03)
                    t += seg
            bay = r.get("bay", 3.4)
            n = max(1, int(e["len"] / bay))
            y = y0 if ground != "punched" else 0
            fl = 0
            while y + fh * 0.9 <= H:
                for k in range(n):
                    t = e["len"] * (k + 0.5) / n
                    if r.get("reveal"):
                        # Glass set deep in the wall (Green Hall): the wall face is carried
                        # `d` proud of the glass, with jambs, a head soffit and a steep light
                        # sill sloping down and out below each window.
                        d = r["reveal"]
                        w_, h_, y_ = min(bay * 0.7, 2.2), fh * 0.5, y + fh * 0.32
                        c = (e["a"][0] + e["u"][0] * t, e["a"][1] + e["u"][1] * t)
                        def q(dt, o):
                            return (c[0] + e["u"][0] * dt + e["n"][0] * o, c[1] + e["u"][1] * dt + e["n"][1] * o)
                        B.box(glass, W(q(0, 0.08), y_ + h_ / 2), (w_, h_, 0.02), math.atan2(-e["u"][1], e["u"][0]))
                        B.box(frame, W(q(0, 0.1), y_ + h_ * 0.55), (w_, 0.05, 0.04), math.atan2(-e["u"][1], e["u"][0]))
                        sm = mat("Sill_Light", "ddd6c8", 0.0, 0.8)
                        B.quad(sm, W(q(-w_ / 2, d), y_ - 0.55), W(q(w_ / 2, d), y_ - 0.55), W(q(w_ / 2, 0.08), y_), W(q(-w_ / 2, 0.08), y_))
                        B.quad(wall, W(q(-w_ / 2, 0.0), y_ + h_), W(q(w_ / 2, 0.0), y_ + h_), W(q(w_ / 2, d), y_ + h_), W(q(-w_ / 2, d), y_ + h_))
                        for sd in (-1, 1):
                            B.quad(wall, W(q(sd * w_ / 2, d), y_ - 0.55), W(q(sd * w_ / 2, 0.0), y_ - 0.55), W(q(sd * w_ / 2, 0.0), y_ + h_), W(q(sd * w_ / 2, d), y_ + h_))
                            B.quad(wall, W(q(sd * w_ / 2, 0.0), y_ - 0.55), W(q(sd * w_ / 2, d), y_ - 0.55), W(q(sd * w_ / 2, d), y_ + h_), W(q(sd * w_ / 2, 0.0), y_ + h_))
                        # Outer skin: piers between windows (the bands above and below are drawn per floor).
                        tn = e["len"] * (k + 1.5) / n if k + 1 < n else e["len"] + d
                        tp = t + w_ / 2
                        nxt = (tn - w_ / 2) if k + 1 < n else tn
                        if k == 0:
                            wall_strip(B, wall, e, y_ - 0.55, y_ + h_, -d, t - w_ / 2, out=d)
                        wall_strip(B, wall, e, y_ - 0.55, y_ + h_, tp, nxt, out=d)
                    else:
                        window_module(B, e, t, y + fh * 0.3, min(bay * 0.55, 1.8), fh * 0.55, glass, frame if facade != "hall" else WHITE(), depth=0.25 if r.get("ribs") else 0.15)
                if r.get("reveal"):
                    d = r["reveal"]
                    y_ = y + fh * 0.32
                    wall_strip(B, wall, e, y, y_ - 0.55, -d, e["len"] + d, out=d)
                    wall_strip(B, wall, e, y_ + fh * 0.5, min(y + fh, H + 0.9), -d, e["len"] + d, out=d)
                y += fh
                fl += 1
            if r.get("reveal"):
                d = r["reveal"]
                wall_strip(B, wall, e, y, H + 0.9, -d, e["len"] + d, out=d)
                a0 = (e["a"][0] - e["u"][0] * d, e["a"][1] - e["u"][1] * d)
                b0 = (e["b"][0] + e["u"][0] * d, e["b"][1] + e["u"][1] * d)
                o = lambda p, k: (p[0] + e["n"][0] * k, p[1] + e["n"][1] * k)
                B.quad(wall, W(o(a0, 0), H + 0.9), W(o(b0, 0), H + 0.9), W(o(b0, d), H + 0.9), W(o(a0, d), H + 0.9))
                B.quad(wall, W(o(a0, d), fh), W(o(b0, d), fh), W(o(b0, 0), fh), W(o(a0, 0), fh))
            if r.get("ribs"):
                for k in range(n + 1):
                    fin(B, e, e["len"] * k / n, 0, H + 0.6, 0.45, 0.55, wall)
            if facade == "hall":
                y = fh
                while y < H - 0.5:
                    louver_blade(B, e, y - 0.05, 0.08, WHITE(), 0.18)
                    y += fh

    # Entrance on the longest facade
    door_assembly(B, longest, longest["len"] / 2, 0.0, glass_mat("dark"), frame, True)

    # Roof
    roof = r.get("roof", "parapet")
    polygon_cap(B, ROOF(), ring, H, holes=holes)
    for h in holes:
        for e in edges(ccw(h)[::-1]):
            wall_strip(B, wall, e, -0.5, H)
    if roof == "parapet":
        parapet(B, ring, H, 0.9, wall)
    elif roof == "cornice":
        slab_ring(B, ring, offset_ring(ring, 0.6), H, 0.5, WHITE() if r.get("wall") != "violetTile" else mat("Metal_Cornice", "b4b9bd", 0.8, 0.35))
    elif roof == "fascia":
        fd, fhh = r.get("fasciaDepth", 1.6), r.get("fasciaH", 0.9)
        slab_ring(B, ring, offset_ring(ring, fd), H + 0.9 - fhh, fhh, wall)
    elif roof == "thinEdge":
        slab_ring(B, ring, offset_ring(ring, 0.9), H, 0.3, WHITE())
    elif roof == "frame":
        # Student Services Addition: a deep charcoal picture frame round the glass of each
        # long face (head, sill band, jambs), with the glass set 1.6 m back inside it.
        slab_ring(B, ring, offset_ring(ring, 1.6), H, 1.0, wall)
        for e in es:
            yaw = math.atan2(-e["u"][1], e["u"][0])
            wall_strip(B, wall, e, H - 1.2, H + 1.0, out=1.6)
            if e["len"] < 10:
                wall_strip(B, wall, e, -0.2, H + 1.0, out=1.6)
                continue
            mid = ((e["a"][0] + e["b"][0]) / 2 + e["n"][0] * 0.8, (e["a"][1] + e["b"][1]) / 2 + e["n"][1] * 0.8)
            B.box(wall, W(mid, fh + 0.35), (e["len"], 0.7, 1.6), yaw)  # sill band
            B.box(wall, W(mid, H - 0.3), (e["len"], 0.25, 1.6), yaw)   # soffit of the head
            for t in (0.6, e["len"] - 0.6):
                c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.8, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.8)
                B.box(wall, W(c, (fh + H + 1.0) / 2), (1.2, H + 1.0 - fh, 1.6), yaw)
            # Charcoal panel base below the sill.
            wall_strip(B, wall, e, -0.2, fh, out=0.05)
    elif roof == "floatingPlane" and r.get("roofTilt"):
        # Founders: one thin white plane, rising toward the front, far overhang on the front.
        e = longest
        over = r.get("roofOverhang", 3.0)
        at, h, (u0, u1, n0, n1) = sloped_plane(B, WHITE(), WOOD() if r.get("soffit") == "wood" else mat("Soffit_Metal", "d9dcde", 0.6, 0.35),
                                               e, ring, H + 0.6, H + 0.6 + r["roofTilt"], over, 1.2, 0.35, 1.2)
        # Slim columns under the front overhang and along the back.
        k = max(2, round((u1 - u0) / 7))
        for i in range(k + 1):
            su = u0 + 1 + (u1 - u0 - 2) * i / k
            for sn in (n1 - 0.6, n0 + 0.6):
                column(B, at(su, sn), 0 if sn > 0 else H - 0.5, h(sn), 0.25, WHITE())
    elif roof == "floatingPlane":
        over = r.get("roofOverhang", 3.0)
        top = H + 0.9
        outer = offset_ring(ring, over)
        polygon_cap(B, WHITE(), outer, top + 0.35)
        polygon_cap(B, WOOD() if r.get("soffit") == "wood" else WHITE(), outer, top, down=True)
        for e in edges(outer):
            wall_strip(B, WHITE(), e, top, top + 0.35)
        for e in edges(offset_ring(ring, over - 0.4)):
            n = max(1, round(e["len"] / 7))
            for k in range(n):
                p = (e["a"][0] + e["u"][0] * e["len"] * k / n, e["a"][1] + e["u"][1] * e["len"] * k / n)
                column(B, p, H, top, 0.18, WHITE())
        if r.get("frontReach"):
            # Davidson-Gundy: the roof plane runs far out over the entrance terrace on
            # slender white columns standing on the ground.
            e = longest
            fr = r["frontReach"]
            ext = [(e["a"][0] + e["u"][0] * t + e["n"][0] * o, e["a"][1] + e["u"][1] * t + e["n"][1] * o)
                   for t, o in ((-over, over - 0.1), (e["len"] + over, over - 0.1), (e["len"] + over, fr), (-over, fr))]
            ext = ccw(ext)
            polygon_cap(B, WHITE(), ext, top + 0.35)
            polygon_cap(B, WOOD() if r.get("soffit") == "wood" else mat("Soffit_Light", "ece6da", 0.0, 0.6), ext, top, down=True)
            for ee in edges(ext):
                wall_strip(B, WHITE(), ee, top, top + 0.35)
            k = max(2, round((e["len"] + 2 * over) / 9))
            for i in range(k + 1):
                t = -over + 1 + (e["len"] + 2 * over - 2) * i / k
                p = (e["a"][0] + e["u"][0] * t + e["n"][0] * (fr - 1.5), e["a"][1] + e["u"][1] * t + e["n"][1] * (fr - 1.5))
                column(B, p, 0, top, 0.3, WHITE())
    elif roof == "cantileverTruss":
        # ATEC: one huge roof plane over the whole building, rising toward the front and
        # cantilevered far beyond it; a steel lattice underneath and raking steel columns.
        e = longest
        reach = r.get("cantilever", 12)
        rise = r.get("roofRise", 7.0)
        at, h, (u0, u1, n0, n1) = sloped_plane(B, mat("Roof_Metal", "2e3a46", 0.7, 0.4), mat("Soffit_Dark", "3b4450", 0.5, 0.5), e, ring, H + 0.4, H + 0.4 + rise, reach, 2.0, 0.7, 0.8)
        k = max(3, round((u1 - u0) / 5))
        for i in range(k + 1):
            su = u0 + (u1 - u0) * i / k
            # Ribs along the slope, and diagonals between them.
            steel_member(B, BEAM(), at(su, n0), h(n0) - 0.3, at(su, n1), h(n1) - 0.3, 0.35)
            if i < k:
                sn = n0 + (n1 - n0) * (0.3 + 0.4 * (i % 2))
                steel_member(B, BEAM(), at(su, sn), h(sn) - 0.3, at(u0 + (u1 - u0) * (i + 1) / k, n1 - 1), h(n1 - 1) - 0.3, 0.2)
        # Raking columns from the ground in front of the facade up to the cantilever's edge.
        for i in range(1, k, 2):
            su = u0 + (u1 - u0) * i / k
            steel_member(B, BEAM(), at(su, reach * 0.35), 0.0, at(su, n1 - 1.5), h(n1 - 1.5) - 0.3, 0.45)
        parapet(B, ring, H, 0.4, wall)
    elif roof == "hip":
        rm = mat("Roof_Metal_Seam", "c9ccce", 0.6, 0.4) if r.get("roofMat") == "metal" else SHINGLE()
        hip_roof(B, ring, H, r.get("roofRise", 4.0), rm)
    if r.get("lantern") == "entryPyramid":
        # Administration Building: over the entrance block, a raised stone block with a
        # glazed clerestory and a steep standing-seam glass pyramid on top.
        e = longest
        s_ = 9.0
        cc = (e["a"][0] + e["u"][0] * e["len"] / 2 - e["n"][0] * (s_ / 2 + 1.0), e["a"][1] + e["u"][1] * e["len"] / 2 - e["n"][1] * (s_ / 2 + 1.0))
        ux, uy = e["u"]
        nx, ny = e["n"]
        def corner(a_, b_, k=1.0):
            return (cc[0] + (ux * a_ + nx * b_) * k, cc[1] + (uy * a_ + ny * b_) * k)
        sq = ccw([corner(-s_ / 2, -s_ / 2), corner(s_ / 2, -s_ / 2), corner(s_ / 2, s_ / 2), corner(-s_ / 2, s_ / 2)])
        base = H + 1.6
        for ee in edges(sq):
            wall_strip(B, wall, ee, H - 0.5, base)
            curtain_wall(B, ee, base, base + 2.6, glass_mat("teal"), WHITE(), bay=1.5, floor_h=2.6)
        polygon_cap(B, ROOF(), sq, base)
        apex = (cc[0], cc[1])
        pm = mat("Pyramid_Metal", "4f5d5c", 0.5, 0.4)
        top = base + 2.6
        eav = [corner(-s_ / 2, -s_ / 2, 1.08), corner(s_ / 2, -s_ / 2, 1.08), corner(s_ / 2, s_ / 2, 1.08), corner(-s_ / 2, s_ / 2, 1.08)]
        for i in range(4):
            a_, b_ = eav[i], eav[(i + 1) % 4]
            B.quad(pm, W(a_, top), W(b_, top), W(apex, top + 5.5), W(apex, top + 5.501))
            B.quad(pm, W(b_, top), W(a_, top), W(apex, top + 5.501), W(apex, top + 5.5))
            steel_member(B, WHITE(), a_, top, apex, top + 5.5, 0.12)
        polygon_cap(B, WHITE(), ccw(eav), top, down=True)
    if r.get("lantern") == "pyramid":
        s = 9.0
        top = H + 0.9
        c0 = [(-s / 2, -s / 2), (s / 2, -s / 2), (s / 2, s / 2), (-s / 2, s / 2)]
        for i in range(4):
            a, b = c0[i], c0[(i + 1) % 4]
            B.quad(glass_mat("teal"), W(a, top), W(b, top), W((0, 0), top + 6), W((0, 0), top + 6.001))
        for p in c0:
            column(B, p, top - 0.5, top + 0.3, 0.4, mat("Metal_Cornice", "b4b9bd", 0.8, 0.35))
    def half_ring(c, base, rr, seg=18):
        return [(c[0] + math.cos(base - math.pi / 2 + math.pi * k / seg) * rr, c[1] + math.sin(base - math.pi / 2 + math.pi * k / seg) * rr) for k in range(seg + 1)]

    def ring_band(pts, y0, y1, m):
        for k in range(len(pts) - 1):
            B.quad(m, W(pts[k], y0), W(pts[k + 1], y0), W(pts[k + 1], y1), W(pts[k], y1))

    def curved_canopy(c, base, r0, r1, y, a0, a1, posts=True):
        # A flat curved canopy between radii r0 and r1 over the arc a0..a1 (radians from the normal).
        seg = 10
        cm = mat("Canopy_White", "f0efea", 0.1, 0.4)
        inner = [(c[0] + math.cos(base + a0 + (a1 - a0) * k / seg) * r0, c[1] + math.sin(base + a0 + (a1 - a0) * k / seg) * r0) for k in range(seg + 1)]
        outer = [(c[0] + math.cos(base + a0 + (a1 - a0) * k / seg) * r1, c[1] + math.sin(base + a0 + (a1 - a0) * k / seg) * r1) for k in range(seg + 1)]
        for k in range(seg):
            B.quad(cm, W(inner[k], y + 0.45), W(inner[k + 1], y + 0.45), W(outer[k + 1], y + 0.45), W(outer[k], y + 0.45))
            B.quad(cm, W(outer[k], y), W(outer[k + 1], y), W(inner[k + 1], y), W(inner[k], y))
            B.quad(cm, W(outer[k], y), W(outer[k + 1], y), W(outer[k + 1], y + 0.45), W(outer[k], y + 0.45))
        if posts:
            for k in range(0, seg + 1, 2):
                p_ = (c[0] + math.cos(base + a0 + (a1 - a0) * k / seg) * (r1 - 0.6), c[1] + math.sin(base + a0 + (a1 - a0) * k / seg) * (r1 - 0.6))
                B.box(WHITE(), W(p_, y / 2), (0.55, y, 0.55))
                solid_post(p_, 0.3)

    if r.get("rotunda") == "pavilion":
        # University Commons / Helix / Sirius: a two-storey half-ring of limestone piers and
        # glass with a white ledge, a smaller white drum with a glass ribbon above it, and a
        # glazed clerestory on the wall behind; a curved canopy over the doors.
        e = longest
        base = math.atan2(e["n"][1], e["n"][0])
        st = wall_mat("limestone")
        R1, R2 = r.get("pavilionR", 9.5), r.get("pavilionR", 9.5) * 0.66
        # Mapped roads in front: never build over them. Set the drum back into the wall
        # (the OSM outline usually already includes part of it) to keep 1.5 m clear.
        inset = min(R1 * 0.8, max(0.0, R1 + 2.4 - (r.get("frontClear", 40.0) - 1.5)))
        c = (e["a"][0] + e["u"][0] * e["len"] / 2 - e["n"][0] * inset, e["a"][1] + e["u"][1] * e["len"] / 2 - e["n"][1] * inset)
        y1 = min(2 * fh, H - fh)
        p1 = half_ring(c, base, R1)
        solid_ring(p1)
        ring_band([(c[0] + (q[0] - c[0]) * 0.995, c[1] + (q[1] - c[1]) * 0.995) for q in p1], 0, y1, glass)
        for k in range(0, len(p1), 2):
            yaw = math.atan2(-(p1[min(k + 1, len(p1) - 1)][1] - p1[max(k - 1, 0)][1]), p1[min(k + 1, len(p1) - 1)][0] - p1[max(k - 1, 0)][0])
            B.box(st, W(p1[k], y1 / 2), (1.1, y1, 0.6), yaw)
        for y in (fh, y1):
            ring_band(half_ring(c, base, R1 + 0.35), y - 0.35, y + 0.15, WHITE())
            polygon_cap(B, WHITE(), ccw(half_ring(c, base, R1 + 0.35)), y + 0.15)
            polygon_cap(B, WHITE(), ccw(half_ring(c, base, R1 + 0.35)), y - 0.35, down=True)
        p2 = half_ring(c, base, R2)
        y2 = min(y1 + fh, H + 0.5)
        ring_band(p2, y1, y1 + 0.9, WHITE())
        ring_band(p2, y1 + 0.9, y2 - 0.6, glass)
        ring_band(p2, y2 - 0.6, y2, WHITE())
        polygon_cap(B, ROOF(), ccw(p2), y2)
        for k in range(0, len(p2), 2):
            B.box(FRAME(), W(p2[k], (y1 + 0.9 + y2 - 0.6) / 2), (0.08, y2 - 1.5 - y1, 0.1))
        if y2 + 1.0 < H + 2.5:
            cl = sub_edge(e, e["len"] / 2 - R2, e["len"] / 2 + R2, 0.15)
            curtain_wall(B, cl, y2, min(H + 2.2, y2 + fh * 1.1), glass, FRAME(), bay=1.6, floor_h=fh)
        curved_canopy(c, base, R1 - 0.2, R1 + 2.4, min(fh * 0.85, 4.0), -0.35, 0.35)
    elif r.get("rotunda") == "silver":
        # Andromeda: a full-height silver drum with blue glass bands and recessed terrace bands,
        # and a broad curved canopy on round columns over the entrance.
        e = longest
        base = math.atan2(e["n"][1], e["n"][0])
        R = r.get("pavilionR", 9.0)
        inset = min(R * 0.8, max(0.0, R + 4.5 - (r.get("frontClear", 40.0) - 1.5)))
        c = (e["a"][0] + e["u"][0] * e["len"] / 2 - e["n"][0] * inset, e["a"][1] + e["u"][1] * e["len"] / 2 - e["n"][1] * inset)
        silver = mat("Metal_Drum", "b9bec2", 0.7, 0.35)
        solid_ring(half_ring(c, base, R))
        y = 0.0
        band = 0
        while y < H - 0.2:
            hh = min(1.2 if band % 2 == 0 else 2.0, H - y)
            rr = R if band % 2 == 0 or band % 4 != 3 else R - 1.4
            ring_band(half_ring(c, base, rr), y, y + hh, silver if band % 2 == 0 else glass_mat("blue"))
            if rr < R:
                polygon_cap(B, silver, ccw(half_ring(c, base, R)), y + 0.01)
            y += hh
            band += 1
        polygon_cap(B, silver, ccw(half_ring(c, base, R)), H + 0.01)
        ring_band(half_ring(c, base, R), H, H + 0.6, silver)
        curved_canopy(c, base, R - 0.3, R + 4.5, 5.0, -0.7, 0.7)
    elif r.get("rotunda"):
        e = longest
        c = (e["a"][0] + e["u"][0] * e["len"] / 2 + e["n"][0] * 0.2, e["a"][1] + e["u"][1] * e["len"] / 2 + e["n"][1] * 0.2)
        rr = 5.0
        # Drum centred on the wall, bulging outward.
        seg = 16
        for k in range(seg):
            a0 = math.atan2(e["n"][1], e["n"][0]) - math.pi / 2 + math.pi * k / seg
            a1 = a0 + math.pi / seg
            p0 = (c[0] + math.cos(a0) * rr, c[1] + math.sin(a0) * rr)
            p1 = (c[0] + math.cos(a1) * rr, c[1] + math.sin(a1) * rr)
            y = 0.0
            band = 0
            while y < H - 0.2:
                h = 1.1 if band % 2 == 0 else 1.7
                h = min(h, H - y)
                # Limestone bands and teal glass bands; the top band is gray metal (Sirius/Helix photos).
                solid = mat("Metal_Drum", "a9aeb3", 0.7, 0.35) if y + h >= H - 0.2 else wall_mat("limestone")
                B.quad(solid if band % 2 == 0 else glass_mat("teal"), W(p0, y), W(p1, y), W(p1, y + h), W(p0, y + h))
                y += h
                band += 1
            B.quad(WHITE(), W(c, H + 0.6), W(p1, H + 0.6), W(p0, H + 0.6), W(c, H + 0.601))
    if r.get("tower") == "glass":
        e = longest
        t = e["len"] * 0.85
        c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 1.5, e["a"][1] + e["u"][1] * t + e["n"][1] * 1.5)
        B.box(glass_mat("teal" if r.get("glass") != "blue" else "blue"), W(c, (H + 2) / 2), (4.0, H + 2, 3.0), math.atan2(-e["u"][1], e["u"][0]))
    if r.get("accent") == "orangeBalcony":
        # Callier Center: an orange perforated-screen balcony across the entrance bay, an
        # orange sunshade canopy above it, and a red stair up the side.
        e = longest
        t0, t1 = e["len"] * 0.2, e["len"] * 0.2 + min(14.0, e["len"] * 0.5)
        screen_balcony(B, e, t0, t1, fh, 2.2, 1.3)
        cs = mat("Screen_Orange", "e2552a", 0.5, 0.45)
        def at(t, o):
            return (e["a"][0] + e["u"][0] * t + e["n"][0] * o, e["a"][1] + e["u"][1] * t + e["n"][1] * o)
        y = min(H - 0.6, fh * 2 - 0.3)
        B.quad(cs, W(at(t0 - 1, 0), y), W(at(t1 + 1, 0), y), W(at(t1 + 1, 3.2), y - 0.25), W(at(t0 - 1, 3.2), y - 0.25))
        B.quad(cs, W(at(t0 - 1, 3.2), y - 0.4), W(at(t1 + 1, 3.2), y - 0.4), W(at(t1 + 1, 0), y - 0.15), W(at(t0 - 1, 0), y - 0.15))
        for t in (t0 - 0.5, (t0 + t1) / 2, t1 + 0.5):
            steel_member(B, FRAME(), at(t, 0), y + 1.2, at(t, 3.0), y - 0.2, 0.06)
        exterior_stair(B, e, t0 - 0.4, fh, 1.8)
    if r.get("groundCanopy"):
        # Sloped standing-seam metal canopy over the ground-floor glass (McDermott Library).
        cm = mat("Roof_Metal_Canopy", "9a958b", 0.5, 0.45)
        for e in es:
            if e["len"] > 10:
                shed_canopy(B, e, fh + 0.2, r["groundCanopy"], 1.0, cm)
    if r.get("stoneFrame"):
        # Bioengineering and Sciences: a deep limestone frame round the middle of the front
        # curtain wall (jambs and a head band, proud of the glass), a stone end bay, and
        # horizontal aluminium sunshades on the glass outside the frame.
        e = max(es, key=lambda e: e["len"])  # the long face, not the entrance face
        f0, f1 = r["stoneFrame"]
        t0, t1 = e["len"] * f0, e["len"] * f1
        top = H - fh * 0.55
        st = wall_mat("limestone")
        yaw = math.atan2(-e["u"][1], e["u"][0])
        for t in (t0, t1):
            c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.75, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.75)
            B.box(st, W(c, top / 2), (2.6, top, 1.5), yaw)
        mid = (e["a"][0] + e["u"][0] * (t0 + t1) / 2 + e["n"][0] * 0.75, e["a"][1] + e["u"][1] * (t0 + t1) / 2 + e["n"][1] * 0.75)
        B.box(st, W(mid, top - 1.1), (t1 - t0 + 2.6, 2.2, 1.5), yaw)
        # Thin stone bands at each floor line inside the frame.
        y = fh
        while y < top - 2.3:
            B.box(st, W(mid, y), (t1 - t0, 0.35, 0.5), yaw)
            y += fh
        # Stone end bay beyond the frame.
        if t1 + 3 < e["len"]:
            wall_strip(B, st, e, -0.5, top, t1 + 1.3, min(e["len"], t1 + 9), out=0.1)
        blade = mat("Sunshade_Alu", "c9ced2", 0.8, 0.35)
        for span in ((0.0, t0 - 1.3), (min(e["len"], t1 + 9), e["len"])):
            if span[1] - span[0] < 3:
                continue
            se = sub_edge(e, span[0], span[1])
            y = fh * 1.7
            while y < H - 0.5:
                louver_blade(B, se, y, 1.0, blade, 0.07)
                louver_blade(B, se, y + 0.45, 0.8, blade, 0.05)
                y += fh * 0.5
        for e2 in es:
            if e2 is not e and e2["len"] > 12:
                y = fh * 1.7
                while y < H - 0.5:
                    louver_blade(B, e2, y, 0.8, blade, 0.06)
                    y += fh
    if r.get("entryBlock") == "glass":
        # Activity Center: the entrance is a taller dark-glass block on the axis of the front
        # walk, its flat metal cap above the roof line, with the doors in its face.
        e = longest
        bw, bd = r.get("entryWidth", 9.0), r.get("entryDepth", 3.0)
        tm = e["len"] / 2
        t0, t1 = tm - bw / 2, tm + bw / 2
        bh = H + 2.0
        # A half drum of dark glass bulging out of the wall, with mullions, a metal band and a flat cap.
        rr = bw / 2
        c = (e["a"][0] + e["u"][0] * tm, e["a"][1] + e["u"][1] * tm)
        base = math.atan2(e["n"][1], e["n"][0])
        metal = mat("Metal_Cap", "9da3a8", 0.8, 0.35)
        seg = 14
        pts = [(c[0] + math.cos(base - math.pi / 2 + math.pi * k / seg) * rr, c[1] + math.sin(base - math.pi / 2 + math.pi * k / seg) * rr) for k in range(seg + 1)]
        solid_ring(pts)
        for k in range(seg):
            p0, p1 = pts[k], pts[k + 1]
            B.quad(glass, W(p0, 0), W(p1, 0), W(p1, bh - 1.2), W(p0, bh - 1.2))
            B.quad(metal, W(p0, bh - 1.2), W(p1, bh - 1.2), W(p1, bh), W(p0, bh))
            yaw = math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0])
            B.box(frame, W(p0, (bh - 1.2) / 2), (0.08, bh - 1.2, 0.14), yaw)
        for y in (bh * 0.33, bh * 0.66):
            for k in range(seg):
                p0, p1 = pts[k], pts[k + 1]
                m_ = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
                B.box(frame, W(m_, y), (math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.1, 0.14), math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]))
        polygon_cap(B, metal, ccw(pts), bh + 0.01)
        # Dark curved fascia canopy round the drum at the door head ("University Recreation").
        cr, cy0, cy1 = rr + 2.6, 3.6, 4.6
        dark = mat("Canopy_Dark", "2f3133", 0.4, 0.5)
        cpts = [(c[0] + math.cos(base - math.pi / 2 + math.pi * k / seg) * cr, c[1] + math.sin(base - math.pi / 2 + math.pi * k / seg) * cr) for k in range(seg + 1)]
        for k in range(seg):
            B.quad(dark, W(cpts[k], cy0), W(cpts[k + 1], cy0), W(cpts[k + 1], cy1), W(cpts[k], cy1))
        polygon_cap(B, dark, ccw(cpts), cy1)
        polygon_cap(B, mat("Soffit_Light", "ece6da", 0.0, 0.6), ccw(cpts), cy0, down=True)
        for k in (0, seg):
            column(B, cpts[k], 0, cy0, 0.25, dark)
        front = sub_edge(e, tm - 1.5, tm + 1.5, rr - 0.05)
        door_assembly(B, front, 1.5, 0.0, glass_mat("dark"), frame, True)
    if r.get("entryPilasters"):
        # Synergy Park North: two tall square pilasters clad in brown metal on dark bases,
        # standing clear of the facade either side of the entrance.
        e = longest
        pm = mat("Pilaster_" + r["entryPilasters"], r["entryPilasters"], 0.3, 0.5)
        yaw = math.atan2(-e["u"][1], e["u"][0])
        for t in (e["len"] / 2 - 4.2, e["len"] / 2 + 4.2):
            c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 2.2, e["a"][1] + e["u"][1] * t + e["n"][1] * 2.2)
            B.box(mat("Pilaster_Base", "3a3b3d", 0.2, 0.6), W(c, 1.2), (1.1, 2.4, 1.1), yaw)
            B.box(pm, W(c, (2.4 + H + 1.2) / 2), (1.0, H + 1.2 - 2.4, 1.0), yaw)
            B.box(WHITE(), W(c, H + 1.35), (1.1, 0.3, 1.1), yaw)
    if r.get("entryBay"):
        # Waterview: a two-storey glazed entrance bay inside a white surround, proud of the brick.
        e = longest
        bw = r["entryBay"]
        tm = e["len"] / 2
        se = sub_edge(e, tm - bw / 2, tm + bw / 2, 0.35)
        curtain_wall(B, se, 0, H - 0.6, glass, frame, bay=1.4, floor_h=fh)
        yaw = math.atan2(-e["u"][1], e["u"][0])
        for t in (tm - bw / 2 - 0.4, tm + bw / 2 + 0.4):
            c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.4, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.4)
            B.box(WHITE(), W(c, (H - 0.1) / 2), (0.8, H - 0.1, 0.8), yaw)
        c = (e["a"][0] + e["u"][0] * tm + e["n"][0] * 0.4, e["a"][1] + e["u"][1] * tm + e["n"][1] * 0.4)
        B.box(WHITE(), W(c, H - 0.35), (bw + 1.6, 0.6, 0.8), yaw)
        door_assembly(B, sub_edge(e, tm - 1.5, tm + 1.5, 0.4), 1.5, 0.0, glass_mat("dark"), frame, True)
    if r.get("wainscot"):
        # Limestone wainscot below stucco (Facilities Management).
        for e in es:
            wall_strip(B, wall_mat("limestone"), e, -0.5, r["wainscot"], out=0.05)
            B.box(wall_mat("limestone"), W(((e["a"][0] + e["b"][0]) / 2 + e["n"][0] * 0.08, (e["a"][1] + e["b"][1]) / 2 + e["n"][1] * 0.08), r["wainscot"] + 0.04), (e["len"], 0.08, 0.16), math.atan2(-e["u"][1], e["u"][0]))
    if r.get("entryTower") == "corrugated":
        # Facilities Management: a taller block clad in dark horizontal corrugated metal beside
        # the entrance, with a limestone entry bay and a curved metal canopy over the door.
        e = longest
        tw, td = 9.0, 2.5
        tm = e["len"] / 2
        th = H + 2.2
        dm = mat("Metal_Corrugated", "34373b", 0.25, 0.6)
        yaw = math.atan2(-e["u"][1], e["u"][0])
        c = (e["a"][0] + e["u"][0] * (tm + tw / 2) + e["n"][0] * td / 2, e["a"][1] + e["u"][1] * (tm + tw / 2) + e["n"][1] * td / 2)
        B.box(dm, W(c, th / 2), (tw, th, td), yaw)
        y = 0.4
        while y < th - 0.2:
            fc = (c[0] + e["n"][0] * (td / 2 + 0.04), c[1] + e["n"][1] * (td / 2 + 0.04))
            B.box(dm, W(fc, y), (tw, 0.12, 0.08), yaw)
            y += 0.45
        sc = (e["a"][0] + e["u"][0] * (tm - 2.5) + e["n"][0] * 1.0, e["a"][1] + e["u"][1] * (tm - 2.5) + e["n"][1] * 1.0)
        B.box(wall_mat("limestone"), W(sc, (H + 0.8) / 2), (5.0, H + 0.8, 2.0), yaw)
        door_assembly(B, sub_edge(e, tm - 4, tm - 1, 2.0), 1.5, 0.0, glass_mat("dark"), frame, True)
    if r.get("stripes"):
        # Horizontal bands proud of the wall: dark brick courses (ROC) or runs of coloured
        # panels of random length (ROW, a fixed seed so rebuilds match).
        import random
        st = r["stripes"]
        rnd = random.Random(11)
        cols = [mat("Stripe_" + c, c, 0.1, 0.7) for c in st["colors"]]
        for e in es:
            y = 0.9
            while y < H - 0.6:
                if st.get("random"):
                    t = 0.0
                    while t < e["len"] - 0.3:
                        seg = rnd.uniform(2.5, 9.0)
                        if rnd.random() < 0.7:
                            wall_strip(B, rnd.choice(cols), e, y, y + st["h"], t, min(e["len"], t + seg), out=0.04)
                        t += seg + rnd.uniform(0.0, 1.5)
                else:
                    wall_strip(B, cols[0], e, y, y + st["h"], out=0.03)
                y += st["every"]
    if r.get("endBlock"):
        # ROW: a taller blue-grey metal block at the west end of the long face.
        e = longest
        a0 = e["a"]
        bm_ = mat("EndBlock_Metal", r["endBlock"], 0.5, 0.45)
        yaw = math.atan2(-e["u"][1], e["u"][0])
        c = (a0[0] + e["u"][0] * 4.0 - e["n"][0] * 3.5, a0[1] + e["u"][1] * 4.0 - e["n"][1] * 3.5)
        B.box(bm_, W(c, (H + 1.2) / 2), (8.2, H + 1.2, 7.4), yaw)
    if r.get("storefrontBay"):
        # Metal buildings (Police, Safety and Grounds): a dark-framed glazed entrance bay
        # set slightly back, with the doors in it.
        e = longest
        bw = r["storefrontBay"]
        tm = e["len"] / 2
        se = sub_edge(e, tm - bw / 2, tm + bw / 2, 0.06)
        top = min(H - 0.7, 4.2)
        curtain_wall(B, se, 0, top, glass, FRAME(), bay=1.6, floor_h=top * 0.62)
        yaw = math.atan2(-e["u"][1], e["u"][0])
        for t in (tm - bw / 2 - 0.15, tm + bw / 2 + 0.15):
            c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.1, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.1)
            B.box(mat("Steel_Pilaster", "8f8a7c", 0.4, 0.5), W(c, H / 2), (0.3, H, 0.2), yaw)
    if r.get("rollDoors"):
        # North Lab: white roll-up service doors along the long face.
        e = longest
        n = r["rollDoors"]
        yaw = math.atan2(-e["u"][1], e["u"][0])
        dm = mat("RollDoor_White", "eceae4", 0.2, 0.5)
        for k in range(n):
            t = e["len"] * (k + 1) / (n + 1) + 3.0
            c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.06, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.06)
            hgt = min(H - 1.0, 4.3)
            B.box(dm, W(c, hgt / 2), (3.6, hgt, 0.08), yaw)
            y = 0.5
            while y < hgt:
                B.box(FRAME(), W((c[0] + e["n"][0] * 0.05, c[1] + e["n"][1] * 0.05), y), (3.6, 0.03, 0.02), yaw)
                y += 0.55
            B.box(WHITE(), W(c, hgt + 0.15), (3.9, 0.3, 0.2), yaw)
    if r.get("upperGlassBox"):
        # Rec Center West: a glass box at the upper floor projecting over the entrance walk,
        # carried on round white columns.
        e = longest
        bw, bd = r["upperGlassBox"], 3.2
        tm = e["len"] / 2
        se = sub_edge(e, tm - bw / 2, tm + bw / 2, bd)
        curtain_wall(B, se, fh, H, glass_mat("blue"), FRAME(), bay=1.6, floor_h=(H - fh))
        for t, sgn in ((tm - bw / 2, -1), (tm + bw / 2, 1)):
            a0 = (e["a"][0] + e["u"][0] * t, e["a"][1] + e["u"][1] * t)
            side = {"a": a0, "b": (a0[0] + e["n"][0] * bd, a0[1] + e["n"][1] * bd), "len": bd, "u": e["n"], "n": (e["u"][0] * sgn, e["u"][1] * sgn), "s0": 0.0}
            if sgn < 0:
                side = {"a": side["b"], "b": side["a"], "len": bd, "u": (-e["n"][0], -e["n"][1]), "n": side["n"], "s0": 0.0}
            curtain_wall(B, side, fh, H, glass_mat("blue"), FRAME(), bay=1.6, floor_h=(H - fh))
        box = ccw([(e["a"][0] + e["u"][0] * t + e["n"][0] * o, e["a"][1] + e["u"][1] * t + e["n"][1] * o) for t, o in ((tm - bw / 2, 0), (tm + bw / 2, 0), (tm + bw / 2, bd), (tm - bw / 2, bd))])
        polygon_cap(B, WHITE(), box, fh, down=True)
        polygon_cap(B, WHITE(), box, H + 0.3)
        k = max(2, round(bw / 3.5))
        for i in range(k + 1):
            t = tm - bw / 2 + 0.4 + (bw - 0.8) * i / k
            column(B, (e["a"][0] + e["u"][0] * t + e["n"][0] * (bd - 0.4), e["a"][1] + e["u"][1] * t + e["n"][1] * (bd - 0.4)), 0, fh, 0.55, WHITE())
    if r.get("serviceDoors"):
        # Physics Annex: dark steel personnel doors in light surrounds along the long face.
        e = longest
        n = r["serviceDoors"]
        yaw = math.atan2(-e["u"][1], e["u"][0])
        dm = mat("Door_Steel_Dark", "33373c", 0.4, 0.5)
        for k in range(n):
            t = e["len"] * (k + 0.5) / n + 1.6
            if t > e["len"] - 1.5:
                continue
            c = (e["a"][0] + e["u"][0] * t + e["n"][0] * 0.05, e["a"][1] + e["u"][1] * t + e["n"][1] * 0.05)
            w = 1.9 if k % 2 else 1.0
            B.box(mat("Door_Surround", "d8d2c4", 0.0, 0.8), W(c, 1.15), (w + 0.3, 2.45, 0.08), yaw)
            B.box(dm, W((c[0] + e["n"][0] * 0.03, c[1] + e["n"][1] * 0.03), 1.08), (w, 2.16, 0.06), yaw)
    if r.get("entryLobby"):
        # Canyon Creek Heights: a white two-storey entry block with tall glazing and doors,
        # beside a one-storey glazed lounge with a white fascia and dark roof edge.
        e = longest
        tm = e["len"] / 2
        depth = min(4.0, max(0.0, r.get("frontClear", 40.0) - 2.0))
        if depth >= 2.0:
            lob = [(e["a"][0] + e["u"][0] * t + e["n"][0] * o, e["a"][1] + e["u"][1] * t + e["n"][1] * o)
                   for t, o in ((tm - 4.0, 0), (tm + 4.0, 0), (tm + 4.0, depth), (tm - 4.0, depth))]
            yh = min(2 * fh + 0.8, H - 0.5)
            fr = sub_edge(e, tm - 4.0, tm + 4.0, depth)
            wall_strip(B, WHITE(), fr, 0, yh)
            curtain_wall(B, sub_edge(e, tm - 2.0, tm + 2.0, depth + 0.05), 0, yh - 1.2, glass, FRAME(), bay=1.3, floor_h=(yh - 1.2) / 2)
            door_assembly(B, sub_edge(e, tm - 1.5, tm + 1.5, depth + 0.08), 1.5, 0.0, glass_mat("dark"), FRAME(), True)
            for ce in edges(ccw(lob)):
                if abs(ce["n"][0] * e["n"][0] + ce["n"][1] * e["n"][1]) < 0.5:
                    wall_strip(B, WHITE(), ce, 0, yh)
            polygon_cap(B, ROOF(), ccw(lob), yh)
            solid_ring(lob)
            lng = [(e["a"][0] + e["u"][0] * t + e["n"][0] * o, e["a"][1] + e["u"][1] * t + e["n"][1] * o)
                   for t, o in ((tm + 4.0, 0), (tm + 14.0, 0), (tm + 14.0, depth), (tm + 4.0, depth))]
            if tm + 14.0 < e["len"]:
                curtain_wall(B, sub_edge(e, tm + 4.0, tm + 14.0, depth), 0, fh * 0.9, glass, FRAME(), bay=1.6, floor_h=fh)
                side = sub_edge(e, tm + 14.0, tm + 14.0 + depth, 0)
                side = {"a": (e["a"][0] + e["u"][0] * (tm + 14.0), e["a"][1] + e["u"][1] * (tm + 14.0)),
                        "b": (e["a"][0] + e["u"][0] * (tm + 14.0) + e["n"][0] * depth, e["a"][1] + e["u"][1] * (tm + 14.0) + e["n"][1] * depth),
                        "len": depth, "u": e["n"], "n": e["u"], "s0": 0.0}
                curtain_wall(B, side, 0, fh * 0.9, glass, FRAME(), bay=1.6, floor_h=fh)
                slab_ring(B, ccw(lng), offset_ring(ccw(lng), 0.6), fh * 0.9, 0.6, WHITE())
                polygon_cap(B, ROOF(), ccw(lng), fh * 0.9 + 0.6)
                solid_ring(lng)
    if r.get("entryPavilion"):
        # ECS complex: a one-storey glazed entrance pavilion in front of the main face,
        # stone piers rising above its roof and two curved silver barrel canopies.
        e = longest
        tm = e["len"] / 2
        dep = min(6.0, max(0.0, r.get("frontClear", 40.0) - 3.0))
        if dep >= 3.0:
            st = wall_mat("limestone")
            yaw = math.atan2(-e["u"][1], e["u"][0])
            pw = 16.0
            pav = [(e["a"][0] + e["u"][0] * t + e["n"][0] * o, e["a"][1] + e["u"][1] * t + e["n"][1] * o)
                   for t, o in ((tm - pw / 2, 0), (tm + pw / 2, 0), (tm + pw / 2, dep), (tm - pw / 2, dep))]
            ph = fh + 0.6
            curtain_wall(B, sub_edge(e, tm - pw / 2, tm + pw / 2, dep), 0, ph, glass_mat("blue"), FRAME(), bay=1.4, floor_h=ph / 2)
            for ce in edges(ccw(pav)):
                if abs(ce["n"][0] * e["n"][0] + ce["n"][1] * e["n"][1]) < 0.5:
                    curtain_wall(B, ce, 0, ph, glass_mat("blue"), FRAME(), bay=1.4, floor_h=ph / 2)
            polygon_cap(B, ROOF(), ccw(pav), ph)
            solid_ring(pav)
            door_assembly(B, sub_edge(e, tm - 1.5, tm + 1.5, dep + 0.05), 1.5, 0.0, glass_mat("dark"), FRAME(), True)
            for t in (tm - pw / 2, tm - 2.6, tm + 2.6, tm + pw / 2):
                c = (e["a"][0] + e["u"][0] * t + e["n"][0] * (dep + 0.3), e["a"][1] + e["u"][1] * t + e["n"][1] * (dep + 0.3))
                B.box(st, W(c, (ph + 1.6) / 2), (1.3, ph + 1.6, 1.3), yaw)
                solid_post(c, 0.65)
            silver = mat("Metal_Drum", "b9bec2", 0.7, 0.35)
            for k, y in enumerate((ph - 0.2, ph + 0.9)):
                c = (e["a"][0] + e["u"][0] * tm + e["n"][0] * (dep + 0.9 - k * 0.6), e["a"][1] + e["u"][1] * tm + e["n"][1] * (dep + 0.9 - k * 0.6))
                # A half-cylinder on its side (curved front), 8 segments.
                rr, ln = 0.55, pw * (0.55 if k == 0 else 0.75)
                for j in range(8):
                    a0, a1 = -math.pi / 2 + math.pi * j / 8, -math.pi / 2 + math.pi * (j + 1) / 8
                    def q(a_, sd):
                        return W((c[0] + e["u"][0] * sd * ln / 2 + e["n"][0] * math.cos(a_) * rr, c[1] + e["u"][1] * sd * ln / 2 + e["n"][1] * math.cos(a_) * rr), y + math.sin(a_) * rr)
                    B.quad(silver, q(a0, -1), q(a0, 1), q(a1, 1), q(a1, -1))
    if r.get("endWalls") == "stone":
        for e in es:
            if e["len"] < longest["len"] * 0.45:
                wall_strip(B, wall, e, -0.5, H + 0.3, out=0.08)
    root = B.finish(spec["slug"])
    SOLIDS[spec["slug"]] = {"posts": CUR["posts"], "rings": CUR["rings"]}
    return root


specs = json.load(open(SPECS, encoding="utf-8"))["buildings"]
SOLIDS_PATH = os.path.join(OUTDIR, "solids.json")
SOLIDS = json.load(open(SOLIDS_PATH)) if os.path.exists(SOLIDS_PATH) else {}
done = []
for spec in specs:
    if ONLY and spec["slug"] != ONLY:
        continue
    root = build(spec)
    if root is None:
        continue
    bpy.ops.object.select_all(action="DESELECT")
    for o in [root] + list(root.children):
        o.select_set(True)
    out = os.path.join(OUTDIR, spec["slug"] + ".glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    done.append(spec["slug"])
    print("exported", out)
# The index lists every model in the folder, so rebuilding one building keeps the others.
index = sorted(f[:-4] for f in os.listdir(OUTDIR) if f.endswith(".glb"))
json.dump(index, open(os.path.join(OUTDIR, "index.json"), "w"))
json.dump({k: v for k, v in sorted(SOLIDS.items()) if (v["posts"] or v["rings"]) and k in index}, open(SOLIDS_PATH, "w"))
print("total", len(done))
