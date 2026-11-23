"""Geometry for facade-atlas recipes, with collision exported from the same parts."""
from array import array
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector, geometry

from facade_atlas import FacadeAtlas

CAMPUS_ENTRANCES = json.loads(
    (Path(__file__).resolve().parents[1] / "public" / "data" / "campus.json").read_text(encoding="utf-8")
)["entrances"]


class Site:
    """Sample the game's 2 m terrain triangles and use its ground-floor level."""

    def __init__(self, folder, ring):
        self.meta = json.loads((folder / "terrain.json").read_text())
        self.heights = array("h")
        self.heights.frombytes((folder / "terrain.bin").read_bytes())
        samples = []
        for a, b in zip(ring, ring[1:] + ring[:1]):
            n = max(1, math.ceil(math.dist(a, b) / 2))
            samples.extend(self.height(*(a[k] + (b[k] - a[k]) * i / n for k in range(2))) for i in range(n))
        self.base = min(max(samples), min(samples) + 1.2)

    def height(self, x, y):
        m = self.meta
        fx = min(m["nx"] - 1.0001, max(0, (x - m["x0"]) / m["step"]))
        fy = min(m["ny"] - 1.0001, max(0, (y - m["y0"]) / m["step"]))
        i, j = int(fx), int(fy)
        tx, ty = fx - i, fy - j
        stride = m["nx"]
        k = j * stride + i
        a, b, c, d = (self.heights[v] / 100 for v in (k, k + 1, k + stride, k + stride + 1))
        return a + ((b - a) * tx + (d - b) * ty if tx >= ty else (c - a) * ty + (d - c) * tx)


def signed_area(ring):
    return sum(a[0] * b[1] - a[1] * b[0] for a, b in zip(ring, ring[1:] + ring[:1])) / 2


def side(a, b):
    length = math.dist(a, b)
    x, y = ((b[k] - a[k]) / length for k in range(2))
    return length, (x, y), (y, -x)


def along(a, u, n, t, depth=0):
    return tuple(a[k] + u[k] * t + n[k] * depth for k in range(2))


