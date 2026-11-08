"""Parked-car models for the campus lots: sedan, SUV and pickup, exported to
public/models/cars.glb. Generic shapes with typical US dimensions; the body
paint is recoloured per car in the game (material `Paint`).

Run headless:
  blender -b --factory-startup --python blender/build_cars.py -- public/models/cars.glb [preview.png]

Car frame: x = left, y = up, z = forward, ground at y = 0. Each car is a root
empty named Sedan / SUV / Pickup with its parts as children.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "cars.glb"
PREVIEW = argv[1] if len(argv) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def P(x, y, z):
    return Vector((x, -z, y))


MATS = {}


def mat(name, color, metal=0.0, rough=0.5, alpha=1.0, emit=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 0.3
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
    MATS[name] = m


mat("Paint", (0.8, 0.8, 0.8), metal=0.5, rough=0.25)
mat("CarGlass", (0.03, 0.04, 0.05), metal=0.2, rough=0.05)
mat("Trim", (0.02, 0.02, 0.02), rough=0.6)
mat("CarTire", (0.015, 0.015, 0.015), rough=0.9)
mat("Hubcap", (0.6, 0.62, 0.64), metal=0.9, rough=0.3)
mat("HeadLamp", (0.9, 0.9, 0.85), rough=0.1, emit=(0.2, 0.2, 0.2))
mat("TailLamp", (0.5, 0.02, 0.02), rough=0.2)
mat("Plate", (0.85, 0.85, 0.8), rough=0.4)


def rounded_rect(w, y0, y1, r, n=4):
    r = min(r, w / 2 - 1e-3, (y1 - y0) / 2 - 1e-3)
    corners = [(w / 2 - r, y0 + r, -90), (w / 2 - r, y1 - r, 0), (-w / 2 + r, y1 - r, 90), (-w / 2 + r, y0 + r, 180)]
    out = []
    for cx, cy, start in corners:
        for k in range(n + 1):
            t = math.radians(start + 90 * k / n)
            out.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return out


def smooth(profiles, k=1):
    """Inserts k interpolated stations between neighbours (Catmull-Rom), for rounder noses and tails."""
    if len(profiles) < 3:
        return profiles
    out = []
    n = len(profiles)
    for i in range(n - 1):
        p0, p1, p2, p3 = profiles[max(0, i - 1)], profiles[i], profiles[i + 1], profiles[min(n - 1, i + 2)]
        for j in range(k + 1):
            t = j / (k + 1)
            out.append(tuple(0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t ** 3)
                             for a, b, c, d in zip(p0, p1, p2, p3)))
    out.append(profiles[-1])
    return out


def loft(name, parent, profiles, material, cap=True):
    """profiles: (z, width, y0, y1, radius) from front to back."""
    rings = [[P(x, y, z) for x, y in rounded_rect(w, y0, y1, r)] for z, w, y0, y1, r in profiles]
    n = len(rings[0])
    verts = [v for ring in rings for v in ring]
    faces = []
    for i in range(len(rings) - 1):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap:
        faces.append(tuple(reversed(range(n))))
        last = len(rings) - 1
        faces.append(tuple(last * n + k for k in range(n)))
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(MATS[material])
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o.parent = parent
    return o


def wheel(parent, x, z, r, w):
    side = 1 if x > 0 else -1
    # Two parts per wheel (tyre, rim face) at 14 sides: parked cars are instanced by the thousand.
    for nm, rad, d, m in (("Tire", r, w, "CarTire"), ("Rim", r * 0.6, w + 0.03, "Hubcap")):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=rad, radius2=rad, depth=d)
        me = bpy.data.meshes.new(nm)
        bm.to_mesh(me)
        bm.free()
        for p in me.polygons:
            p.use_smooth = True
        me.materials.append(MATS[m])
        o = bpy.data.objects.new(nm, me)
        scene.collection.objects.link(o)
        o.parent = parent
        o.location = P(x, r, z)
        o.rotation_euler = (0, math.pi / 2, 0)
    # Five spokes on the outer face, over a dark barrel (the Hub disc).
    for k in range(5):
        a = k * 2 * math.pi / 5
        sp = box(parent, "Spoke", (0.03, r * 0.5, 0.075), (x + side * (w / 2 + 0.02), r + math.cos(a) * r * 0.3, z + math.sin(a) * r * 0.3), "Hubcap")
        sp.rotation_euler = (a, 0, 0)


def box(parent, name, size, center, material):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(size[0], size[2], size[1]), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(MATS[material])
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o.parent = parent
    o.location = P(*center)
    return o


def car(name, L, W, body, cabin, wheelbase, r, x_off=0.0, bed=None):
    root = bpy.data.objects.new(name, None)
    scene.collection.objects.link(root)
    root.location = (x_off, 0, 0)
    h = L / 2
    # Body sills sit above the wheel centers so the tires show below them.
    body = smooth(body)
    loft("Body", root, [(z * h, W * wf, max(y0, r * 1.25), y1, rr) for z, wf, y0, y1, rr in body], "Paint")
    loft("Sill", root, [(0.8 * h, W * 0.86, r * 0.7, r * 1.3, 0.05), (-0.8 * h, W * 0.86, r * 0.7, r * 1.3, 0.05)], "Trim")
    loft("Cabin", root, [(z * h, W * wf, y0, y1, rr) for z, wf, y0, y1, rr in smooth(cabin, 2)], "CarGlass")
    # Painted pillars and a beltline over the glass house.
    zf, zb = cabin[0][0] * h, cabin[-1][0] * h
    belt = cabin[0][3]
    loft("Belt", root, [(zf, W * cabin[1][1] + 0.02, belt - 0.02, belt + 0.03, 0.03), (zb, W * cabin[-2][1] + 0.02, belt - 0.02, belt + 0.03, 0.03)], "Paint")
    top = max(p[3] for p in cabin)
    zm = (cabin[1][0] + cabin[2][0]) / 2 * h
    box(root, "Pillar", (W * cabin[1][1] + 0.025, top - belt - 0.06, 0.11), (0, (top + belt) / 2, zm), "Paint")
    # Bumpers, plates, mirrors, door seams and handles.
    y_b = max(body[0][2], r * 1.25)
    loft("BumperF", root, [(h + 0.03, W * 0.9, y_b - 0.02, y_b + 0.2, 0.08), (h - 0.25, W * 0.97, y_b - 0.02, y_b + 0.2, 0.08)], "Trim")
    loft("BumperR", root, [(-h + 0.25, W * 0.97, y_b - 0.02, y_b + 0.2, 0.08), (-h - 0.03, W * 0.9, y_b - 0.02, y_b + 0.2, 0.08)], "Trim")
    box(root, "Plate", (0.52, 0.12, 0.02), (0, y_b + 0.1, h + 0.045), "Plate")
    box(root, "Plate", (0.31, 0.16, 0.02), (0, y_b + 0.3, -h - 0.02), "Plate")
    for s in (-1, 1):
        box(root, "Mirror", (0.2, 0.12, 0.1), (s * (W * cabin[0][1] / 2 + 0.1), belt + 0.08, zf - 0.15), "Paint")
        for zz, ln in ((zm + 0.02, 1.0), (zm - 0.9, 0.9)):
            box(root, "Seam", (0.012, belt - r * 1.3, 0.012), (s * (W / 2 + 0.002), (belt + r * 1.3) / 2, zz), "Trim")
            box(root, "Handle", (0.02, 0.035, 0.16), (s * (W / 2 + 0.008), belt - 0.12, zz - 0.25 * ln), "Trim")
    roof_top = max(p[3] for p in cabin)
    roof = [p for p in cabin if p[3] >= roof_top - 0.02]
    loft("Roof", root, [(z * h, W * wf * 0.98, y1 - 0.03, y1 + 0.02, 0.06) for z, wf, y0, y1, rr in roof], "Paint")
    for s in (-1, 1):
        for z in (wheelbase / 2, -wheelbase / 2):
            wheel(root, s * (W / 2 - 0.1), z, r, 0.22)
        box(root, "HeadLamp", (0.32, 0.1, 0.04), (s * (W / 2 - 0.25), body[0][3] - 0.12, h - 0.02), "HeadLamp")
        box(root, "TailLamp", (0.3, 0.12, 0.04), (s * (W / 2 - 0.22), body[-1][3] - 0.1, -h + 0.02), "TailLamp")
    box(root, "Grille", (W * 0.4, 0.14, 0.04), (0, body[0][2] + 0.22, h - 0.01), "Trim")
    if bed:
        box(root, "Bed", (W * 0.9, 0.05, bed), (0, body[-1][3] - 0.02, -h + bed / 2 + 0.05), "Trim")
    return root


# Sedan 4.63 x 1.78 x 1.44 m.
car("Sedan", 4.63, 1.78,
    body=[(1.0, 0.86, 0.32, 0.72, 0.18), (0.92, 0.97, 0.26, 0.82, 0.16), (0.55, 1.0, 0.24, 0.92, 0.12),
          (-0.55, 1.0, 0.24, 0.94, 0.12), (-0.9, 0.97, 0.28, 0.95, 0.14), (-1.0, 0.9, 0.36, 0.9, 0.16)],
    cabin=[(0.42, 0.9, 0.88, 0.95, 0.1), (0.12, 0.84, 0.9, 1.42, 0.14), (-0.3, 0.84, 0.9, 1.43, 0.14), (-0.62, 0.88, 0.9, 1.0, 0.1)],
    wheelbase=2.7, r=0.32)
# SUV 4.9 x 1.95 x 1.76 m.
car("SUV", 4.9, 1.95,
    body=[(1.0, 0.86, 0.42, 0.9, 0.18), (0.92, 0.97, 0.36, 1.02, 0.16), (0.5, 1.0, 0.33, 1.08, 0.12),
          (-0.6, 1.0, 0.33, 1.08, 0.12), (-0.97, 0.97, 0.4, 1.06, 0.12), (-1.0, 0.94, 0.45, 1.02, 0.12)],
    cabin=[(0.45, 0.9, 1.04, 1.1, 0.1), (0.25, 0.86, 1.06, 1.72, 0.14), (-0.85, 0.86, 1.06, 1.74, 0.14), (-0.98, 0.88, 1.04, 1.68, 0.12)],
    wheelbase=2.9, r=0.38, x_off=3.0)
# Pickup 5.6 x 2.0 x 1.88 m.
car("Pickup", 5.6, 2.0,
    body=[(1.0, 0.9, 0.48, 1.0, 0.16), (0.9, 0.98, 0.42, 1.12, 0.14), (0.4, 1.0, 0.4, 1.16, 0.1),
          (-0.6, 1.0, 0.42, 1.14, 0.1), (-1.0, 0.98, 0.48, 1.12, 0.1)],
    cabin=[(0.38, 0.9, 1.12, 1.18, 0.1), (0.2, 0.86, 1.14, 1.86, 0.12), (-0.18, 0.86, 1.14, 1.88, 0.12), (-0.28, 0.88, 1.12, 1.8, 0.1)],
    wheelbase=3.6, r=0.4, x_off=6.0, bed=2.4)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True)
print("exported", OUT)

if PREVIEW:
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    scene.collection.objects.link(cam)
    cam.location = P(10, 2.5, 7)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (P(3, 0.8, 0) - cam.location).to_track_quat("-Z", "Y")
    scene.camera = cam
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    scene.collection.objects.link(sun)
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.render.engine = "BLENDER_EEVEE"
    w = bpy.data.worlds.new("W"); w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.55, 0.6, 1); scene.world = w
    scene.render.resolution_x, scene.render.resolution_y = 1200, 600
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
