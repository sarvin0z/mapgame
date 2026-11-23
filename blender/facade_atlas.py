"""Original facade textures for the building generator.

Tiles are painted in sRGB, with a padded border for atlas filtering. The
geometry subdivides long surfaces at repeat boundaries, so there is no need
for a building-sized texture or a material per finish.
"""
import struct
import zlib
from pathlib import Path

import bpy
import numpy as np

GRID = 4
PADDING = 8


def fin_screen(tile, x, y):
    """Height and mask for three different zinc blade depths on a glazed bay."""
    count = tile.get("divisions", 10)
    column = (x * count).astype(int)
    u = x * count % 1
    depth = np.take([.8, 1, .43, .63, .82], column % 5)
    width = np.take([.24, .40, .24, .32, .36], column % 5)
    # Some blades stop short of the sill, just as on the long lab elevation.
    tip = np.take([.98, .88, .75, .97, .65], column % 5)
    vertical = ((y < tip) | (y > .935)) if tile.get("stagger", True) else np.ones_like(y, dtype=bool)
    bevel = np.clip(np.minimum(u - .13, .13 + width - u) * 28, 0, 1)
    height = depth * bevel * vertical
    return height, bevel > 0, vertical


def paint_normal(tile, color):
    size = color.shape[0]
    kind = tile.get("pattern")
    y, x = (np.indices((size, size), dtype=float) + .5) / size
    if kind == "finScreen":
        height, _, _ = fin_screen(tile, x, y)
    else:
        luminance = color.astype(float).mean(axis=2)
        height = (luminance - (np.roll(luminance, 1, 1) + np.roll(luminance, -1, 1)) * .5) / 75
    dy, dx = np.gradient(height)
    v = np.stack((-dx * 1.9, dy * 1.3, np.ones_like(height)), axis=-1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return np.rint((v * .5 + .5) * 255).astype(np.uint8)


def write_png(path, pixels):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    height, width, _ = pixels.shape
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    rows = b"".join(b"\0" + row.tobytes() for row in pixels)
    Path(path).write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    )


def label_image(image, tile):
    """Rasterize Blender's built-in lettering into one or more atlas regions."""
    size = image.shape[0]
    labels = tile["labels"]
    for i, label in enumerate(labels):
        font = bpy.data.curves.new("Atlas lettering", "FONT")
        font.body = label
        obj = bpy.data.objects.new("Atlas lettering", font)
        bpy.context.scene.collection.objects.link(obj)
        evaluated = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            points = np.array([(v.co.x, v.co.y) for v in mesh.vertices])
            low, high = points.min(axis=0), points.max(axis=0)
            # Leave a small background border so the sign reads as a shallow plaque.
            points = (points - low) / (high - low)
            first, last = i * size // len(labels), (i + 1) * size // len(labels)
            points[:, 0] = 5 + points[:, 0] * (size - 10)
            points[:, 1] = first + (1 - points[:, 1]) * (last - first - 10) + 5
            background = list(bytes.fromhex(tile.get("labelBackground", "484c4b")))
            foreground = list(bytes.fromhex(tile["color"]))
            mask = np.zeros((last - first, size), dtype=bool)
            for face in mesh.loop_triangles:
                a, b, c = points[list(face.vertices)]
                x0, y0 = np.floor(np.minimum(np.minimum(a, b), c)).astype(int)
                x1, y1 = np.ceil(np.maximum(np.maximum(a, b), c)).astype(int)
                if x0 == x1 or y0 == y1:
                    continue
                yy, xx = np.mgrid[y0:y1, x0:x1] + .5
                def edge(p, q):
                    return (xx - p[0]) * (q[1] - p[1]) - (yy - p[1]) * (q[0] - p[0])
                sides = np.array([edge(a, b), edge(b, c), edge(c, a)])
                inside = np.all(sides >= 0, axis=0) | np.all(sides <= 0, axis=0)
                mask[y0 - first:y1 - first, x0:x1] |= inside
            if tile.get("boldLabels"):
                padded = np.pad(mask, 1)
                mask = (mask | padded[:-2, 1:-1] | padded[2:, 1:-1] |
                        padded[1:-1, :-2] | padded[1:-1, 2:])
            image[first:last] = background
            image[first:last][mask] = foreground
        finally:
            evaluated.to_mesh_clear()
            bpy.data.objects.remove(obj, do_unlink=True)
            bpy.data.curves.remove(font)
    return image