class Model:
    def __init__(self, spec, builder, cap, work):
        self.spec = spec
        self.recipe = spec["recipe"]["atlasModel"]
        self.outline = spec["outer"]
        self.origin = tuple(sum(p[k] for p in self.outline) / len(self.outline) for k in range(2))
        self.site = Site(Path(__file__).resolve().parents[1] / "public" / "data", self.outline)
        self.mesh = builder
        self.cap = cap
        family = self.recipe.get("atlasFamily")
        tiles = self.recipe.get("tiles")
        if family:
            families_path = Path(__file__).resolve().parents[1] / "reconstruction" / "atlas_families.json"
            tiles = json.loads(families_path.read_text(encoding="utf8"))[family]
        self.tiles = tiles
        self.entrances = []
        self.atlas = FacadeAtlas(family or spec["slug"], tiles, work / "atlas.png",
                                 self.recipe.get("atlasSize", 1024), self.recipe.get("surfaceDetail", False))
        self.solids = {"replaceFootprint": not self.recipe.get("accessOnly", False), "posts": [],
                       "rings": [], "ringLevels": [], "volumes": [], "hulls": [], "paving": []}

    def ring(self, points):
        return [self.outline[p] if isinstance(p, int) else p for p in points]

    def ground(self, p):
        return self.site.height(*p) - self.site.base

    def local(self, p, z):
        return p[0] - self.origin[0], z, self.origin[1] - p[1]

    def horizontal(self, ring, z, tile, down=False, holes=()):
        ring = [(p[0] - self.origin[0], p[1] - self.origin[1]) for p in ring]
        if signed_area(ring) < 0:
            ring.reverse()
        holes = [[(p[0] - self.origin[0], p[1] - self.origin[1]) for p in h] for h in holes]
        holes = [list(reversed(h)) if signed_area(h) > 0 else h for h in holes]
        mat = self.atlas.material(tile)
        # Derive planar UVs from the cap bounds. Use the same material as the walls.
        min_x, min_y = (min(p[k] for p in ring) for k in range(2))
        dx, dy = (max(p[k] for p in ring) - m for k, m in enumerate((min_x, min_y)))
        self.cap(self.mesh, mat, ring, z, down=down, holes=holes,
                 atlas_uv=lambda x, y: self.atlas.uv(tile, (x - min_x) / dx, (y - min_y) / dy))

    def quad(self, tile, points, uv=((0, 0), (1, 0), (1, 1), (0, 1))):
        self.mesh.quad(self.atlas.material(tile), *(self.local(p, z) for p, z in points),
                       uvs=[self.atlas.uv(tile, u, v) for u, v in uv])

    def strip(self, a, b, y0, y1, tile, bay=0, upper=None, phase=None, frame=None):
        c, d = upper or (a, b)
        tiles = tile if isinstance(tile, list) else [tile]
        if phase is None:
            count = max(1, round(math.dist(a, b) / bay)) if bay else 1
            segments = [(i / count, (i + 1) / count, 0, 1) for i in range(count)]
        else:
            length = math.dist(a, b)
            segments = []
            pos = 0.0
            while pos < length - 1e-7:
                u0 = (phase + pos / bay) % 1
                if u0 > 1 - 1e-7:
                    u0 = 0
                end = min(length, pos + (1 - u0) * bay)
                segments.append((pos / length, end / length, u0, min(1, u0 + (end - pos) / bay)))
                pos = end
        def lerp(p, q, t):
            return tuple(p[k] + (q[k] - p[k]) * t for k in range(2))
        for i, (start, end, u0, u1) in enumerate(segments):
            points = [(lerp(a, b, start), y0), (lerp(a, b, end), y0),
                      (lerp(c, d, end), y1), (lerp(c, d, start), y1)]
            key = tiles[i % len(tiles)]
            info = self.tiles[key]
            if frame and info.get("pattern") == "punched" and u0 == 0 and u1 == 1:
                if math.dist(points[0][0], points[1][0]) > 1.25 and y1 - y0 > .65:
                    self.punched_window(key, points, info.get("gap", .35), frame["tile"], frame["size"][1])
                    continue
            self.quad(key, points, ((u0, 0), (u1, 0), (u1, 1), (u0, 1)))
            if frame and info.get("material", "").startswith("glass") and y1 - y0 > .55:
                divisions = info.get("divisions", 2)
                length, tangent, normal = side(a, b)
                width, depth = frame["size"]
                # Align projecting mullions with the divisions painted into the glazing tile.
                for column in range(divisions):
                    uvx = (column + .03) / divisions
                    if not u0 < uvx < u1:
                        continue
                    station = start + (end - start) * (uvx - u0) / (u1 - u0)
                    if station * length < .065:
                        continue
                    lower = along(lerp(a, b, station), (0, 0), normal, 0, depth * .36)
                    upper_at = along(lerp(c, d, station), (0, 0), normal, 0, depth * .36)
                    self.beam(lower, upper_at, y0 + .025, y1 - .025, width, depth, frame["tile"], across=tangent)
                if frame.get("transom") and y1 - y0 > 1.7:
                    fraction = frame["transom"]
                    z = y0 + (y1 - y0) * fraction
                    ends = [along(lerp(lerp(a, b, t), lerp(c, d, t), fraction),
                                  tangent, normal, 0, depth * .36) for t in (start, end)]
                    self.beam(*ends, z, z, depth, width, frame["tile"])

    def punched_window(self, tile, corners, gap, trim, depth):
        """Keep the painted masonry bay and sink the opening and its frame."""
        (a, z0), (b, _), (d, z1), (c, _) = corners
        _, _, outward = side(a, b)

        def point(u, v, recess=0):
            xy = tuple((1 - v) * (a[i] + (b[i] - a[i]) * u) +
                       v * (c[i] + (d[i] - c[i]) * u) - recess * outward[i] for i in range(2))
            return xy, z0 + (z1 - z0) * v

        left, right = gap / 2, 1 - gap / 2
        sill, head = .025, .975
        for u, v, U, V, recess in [
            (0, 0, left, 1, 0), (right, 0, 1, 1, 0),
            (left, 0, right, sill, 0), (left, head, right, 1, 0),
            (left, sill, right, head, depth),
        ]:
            uv = [(u, v), (U, v), (U, V), (u, V)]
            self.quad(tile, [point(x, y, recess) for x, y in uv], uv)
        ring = [(left, sill), (right, sill), (right, head), (left, head)]
        for p, q in zip(ring, ring[1:] + ring[:1]):
            self.quad(trim, [point(*q), point(*p), point(*p, depth), point(*q, depth)])

    def volume(self, config):
        bottom = self.ring(config.get("ring", self.outline))
        top = self.ring(config.get("topRing", bottom))
        z0, z1 = config["height"]
        cap = config.get("cap", "roof")
        holes = config.get("holes", [])
        if not config.get("openBottom"):
            self.horizontal(bottom, z0, config.get("soffit", cap), down=True, holes=holes)
        if not config.get("openTop"):
            self.horizontal(top, z1, cap, holes=holes)
        for hole in holes:
            ordered = hole if signed_area(hole) < 0 else list(reversed(hole))
            for a, b in zip(ordered, ordered[1:] + ordered[:1]):
                for lo, hi, tile, *options in config.get("courtBands", config["bands"]):
                    self.strip(a, b, lo, hi, tile, options[0] if options else 0)
        forward = signed_area(bottom) > 0
        profiles = {row["edge"]: row["segments"] for row in config.get("profiles", [])}
        overrides = {idx: row["bands"] for row in config.get("faces", []) for idx in row["edges"]}
        distances = [0.0]
        for a, b in zip(bottom, bottom[1:]):
            distances.append(distances[-1] + math.dist(a, b))
        for i in range(len(bottom)):
            j = (i + 1) % len(bottom)
            k, l = (i, j) if forward else (j, i)
            a, b, c, d = bottom[k], bottom[l], top[k], top[l]
            if math.dist(a, b) < .02:
                continue
            _, _, normal = side(a, b)
            if i in profiles:
                self.folded_wall(a, b, c, d, z0, z1, profiles[i], normal, forward)
                continue
            bands = overrides.get(i, config["bands"])
            for lo, hi, tile, *options in bands:
                lo, hi = max(z0, lo), min(z1, hi)
                if hi - lo < .003:
                    continue
                bay, inset, continuous = (options + [0, 0, False])[:3]
                def at(p, q, z, depth=0):
                    f = (z - z0) / (z1 - z0)
                    return tuple(p[m] + (q[m] - p[m]) * f - normal[m] * depth for m in range(2))
                lower = (at(a, c, lo, inset), at(b, d, lo, inset))
                upper = (at(a, c, hi, inset), at(b, d, hi, inset))
                phase = None
                if continuous:
                    distance = distances[i]
                    if not forward:
                        distance = distances[-1] - distance - math.dist(a, b)
                    phase = distance / bay
                frame = config.get("mullions", self.recipe.get("mullions")) if bay else None
                if frame and frame.get("edges") and i not in frame["edges"]:
                    frame = None
                self.strip(*lower, lo, hi, tile, bay, upper, phase, frame)
                if inset:
                    p0, q0, p1, q1 = at(a, c, lo), at(b, d, lo), at(a, c, hi), at(b, d, hi)
                    p2, q2 = lower
                    p3, q3 = upper
                    trim = config.get("reveal", cap)
                    for points in (
                        [(p0, lo), (q0, lo), (q2, lo), (p2, lo)],
                        [(p1, hi), (p3, hi), (q3, hi), (q1, hi)],
                        [(p0, lo), (p2, lo), (p3, hi), (p1, hi)],
                        [(q0, lo), (q1, hi), (q3, hi), (q2, lo)],
                    ):
                        self.quad(trim, points)
        if config.get("collision", True):
            if z0 <= 0 and not holes:
                self.solids["rings"].append(bottom)
                self.solids["ringLevels"].append([z0, z1])
            else:
                extra = {"ring": bottom, "height": [z0, z1]}
                if top != bottom:
                    extra["topRing"] = top
                if holes:
                    extra["holes"] = holes
                self.solids["volumes"].append(extra)

    def folded_wall(self, a, b, c, d, z0, z1, segments, normal, forward):
        """A diagonal faceted wall. Each joint gives its bottom/top station and inset."""
        if not forward:
            segments = [[tile, [1 - q[0], 1 - q[1], q[2]], [1 - p[0], 1 - p[1], p[2]]]
                        for tile, p, q in reversed(segments)]
        def vertex(p, q, f, inset):
            return tuple(p[k] + f * (q[k] - p[k]) - inset * normal[k] for k in range(2))
        for tile, p, q in segments:
            low = [vertex(a, b, f[0], f[2]) for f in (p, q)]
            high = [vertex(c, d, f[1], f[2]) for f in (p, q)]
            self.strip(*low, z0, z1, tile, upper=high)

    def shell(self, cfg):
        """Bent roof and soffit profiles. Collision uses the same planar envelope."""
        low = [(p[:2], p[2]) for p in cfg["bottom"]]
        high = [(p[:2], p[2]) for p in cfg["top"]]
        forward = signed_area([p for p, _ in low]) > 0
        indices = []
        verts = []

        def face(tile, points, render=True):
            start = len(verts)
            verts.extend([*p, h] for p, h in points)
            indices.extend((start, start + i, start + i + 1) for i in range(1, len(points) - 1))
            if render:
                uv = ((0, 0), (1, 0), (1, 1)) if len(points) == 3 else ((0, 0), (1, 0), (1, 1), (0, 1))
                self.mesh.face(self.atlas.material(tile), [self.local(p, h) for p, h in points],
                               [self.atlas.uv(tile, *pos) for pos in uv])

        for loop, tile, up in ((low, cfg["soffit"], False), (high, cfg["roof"], True)):
            coords = [Vector((*p, 0)) for p, _ in loop]
            xs, ys = zip(*(p for p, _ in loop))
            roof_triangles = [[loop[i] for i in tri] for tri in geometry.tessellate_polygon([coords])]
            for x, y, height in cfg.get("ridgePoints", []) if up else []:
                for index, (p, q, r) in enumerate(roof_triangles):
                    signs = [signed_area([a[0], b[0], (x, y)]) for a, b in ((p, q), (q, r), (r, p))]
                    if min(signs) > .001 or max(signs) < -.001:
                        peak = ((x, y), height)
                        roof_triangles[index:index+1] = [[p, q, peak], [q, r, peak], [r, p, peak]]
                        break
            for pts in roof_triangles:
                if (signed_area([p for p, _ in pts]) > 0) != up:
                    pts.reverse()
                face(tile, pts, render=False)
                uvs = [self.atlas.uv(tile, (p[0] - min(xs)) / (max(xs) - min(xs)),
                                    (p[1] - min(ys)) / (max(ys) - min(ys))) for p, _ in pts]
                self.mesh.face(self.atlas.material(tile), [self.local(p, h) for p, h in pts], uvs)

        faces = {x["edge"]: x for x in cfg.get("faces", [])}
        for idx in range(len(low)):
            j = (idx + 1) % len(low)
            k, l = (idx, j) if forward else (j, idx)
            a, b, c, d = low[k], low[l], high[k], high[l]
            face(cfg["wall"], [a, b, d, c], render=False)
            length, tangent, normal = side(a[0], b[0])

            def sample(t, z, inset=0):
                low_point = tuple(a[0][i] + (b[0][i] - a[0][i]) * t for i in range(2))
                high_point = tuple(c[0][i] + (d[0][i] - c[0][i]) * t for i in range(2))
                h0 = a[1] + (b[1] - a[1]) * t
                h1 = c[1] + (d[1] - c[1]) * t
                return (tuple(low_point[i] + (high_point[i] - low_point[i]) * z - inset * normal[i] for i in range(2)),
                        h0 + (h1 - h0) * z)

            info = faces.get(idx, {})
            if "edgeFascia" in cfg:
                depth, height, tile = cfg["edgeFascia"]
                # A slim nose follows the changing soffit height across the fold.
                def fascia(point, raise_by, out):
                    p, z = point
                    return along(p, tangent, normal, 0, out), z + raise_by
                self.quad(tile, [fascia(a, -.015, depth), fascia(b, -.015, depth),
                                 fascia(b, height, depth), fascia(a, height, depth)])
                self.quad(tile, [fascia(b, height, depth), fascia(a, height, depth),
                                 fascia(a, height, -.035), fascia(b, height, -.035)])
                self.quad(tile, [fascia(a, -.015, depth), fascia(b, -.015, depth),
                                 fascia(b, -.015, -.035), fascia(a, -.015, -.035)])

            def skin(tile, corners, width):
                self.quad(tile, corners)
                if tile == cfg["wall"] and "relief" in cfg and width > 1:
                    self.panel_relief(tile, corners, normal, width, cfg["relief"])

            if "slot" in info:
                # Inset diaphragm with continuous sill and head flashing.
                cut = info["slot"]
                y0, y1, reveal = cut["bottom"], cut["top"], cut["depth"]
                rows = ((0, y0, cfg["wall"]), (y0, y1, cut["tile"]), (y1, 1, cfg["wall"]))
                for lo, hi, tile in rows:
                    inset = reveal if tile == cut["tile"] else 0
                    count = max(1, round(length / (3.0 if inset else 5.5)))
                    for n in range(count):
                        u, v = n / count, (n + 1) / count
                        skin(tile, [sample(u, lo, inset), sample(v, lo, inset),
                                    sample(v, hi, inset), sample(u, hi, inset)], length / count)
                edge = cut.get("trim", cfg["wall"])
                self.quad(edge, [sample(0, y0), sample(1, y0), sample(1, y0, reveal), sample(0, y0, reveal)])
                self.quad(edge, [sample(1, y1), sample(0, y1), sample(0, y1, reveal), sample(1, y1, reveal)])
                self.quad(edge, [sample(0, y1), sample(0, y0), sample(0, y0, reveal), sample(0, y1, reveal)])
                self.quad(edge, [sample(1, y0), sample(1, y1), sample(1, y1, reveal), sample(1, y0, reveal)])
                if "mullion" in cut:
                    mullion = cut["mullion"]
                    count = max(1, round(length / 1.5))
                    for i in range(1, count):
                        at = i / count
                        lo, z0 = sample(at, y0, reveal - .025)
                        hi, z1 = sample(at, y1, reveal - .025)
                        self.beam(lo, hi, z0, z1, mullion["width"], mullion["depth"], mullion["tile"], across=tangent)
                    for t in cut.get("transoms", []):
                        v = y0 + (y1 - y0) * t
                        p, z0 = sample(.018, v, reveal - .055)
                        q, z1 = sample(.982, v, reveal - .055)
                        self.beam(p, q, z0, z1, .13, .08, mullion["tile"])
            elif "cuts" in info:
                sections = info["cuts"]
                if not forward:
                    sections = [[tile, 1 - u, 1 - v, 1 - r, 1 - s] for tile, v, u, s, r in reversed(sections)]
                for tile, bot0, bot1, top0, top1 in sections:
                    count = max(1, round(length * (bot1 - bot0 + top1 - top0) / 13))
                    for n in range(count):
                        f, g = n / count, (n + 1) / count
                        skin(tile, [sample(bot0 + (bot1 - bot0) * f, 0), sample(bot0 + (bot1 - bot0) * g, 0),
                                    sample(top0 + (top1 - top0) * g, 1), sample(top0 + (top1 - top0) * f, 1)],
                             length * (bot1 - bot0 + top1 - top0) / (2 * count))
            else:
                count = max(1, round(length / 5.5))
                for i in range(count):
                    u, v = i / count, (i + 1) / count
                    skin(cfg["wall"], [sample(u, 0), sample(v, 0), sample(v, 1), sample(u, 1)], length / count)
        self.solids.setdefault("shells", []).append({"vertices": verts, "triangles": indices})

    def panel_relief(self, tile, corners, normal, width, projection):
        """Cast shallow staggered reliefs into selected precast elevations."""
        a, b, c, d = corners
        height = ((c[1] - b[1]) + (d[1] - a[1])) / 2
        if height < .9:
            return
        columns, rows = max(1, round(width / .64)), max(2, round(height / 1.3))

        def at(u, v, depth):
            p = tuple((a[0][i] * (1 - u) + b[0][i] * u) * (1 - v) +
                      (d[0][i] * (1 - u) + c[0][i] * u) * v + depth * normal[i] for i in range(2))
            return p, (a[1] * (1 - u) + b[1] * u) * (1 - v) + (d[1] * (1 - u) + c[1] * u) * v

        for col in range(columns):
            for row in range(rows):
                code = (col * 71 + row * 31 + round(a[0][0] * 19)) % 13
                if code < 5:
                    continue
                u = (col + .28 + (code % 4) * .13) / columns
                v = (row + .17) / rows
                w, h = .024 / width, (.29 + (code % 5) * .1) / height
                # The narrow sloping fin meets the panel behind its silhouette.
                lo, hi = v + .05 / height, min(.985, v + h)
                left, right = at(u - w, lo, -.012), at(u + w, lo, -.012)
                apex, top = at(u, lo, projection), at(u, hi, .014)
                upper_left, upper_right = at(u - w, hi, -.012), at(u + w, hi, -.012)
                self.quad(tile, [left, apex, top, upper_left], ((u-w, lo),(u, lo),(u, hi),(u-w, hi)))
                self.quad(tile, [apex, right, upper_right, top], ((u, lo),(u+w, lo),(u+w, hi),(u, hi)))
                for pts in ([right, apex, left], [upper_left, top, upper_right]):
                    self.mesh.face(self.atlas.material(tile), [self.local(p, z) for p, z in pts],
                                   [self.atlas.uv(tile, u, v)] * 3)

    def beam(self, a, b, za, zb, width, depth, tile, collide=False, across=None, taper=None, chamfer=0):
        start, end = Vector(self.local(a, za)), Vector(self.local(b, zb))
        axis = (end - start).normalized()
        u = Vector((across[0], 0, -across[1])) if across is not None else axis.cross(Vector((0, 1, 0)))
        if u.length < .001:
            u = Vector((1, 0, 0))
        u.normalize()
        v = u.cross(axis)
        section = ((-1, -1), (1, -1), (1, 1), (-1, 1))
        if chamfer:
            d = 1 - chamfer
            section = ((-d,-1),(d,-1),(1,-d),(1,d),(d,1),(-d,1),(-1,d),(-1,-d))
        count = len(section)
        points = [center + u * x * w / 2 + v * y * d / 2
                  for center, (w,d) in ((start,(width,depth)), (end,taper or (width,depth)))
                  for x, y in section]
        uv = [self.atlas.uv(tile, x, y) for x, y in ((0, 0), (1, 0), (1, 1), (0, 1))]
        for indices in [range(count - 1, -1, -1), range(count, 2 * count)]:
            self.mesh.face(self.atlas.material(tile), [points[i] for i in indices],
                           [self.atlas.uv(tile, (section[i % count][0]+1)/2, (section[i % count][1]+1)/2)
                            for i in indices])
        for i in range(count):
            j = (i + 1) % count
            self.mesh.quad(self.atlas.material(tile), points[i], points[j],
                           points[j + count], points[i + count], uvs=uv)
        if collide:
            self.solids["hulls"].append([[round(p.x + self.origin[0], 3), round(p.y, 3),
                                          round(self.origin[1] - p.z, 3)] for p in points])

    def post(self, point, top, radius, tile, sides=14):
        base = min(self.ground(point) - .07, -.07)
        ring = [(point[0] + radius * math.cos(i * math.tau / sides), point[1] + radius * math.sin(i * math.tau / sides))
                for i in range(sides)]
        self.volume({"ring": ring, "height": [base, top], "bands": [[base, top, tile]],
                     "cap": tile, "collision": False})
        self.solids["posts"].append([*point, radius])
        self.solids.setdefault("postLevels", []).append([base, top])

    def access(self, cfg):
        p = cfg["point"]
        target = cfg.get("finish", 0.05)
        if "normal" in cfg:
            normal = cfg["normal"]
        else:
            _, _, normal = side(*self.ring(cfg["edge"]))
        tangent = (-normal[1], normal[0])
        width, run = cfg["width"], cfg["run"]
        def pair(t):
            return [along(p, tangent, normal, sign * width / 2, t) for sign in (-1, 1)]
        far = pair(run)
        grade = [self.ground(q) + .04 for q in far]
        tile = cfg.get("tile", "concrete")
        if cfg.get("stairs"):
            start = sum(grade) / 2
            count = max(1, math.ceil(abs(target - start) / .16))
            for i in range(count):
                a, b = pair(run * i / count)
                c, d = pair(run * (i + 1) / count)
                top = target + (start - target) * i / count
                base = min(top - .18, self.ground(a) - .05, self.ground(b) - .05,
                           self.ground(c) - .05, self.ground(d) - .05)
                self.volume({"ring": [a, b, d, c], "height": [base, top], "cap": tile,
                             "bands": [[base, top, tile]]})
        else:
            a, b = pair(0)
            c, d = far
            if signed_area([a, b, d, c]) < 0:
                a, b, c, d = b, a, d, c
                grade.reverse()
            surface = [(a, target), (b, target), (d, grade[1]), (c, grade[0])]
            lowest = min(z for _, z in surface) - .17
            self.quad(tile, surface)
            for (q, z), (r, h) in zip(surface, surface[1:] + surface[:1]):
                self.quad(tile, [(q, lowest), (r, lowest), (r, h), (q, z)])
            self.solids["paving"].append([[*q, z] for q, z in surface])

    def flight(self, cfg):
        start, end = cfg["start"], cfg["end"]
        length, u, n = side(start, end)
        width, top = cfg["width"], cfg["top"]
        base = self.ground(start) - .08
        count = max(2, math.ceil((top - base) / .175))
        spacing = length / count
        tile = cfg["tile"]
        for i in range(count):
            z = base + (top - base) * (i + 1) / count
            a = along(start, u, n, i * spacing)
            b = along(start, u, n, (i + 1) * spacing + .028)
            self.beam(a, b, z - .065, z - .065, width, .13, tile, collide=True)
        for sign in (-1, 1):
            a = along(start, u, n, 0, sign * (width - .09) / 2)
            b = along(end, u, n, 0, sign * (width - .09) / 2)
            self.beam(a, b, base, top - .13, .13, .28, tile, collide=True)
            rail = cfg["rail"]
            self.beam(a, b, base + 1.02, top + 1.02, .065, .065, rail, collide=True)
            for i in range(6):
                f = i / 5
                p = along(a, u, n, length * f)
                z = base + (top - base) * f
                self.beam(p, p, z, z + 1.02, .045, .045, rail, collide=True)

    def sign(self, cfg):
        if "lettering" in cfg:
            self.lettering(cfg)
            return
        label, tile = cfg["text"], cfg["tile"]
        labels = self.tiles[tile]["labels"]
        row = labels.index(label)
        size = cfg["size"]
        width = cfg.get("width", size * .49 * len(label))
        normal = Vector(cfg["normal"]).normalized()
        tangent = Vector((-normal.y, normal.x))
        center = Vector(cfg["point"])
        v0, v1 = 1 - (row + 1) / len(labels), 1 - row / len(labels)
        if "followVolume" not in cfg:
            a, b = tuple(center - tangent * width / 2), tuple(center + tangent * width / 2)
            lower, upper = cfg["height"] - .055, cfg["height"] + size * .72
            self.quad(tile, [(a, lower), (b, lower), (b, upper), (a, upper)],
                      ((0, v0), (1, v0), (1, v1), (0, v1)))
            return

        # Clip a continuous inscription onto the front-facing facets of a curved wall.
        volume = self.recipe["volumes"][cfg["followVolume"]]
        ring = self.ring(volume.get("ring", self.outline))
        if signed_area(ring) < 0:
            ring.reverse()
        lower, upper = cfg["height"], cfg["height"] + size
        for a, b in zip(ring, ring[1:] + ring[:1]):
            a, b = Vector(a), Vector(b)
            delta = b - a
            if delta.length < .02 or Vector((delta.y, -delta.x)).normalized().dot(normal) < .45:
                continue
            if ((a + b) / 2 - center).dot(normal) < -3:
                continue
            u0 = (a - center).dot(tangent) / width + .5
            u1 = (b - center).dot(tangent) / width + .5
            lo, hi = max(0, u0), min(1, u1)
            if hi <= lo:
                continue
            p, q = [tuple(a + delta * ((u - u0) / (u1 - u0)) + normal * .045) for u in (lo, hi)]
            self.quad(tile, [(p, lower), (q, lower), (q, upper), (p, upper)],
                      ((lo, v0), (hi, v0), (hi, v1), (lo, v1)))

    def lettering(self, cfg):
        """Combine filled glyphs and an optional outlined word with the facade batch."""
        normal = Vector(cfg["normal"]).normalized()
        tangent = Vector((-normal.y, normal.x))
        center = Vector(cfg["point"])
        baseline, height = cfg["height"], cfg["size"]

        def point(x, y, depth=0):
            return tuple(center + tangent * x + normal * depth), baseline + y

        for part in cfg["lettering"]:
            left, right = part["span"]
            if box := part.get("box"):
                pad, stroke = .085, .038
                for x0, y0, x1, y1 in (
                    (left-pad, -pad, right+pad, -pad+stroke),
                    (left-pad, height+pad-stroke, right+pad, height+pad),
                    (left-pad, -pad+stroke, left-pad+stroke, height+pad-stroke),
                    (right+pad-stroke, -pad+stroke, right+pad, height+pad-stroke),
                ):
                    self.quad(box, [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)])
            font = bpy.data.curves.new("Facade lettering", "FONT")
            font.body = part["text"]
            font.offset = .025
            obj = bpy.data.objects.new("Facade lettering", font)
            bpy.context.scene.collection.objects.link(obj)
            evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
            mesh = evaluated.to_mesh()
            try:
                mesh.calc_loop_triangles()
                xs = [v.co.x for v in mesh.vertices]
                ys = [v.co.y for v in mesh.vertices]
                x_min, y_min = min(xs), min(ys)
                sx, sy = (right-left)/(max(xs)-x_min), height/(max(ys)-y_min)
                vertices = [self.local(*point(left + (x-x_min)*sx, (y-y_min)*sy)) for x, y in zip(xs, ys)]
                tile = part.get("tile", cfg["tile"])
                uv = self.atlas.uv(tile, .5, .5)
                material = self.atlas.material(tile)
                for face in mesh.loop_triangles:
                    indices = face.vertices if face.normal.z > 0 else reversed(face.vertices)
                    self.mesh.face(material, [vertices[i] for i in indices], [uv] * 3)
            finally:
                evaluated.to_mesh_clear()
                bpy.data.objects.remove(obj, do_unlink=True)
                bpy.data.curves.remove(font)

    def storefront(self, panel):
        """Glazed double doors with sidelights and a continuous head frame."""
        a, b = panel["points"]
        width, u, n = side(a, b)
        sill, head = panel["height"]
        if not panel.get("fixedSill"):
            sill = max(self.ground(a), self.ground(b)) + .035
            head += sill
        rail = min(head - .22, sill + panel.get("leafHeight", 2.3))
        frame = panel["frame"]
        self.strip(a, b, sill, head, panel["glass"])

        def point(x, depth):
            return along(a, u, n, x, depth)

        def horizontal(z, thickness, tile, start=0, end=width, depth=.042, projection=.09):
            self.beam(point(start, depth), point(end, depth), z, z, projection, thickness, tile)

        leaf = min(panel.get("leafWidth", 1.0), width / 2 - .12)
        center = width / 2
        for x, top, size in ((0, head, .095), (width, head, .095),
                             (center - leaf, head, .075), (center + leaf, head, .075), (center, rail, .065)):
            p = point(x, .042)
            self.beam(p, p, sill, top, size, .09, frame, across=u)
        for z in (sill + .055, rail, head):
            horizontal(z, .09, frame)
        for start, end in ((center - leaf + .12, center - .09), (center + .09, center + leaf - .12)):
            horizontal(sill + 1.06, .038, panel.get("handle", frame), start, end, .11, .065)
        if portal := panel.get("portal"):
            depth, thickness, tile = portal
            horizontal(head + thickness / 2, thickness, tile, -thickness, width + thickness,
                       depth / 2, depth)
            for x in (-thickness / 2, width + thickness / 2):
                p = point(x, depth / 2)
                self.beam(p, p, sill, head, thickness, depth, tile, across=u, collide=True)
        self.entrances.append(point(center, 0))

    def door(self, panel):
        a, b = panel["points"]
        center = tuple((a[i] + b[i]) / 2 for i in range(2))
        sill, head = panel["height"]
        access = min(self.recipe.get("access", []),
                     key=lambda row: math.dist(center, row["point"]), default=None)
        if not panel.get("fixedSill"):
            if access and math.dist(center, access["point"]) < 1.05:
                sill = access.get("finish", .05) + .018
            else:
                sill = max(self.ground(a), self.ground(b)) + .045
            head = sill + min(2.42, head - panel["height"][0])
        self.strip(a, b, sill, head, panel["tile"], panel.get("bay", 0))
        self.entrances.append(center)

    def mapped_doors(self):
        door = next((key for key, tile in self.tiles.items() if tile.get("pattern") == "doors"), None)
        if door is None or self.recipe.get("accessOnly") or self.recipe.get("skipMappedDoors"):
            return
        main = next((row for row in self.recipe["volumes"] if row["height"][0] < .1 and
                     len(row.get("ring", self.outline)) >= 5), None)
        if not main:
            return
        ring = self.ring(main.get("ring", self.outline))
        if signed_area(ring) < 0:
            ring.reverse()
        for x, y, kind, _ in CAMPUS_ENTRANCES:
            p = (x, y)
            if kind not in {"main", "yes", "secondary", "service"} or any(math.dist(p, q) < 1.4 for q in self.entrances):
                continue
            candidates = []
            for a, b in zip(ring, ring[1:] + ring[:1]):
                length, tangent, normal = side(a, b) if a != b else (0, None, None)
                if length < .035:
                    continue
                t = (x - a[0]) * tangent[0] + (y - a[1]) * tangent[1]
                q = along(a, tangent, normal, min(length, max(0, t)))
                candidates.append((math.dist(p, q), a, tangent, normal, length, t))
            if not candidates:
                continue
            distance, a, tangent, normal, length, t = min(candidates, key=lambda r: r[0])
            if distance > .23:
                continue
            # A mapped entrance can coincide with a collinear OSM outline vertex.
            # Test both ends against the facade rather than dropping those doors.
            half = .89 if kind == "main" else .62
            points = [along(a, tangent, normal, t + shift, .055) for shift in (-half, half)]
            if any(min(self.segment_distance(q, c, d) for c, d in zip(ring, ring[1:] + ring[:1])) > .13
                   for q in points):
                continue
            self.door({"points": points, "height": [0, 2.38], "tile": door})

    def grade_paving(self, patch):
        ring = self.ring(patch["ring"])
        tile = patch["tile"]
        if signed_area(ring) < 0:
            ring.reverse()
        xs, ys = zip(*ring)
        x0, y0 = min(xs), min(ys)
        width, depth = max(xs) - x0, max(ys) - y0
        vertices, triangles = [], []

        def surface(points):
            if max(math.dist(a, b) for a, b in zip(points, points[1:] + points[:1])) > 2.1:
                a, b, c = points
                p, q, r = [tuple((x[i] + y[i]) / 2 for i in range(2)) for x, y in [(a, b), (b, c), (c, a)]]
                for triangle in ([a, p, r], [p, b, q], [r, q, c], [p, q, r]):
                    surface(triangle)
                return
            levels = [(x, y, self.ground((x, y)) + .055) for x, y in points]
            self.mesh.face(self.atlas.material(tile), [self.local((x, y), z) for x, y, z in levels],
                           [self.atlas.uv(tile, (x-x0)/width, (y-y0)/depth) for x, y, _ in levels])
            start = len(vertices)
            vertices.extend(levels)
            triangles.append([start, start + 1, start + 2])

        for indices in geometry.tessellate_polygon([[Vector((*p, 0)) for p in ring]]):
            triangle = [ring[i] for i in indices]
            surface(triangle if signed_area(triangle) > 0 else triangle[::-1])
        self.solids.setdefault("shells", []).append({"vertices": vertices, "triangles": triangles})

    @staticmethod
    def segment_distance(p, a, b):
        d = (b[0] - a[0], b[1] - a[1])
        length2 = d[0] ** 2 + d[1] ** 2
        if not length2:
            return math.dist(p, a)
        t = min(1, max(0, sum((p[i] - a[i]) * d[i] for i in range(2)) / length2))
        return math.dist(p, (a[0] + t * d[0], a[1] + t * d[1]))

    def build(self):
        for volume in self.recipe["volumes"]:
            self.volume(volume)
        for shell in self.recipe.get("shells", []):
            self.shell(shell)
        for post in self.recipe.get("posts", []):
            self.post(*post)
        for cfg in self.recipe.get("beams", []):
            a, b = cfg["points"]
            za, zb = cfg["height"]
            if za == "terrain":
                za = self.ground(a) - .15
            elif za == "paving":
                za = max(.01, self.ground(a) - .075)
            self.beam(a, b, za, zb, *cfg["size"], cfg["tile"], cfg.get("collision", False),
                      taper=cfg.get("taper"), chamfer=cfg.get("chamfer", 0))
        for pad in self.recipe.get("footings", []):
            x, y = pad["point"]
            w, d = (size / 2 for size in pad["size"])
            ring = [(x-w,y-d),(x+w,y-d),(x+w,y+d),(x-w,y+d)]
            g = self.ground((x,y))
            z0, z1 = g - .36, g + pad["reveal"]
            self.volume({"ring":ring,"height":[z0,z1],"bands":[[z0,z1,pad["tile"]]],"cap":pad["tile"]})
        for panel in self.recipe.get("panels", []):
            if "glass" in panel:
                self.storefront(panel)
            elif self.tiles[panel["tile"]].get("pattern") == "doors":
                self.door(panel)
            else:
                self.strip(*panel["points"], *panel["height"], panel["tile"], panel.get("bay", 0))
        self.mapped_doors()
        for cfg in self.recipe.get("access", []):
            self.access(cfg)
        for cfg in self.recipe.get("flights", []):
            self.flight(cfg)
        for cfg in self.recipe.get("signs", []):
            self.sign(cfg)
        for pts in self.recipe.get("paving", []):
            self.solids["paving"].append([[*p, .02] for p in self.ring(pts)])
        for patch in self.recipe.get("gradePaving", []):
            self.grade_paving(patch)
        return self.mesh.finish(self.spec["slug"], recalc=False), self.solids