def paint(tile, seed, size):
    rng = np.random.default_rng(seed)
    y, x = (np.indices((size, size), dtype=float) + 0.5) / size
    rgb = np.array(list(bytes.fromhex(tile["color"])), dtype=float)
    detail = rng.normal(0, 1.3, x.shape)
    kind = tile.get("pattern", "plain")
    if tile.get("labels"):
        return label_image(np.empty((size, size, 3), dtype=np.uint8), tile)

    if kind == "finScreen":
        height, blade, vertical = fin_screen(tile, x, y)
        glass = np.array(tile.get("glass", [36, 74, 106]))
        pane = (x * 4) % 1
        window = np.broadcast_to(glass, (*x.shape, 3)).copy()
        window += np.rint(15 * (.66 - y))[..., None].astype(int)
        window[(pane < .022) | (abs(y - .52) < .023) | (y < .035) | (y > .957)] = [55, 60, 64]
        u = (x * tile.get("divisions", 10)) % 1
        gray = rgb + (16 * height + 11 * (u < .20) - 14 * (u > .36) + detail)[..., None]
        return np.clip(np.where((blade & vertical)[..., None], gray, window), 0, 255).astype(np.uint8)
    if kind == "steelScales":
        columns, rows = tile.get("courses", [5, 12])
        row = (y * rows).astype(int)
        along = (x * columns + .5 * (row % 2)) % columns
        col = along.astype(int)
        shades = np.asarray(tile["tones"], dtype=float)
        field = .54 + .2 * np.sin(8 * x + 6 * y) + .16 * np.cos(13 * y - x * 5)
        choices = np.clip((field + rng.normal(0, .15, (rows, columns))[row, col]) * len(shades),
                          0, len(shades) - 1).astype(int)
        seam = y * rows % 1
        edge = .045 + .075 * (2 * (along % 1) - 1) ** 2
        lap = 16 * ((seam >= edge) & (seam < edge + .06)) - 28 * (seam < edge)
        lap -= 22 * (along % 1 < .035)
        return np.clip(shades[choices] + (detail + lap)[..., None], 0, 255).astype(np.uint8)
    if kind in ("stone", "brick"):
        columns, rows = tile.get("courses", [3, 8])
        row = np.floor(y * rows).astype(int)
        along = (x * columns + (row % 2) * 0.5) % columns
        block = along.astype(int)
        detail += rng.uniform(-9, 9, (rows, columns))[row, block]
        detail -= 25 * ((along % 1 < 0.017) | (y * rows % 1 < (0.036 if kind == "brick" else 0.012)))
        detail += 1.6 * np.sin((y * 70 + x * 3) * np.pi)
    elif kind in ("panels", "ribs", "timber", "zinc"):
        n = tile.get("divisions", 8)
        u = (x * n) % 1
        column = (x * n).astype(int)
        detail += rng.uniform(-8, 8, n)[column]
        detail -= (31 if kind != "panels" else 14) * (u < (0.20 if kind == "timber" else 0.025))
        if kind in ("ribs", "timber"):
            detail += 14 * np.cos(u * 2 * np.pi) + 5 * np.sin(u * 4 * np.pi)
        if kind == "zinc":
            density = 0.30 + 0.15 * np.sin(x * 16 + y * 10)
            dots = ((x * 62 - .5) % 1 - .5) ** 2 + ((y * 91 - .5) % 1 - .5) ** 2
            detail -= 19 * (dots < density ** 2)
            detail += 23 * (u < .07) - 10 * (u > .91)
        if kind == "panels":
            detail -= 17 * (y * tile.get("rows", 3) % 1 < 0.013)
    elif kind == "perforated":
        dots = ((x * 32) % 1 - .5) ** 2 + ((y * 32 + (x * 32).astype(int) % 2 * .5) % 1 - .5) ** 2
        detail -= 68 * (dots < 0.12)
        detail += 14 * ((x < .018) | (x > .982) | (y < .025) | (y > .975))
    elif kind == "fluted":
        # Vary the length and depth of individual cast reliefs across a panel.
        for i in range(148):
            cx, cy = rng.random(2)
            sx, sy = rng.uniform(.003, .010), rng.uniform(.016, .105)
            skew = rng.uniform(-.036, .036)
            u = (x - cx - skew * (y - cy)) / sx
            v = (y - cy) / sy
            mask = np.maximum(0, 1 - np.abs(u)) * (v * v < 1)
            detail += mask * (8 + u * 28) * np.maximum(0, 1 - v * v) ** .25
        detail -= 21 * ((x * 3 % 1 < .018) | (y < .007))
    elif kind == "punched":
        gap = tile.get("gap", .35)
        hole = (x > gap / 2) & (x < 1 - gap / 2) & (y > .025) & (y < .975)
        frame = ((x < gap / 2 + .025) | (x > 1 - gap / 2 - .025) | (y < .07) | (y > .94)
                 | (abs(x - .5) < .012) | (abs(y - .67) < .012))
        colors = np.broadcast_to(rgb, (*x.shape, 3)).copy() + detail[..., None]
        colors[hole] = (np.array(tile.get("glass", [62, 86, 97])) + (14 * (.64 - y))[..., None])[hole]
        colors[frame & hole] = tile.get("frame", [170, 171, 158])
        return np.clip(colors, 0, 255).astype(np.uint8)
    elif kind in ("glass", "doors"):
        n = tile.get("divisions", 2)
        u = (x * n) % 1
        detail += 33 * (0.71 - y) + rng.uniform(-12, 12, n)[(x * n).astype(int)]
        detail += 8 * np.exp(-((y - (0.48 + .25 * x)) / .16) ** 2)
        bars = (u < 0.022) | (u > .978) | (abs(y - .24) < .009) | (y < .014) | (y > .982)
        if kind == "doors":
            bars |= (abs(y - .69) < .013) | (abs(x - .5) < .016)
        colors = rgb + detail[..., None]
        colors[bars] = tile.get("frame", [50, 58, 61])
        if kind == "doors":
            colors[(abs(y - .70) < .013) & (abs(x - .5) < .13)] = [155, 155, 144]
        return np.clip(colors, 0, 255).astype(np.uint8)
    return np.clip(rgb + detail[..., None], 0, 255).astype(np.uint8)


MATERIAL_PROPERTIES = {"facade": (0, .83), "glass": (.55, .11), "glassWarm": (.24, .16),
                       "glassLobby": (.13, .13), "metal": (.46, .42), "roof": (0, .91)}
RELIEF_PATTERNS = {"finScreen", "fluted", "steelScales", "stone", "brick", "ribs", "timber", "zinc"}


class FacadeAtlas:
    def __init__(self, name, tiles, path, atlas_size=1024, detail=False):
        if not 0 < len(tiles) <= GRID ** 2:
            raise ValueError(f"{name}: atlas must have 1 to {GRID ** 2} tiles")
        size = atlas_size
        self.tile_size = tile_size = size // GRID
        usable = tile_size - 2 * PADDING
        data = np.zeros((size, size, 3), dtype=np.uint8)
        relief_patterns = RELIEF_PATTERNS if detail else {"finScreen"}
        has_relief = any(t.get("pattern") in relief_patterns for t in tiles.values())
        normal_data = np.empty_like(data) if has_relief else None
        orm_data = np.full_like(data, (255, 212, 0)) if detail else None
        if normal_data is not None:
            normal_data[:] = (128, 128, 255)
        normal_groups = set()
        self.tiles = {}
        materials = {}
        for i, (key, tile) in enumerate(tiles.items()):
            column, row = i % GRID, i // GRID
            x, y = column * tile_size, row * tile_size
            area = np.s_[y:y + tile_size, x:x + tile_size]
            padding = ((PADDING, PADDING), (PADDING, PADDING), (0, 0))
            color = paint(tile, i + 123, usable)
            data[area] = np.pad(color, padding, mode="edge")
            group = tile.get("material", "facade")
            if detail and group in {"metal", "roof"}:
                metal, rough = MATERIAL_PROPERTIES[group]
                group = "facade"
            else:
                metal, rough = MATERIAL_PROPERTIES[group]
            if detail and group == "facade":
                orm = np.full_like(color, (255, round(rough * 255), round(metal * 255)))
                variation = (color.astype(float).mean(axis=2) - color.mean()) * .35
                orm[..., 1] = np.clip(orm[..., 1] + variation, 10, 255).astype(np.uint8)
                orm_data[area] = np.pad(orm, padding, mode="edge")
            if tile.get("pattern") in relief_patterns:
                normal_data[area] = np.pad(paint_normal(tile, color), padding, mode="edge")
                normal_groups.add(group)
            self.tiles[key] = (column, row, group)
            materials[group] = None
        write_png(path, data)
        img = bpy.data.images.load(str(path), check_existing=False)
        img.name = name + "_atlas"
        img.pack()
        def data_image(label, data):
            data_path = path.with_name(label + ".png")
            write_png(data_path, data)
            result = bpy.data.images.load(str(data_path), check_existing=False)
            result.name = name + "_" + label
            result.colorspace_settings.name = "Non-Color"
            result.pack()
            return result

        normal_img = data_image("normal", normal_data) if has_relief else None
        orm_img = data_image("surface", orm_data) if detail else None
        self.materials = {}
        for group in materials:
            metal, rough = MATERIAL_PROPERTIES[group]
            mat = bpy.data.materials.new("CampusAtlas_" + group)
            mat.use_nodes = True
            nodes = mat.node_tree.nodes
            shader = nodes.get("Principled BSDF")
            shader.inputs["Metallic"].default_value = metal
            shader.inputs["Roughness"].default_value = rough
            tex = nodes.new("ShaderNodeTexImage")
            tex.image = img
            mat.node_tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
            if detail and group == "facade":
                surface = nodes.new("ShaderNodeTexImage")
                surface.image = orm_img
                channels = nodes.new("ShaderNodeSeparateColor")
                mat.node_tree.links.new(surface.outputs["Color"], channels.inputs["Color"])
                mat.node_tree.links.new(channels.outputs["Green"], shader.inputs["Roughness"])
                mat.node_tree.links.new(channels.outputs["Blue"], shader.inputs["Metallic"])
            if group == "glassWarm":
                shader.inputs["Emission Color"].default_value = (.65, .31, .106, 1)
                shader.inputs["Emission Strength"].default_value = .12
            elif group == "glassLobby":
                shader.inputs["Alpha"].default_value = .60
                mat.surface_render_method = "BLENDED"
            if group in normal_groups:
                normal_tex = nodes.new("ShaderNodeTexImage")
                normal_tex.image = normal_img
                normal = nodes.new("ShaderNodeNormalMap")
                normal.inputs["Strength"].default_value = .82
                mat.node_tree.links.new(normal_tex.outputs["Color"], normal.inputs["Color"])
                mat.node_tree.links.new(normal.outputs["Normal"], shader.inputs["Normal"])
            self.materials[group] = mat

    def material(self, key):
        return self.materials[self.tiles[key][2]]

    def uv(self, key, u, v):
        column, row, _ = self.tiles[key]
        usable = self.tile_size - 2 * PADDING - 1
        size = GRID * self.tile_size
        return ((column * self.tile_size + PADDING + .5 + u * usable) / size,
                1 - (row * self.tile_size + PADDING + .5 + (1 - v) * usable) / size)
