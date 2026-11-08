"""Builds the UEMR campus EMS golf cart and exports public/models/uemr_cart.glb.

Reference: the UEMR cart photographed for "Meet your campus emergency response
team" (The Retrograde, 2026-08-21): lifted 2+2 cart, white rounded front cowl
with a black headlight band (round headlights, amber inboard lamps, white and
red LED strips), black tubular brush guard, black lower grille, black roof
with a red LED module and a white flood light, roof-corner spotlights,
post-mounted mirrors, folding clear windshield, all-terrain tires on black
rims. Decals (stripes, seal, phone number) are applied in the game as a
texture on the `Cowl` material, using the cowl's front-projected UVs.

Run headless:
  blender -b --factory-startup --python blender/build_cart.py -- public/models/uemr_cart.glb [preview.png]

Cart frame used below: x = cart left, y = up, z = forward, meters, ground at y = 0.
Blender is Z-up / -Y forward, so P() maps (x, y, z) -> (x, -z, y); the glTF
exporter then turns Blender Z-up into glTF Y-up, giving the game frame back.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else "uemr_cart.glb"
PREVIEW = argv[1] if len(argv) > 1 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def P(x, y, z):
    return Vector((x, -z, y))


# ---------------------------------------------------------------- materials
MATS = {}


def mat(name, color, metal=0.0, rough=0.5, emit=None, strength=0.0, alpha=1.0, coat=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if coat:
        b.inputs["Coat Weight"].default_value = coat
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        for attr, val in (("surface_render_method", "BLENDED"), ("blend_method", "BLEND")):
            try:
                setattr(m, attr, val)
            except Exception:
                pass
    MATS[name] = m
    return m


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


mat("Body_White", srgb("f1f2ef"), rough=0.28, coat=0.6)
mat("Cowl", srgb("f1f2ef"), rough=0.28, coat=0.6)
mat("RearBody", srgb("f1f2ef"), rough=0.28, coat=0.6)
mat("Black_Plastic", srgb("17181a"), rough=0.6)
mat("Fabric", srgb("141517"), rough=0.85)
mat("Seat_Vinyl", srgb("1c1d1f"), rough=0.42)
mat("Frame", srgb("1e2023"), metal=0.6, rough=0.45)
mat("Steel", srgb("b9bdc1"), metal=1.0, rough=0.3)
mat("Tire", srgb("161616"), rough=0.88)
mat("Rim", srgb("141416"), metal=0.6, rough=0.3)
mat("Rim_Machined", srgb("c8cacc"), metal=1.0, rough=0.25)
mat("Glass", srgb("eef4f7"), rough=0.02, alpha=0.08)
mat("WindshieldDecal", srgb("ffffff"), rough=0.3, alpha=0.99)
mat("Lens", srgb("e6eef2"), rough=0.05, metal=0.2)
mat("Headlight", srgb("ffffff"), emit=srgb("fff6e0"), strength=0.5)
mat("Amber", srgb("e08a1e"), rough=0.2, emit=srgb("ff9a20"), strength=0.1)
mat("Brake", srgb("8a0d0d"), rough=0.2, emit=srgb("ff1a10"), strength=0.1)
mat("LED_Red", srgb("5a0b0b"), rough=0.2, emit=srgb("ff1010"), strength=0.0)
mat("LED_Blue", srgb("0b1a5a"), rough=0.2, emit=srgb("1030ff"), strength=0.0)
mat("LED_RB", srgb("2a0b2a"), rough=0.2, emit=srgb("ff1010"), strength=0.0)
mat("LED_White", srgb("d8d8d8"), rough=0.2, emit=srgb("ffffff"), strength=0.0)
mat("LED_Side", srgb("5a2a0b"), rough=0.2, emit=srgb("ff5010"), strength=0.0)
mat("AED", srgb("c8161c"), rough=0.35)
mat("Battery", srgb("2f6fb8"), rough=0.4)
mat("Panel", srgb("222326"), rough=0.5)
mat("Screen", srgb("cfd6e6"), rough=0.2, emit=srgb("9fb4ff"), strength=0.1)


# ---------------------------------------------------------------- helpers
def link(obj):
    scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, verts, faces, material, smooth=False, uv=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    me.materials.append(MATS[material])
    if uv:
        layer = me.uv_layers.new(name="UVMap")
        for loop in me.loops:
            layer.data[loop.index].uv = uv(me.vertices[loop.vertex_index].co)
    return link(bpy.data.objects.new(name, me))


def add_mod(obj, kind, **kw):
    m = obj.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def box(name, size, center, material, bevel=0.0, segs=3):
    sx, sy, sz = size
    cx, cy, cz = center
    vs = [P(cx + dx * sx / 2, cy + dy * sy / 2, cz + dz * sz / 2) for dx in (-1, 1) for dy in (-1, 1) for dz in (-1, 1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    o = mesh_obj(name, vs, faces, material)
    fix_normals(o)
    if bevel:
        add_mod(o, "BEVEL", width=bevel, segments=segs, limit_method="NONE")
        for p in o.data.polygons:
            p.use_smooth = True
    return o


def fix_normals(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(o.data)
    bm.free()


def cyl(name, p0, p1, r, material, verts=16, cap=True):
    a, b = P(*p0), P(*p1)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=verts, radius1=r, radius2=r, depth=d.length)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(MATS[material])
    o = link(bpy.data.objects.new(name, me))
    o.location = (a + b) / 2
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d.normalized())
    add_mod(o, "EDGE_SPLIT", split_angle=math.radians(50))
    return o


def tube(name, pts, r, material):
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = 3
    sp = cu.splines.new("POLY")
    sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*P(*p), 1)
    o = link(bpy.data.objects.new(name, cu))
    o.data.materials.append(MATS[material])
    return o


def rounded_rect(w, y0, y1, r, n=5):
    """Ring in the x-y plane (front view), counter-clockwise seen from the front."""
    r = min(r, w / 2 - 1e-3, (y1 - y0) / 2 - 1e-3)
    corners = [(w / 2 - r, y0 + r, -90), (w / 2 - r, y1 - r, 0), (-w / 2 + r, y1 - r, 90), (-w / 2 + r, y0 + r, 180)]
    out = []
    for cx, cy, start in corners:
        for k in range(n + 1):
            t = math.radians(start + 90 * k / n)
            out.append((cx + r * math.cos(t), cy + r * math.sin(t)))
    return out


def loft(name, profiles, material, uv=None, cap_front=True):
    """profiles: (z, width, y0, y1, corner radius), front to back."""
    rings = [[P(x, y, z) for x, y in rounded_rect(w, y0, y1, r)] for z, w, y0, y1, r in profiles]
    n = len(rings[0])
    verts = [v for ring in rings for v in ring]
    faces = []
    for i in range(len(rings) - 1):
        for k in range(n):
            a, b = i * n + k, i * n + (k + 1) % n
            faces.append((a, b, b + n, a + n))
    if cap_front:
        faces.append(tuple(reversed(range(n))))
    o = mesh_obj(name, verts, faces, material, smooth=True, uv=uv)
    fix_normals(o)
    return o


def join(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    for o in objs:
        bpy.context.view_layer.objects.active = o
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = objs[0]
    if any(o.type == "CURVE" for o in objs):
        bpy.ops.object.convert(target="MESH")
    bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


# ---------------------------------------------------------------- body
WB, TRACK_F, TRACK_R, WR = 1.65, 0.92, 0.98, 0.28
ZF, ZR = WB / 2, -WB / 2

# Front cowl: lofted rounded sections above the front tires, front face at z = 1.245.
cowl_uv = lambda co: ((co.x + 0.6) / 1.2, (co.z - 0.55) / 0.5)
cowl = loft("Cowl", [
    (1.245, 1.0, 0.6, 0.9, 0.12),
    (1.235, 1.1, 0.585, 0.95, 0.14),
    (1.19, 1.16, 0.58, 0.985, 0.13),
    (1.0, 1.18, 0.58, 1.0, 0.11),
    (0.75, 1.18, 0.58, 1.0, 0.09),
    (0.52, 1.16, 0.58, 1.0, 0.08),
], "Cowl", uv=cowl_uv)
add_mod(cowl, "SUBSURF", levels=2, render_levels=2)

# Headlight pods (round lamp over an amber turn lamp) and the black lower edge between them.
for s_ in (-1, 1):
    box("HeadlightPod", (0.22, 0.17, 0.06), (s_ * 0.33, 0.69, 1.225), "Black_Plastic", bevel=0.05)
    cyl("HeadlightRing", (s_ * 0.34, 0.715, 1.245), (s_ * 0.34, 0.715, 1.262), 0.06, "Steel", 24)
    cyl("Headlight", (s_ * 0.34, 0.715, 1.258), (s_ * 0.34, 0.715, 1.266), 0.052, "Headlight", 24)
    cyl("TurnLamp", (s_ * 0.29, 0.645, 1.245), (s_ * 0.29, 0.645, 1.262), 0.024, "Amber", 16)
box("CowlLowerEdge", (0.66, 0.05, 0.05), (0, 0.615, 1.235), "Black_Plastic", bevel=0.015)
box("Grille", (0.7, 0.2, 0.05), (0, 0.48, 1.2), "Black_Plastic", bevel=0.015)
for k in range(5):
    box("GrilleSlat", (0.64, 0.01, 0.02), (0, 0.41 + k * 0.035, 1.228), "Frame")

# Front bumper bar with two warning heads: red/blue on the cart's right, white on its left.
tube("Bumper", [(-0.56, 0.47, 1.1), (-0.56, 0.5, 1.26), (-0.46, 0.53, 1.33), (0.46, 0.53, 1.33), (0.56, 0.5, 1.26), (0.56, 0.47, 1.1)], 0.022, "Frame")
box("BumperPlate", (0.6, 0.06, 0.03), (0, 0.53, 1.33), "Frame", bevel=0.008)
box("LED_RB_Bumper", (0.13, 0.035, 0.02), (-0.12, 0.56, 1.345), "LED_RB")
box("LED_White_Bumper", (0.13, 0.035, 0.02), (0.12, 0.56, 1.345), "LED_White")
for s_ in (-1, 1):
    tube("BumperMount", [(s_ * 0.4, 0.5, 1.32), (s_ * 0.36, 0.44, 1.1)], 0.018, "Frame")

# Chassis, floor, rocker panels with the amber under-floor LEDs.
for s_ in (-1, 1):
    box("Rail", (0.07, 0.09, 2.4), (s_ * 0.32, 0.33, 0.0), "Frame")
box("Floor", (1.16, 0.04, 1.0), (0, 0.38, 0.02), "Black_Plastic", bevel=0.01)
box("FloorMat", (1.1, 0.012, 0.92), (0, 0.405, 0.02), "Seat_Vinyl")
for s_ in (-1, 1):
    box("Rocker", (0.05, 0.08, 1.0), (s_ * 0.6, 0.38, 0.02), "Black_Plastic", bevel=0.012)
    for z in (0.32, -0.02, -0.36):
        box("LED_Side", (0.012, 0.025, 0.09), (s_ * 0.627, 0.37, z), "LED_Side")
for z in (ZF, ZR):
    box("Axle", (0.8, 0.07, 0.07), (0, WR, z), "Frame")
    for s_ in (-1, 1):
        cyl("Shock", (s_ * 0.38, WR + 0.02, z + 0.07), (s_ * 0.33, 0.44, z + 0.1), 0.022, "Steel", 10)

# Dash, steering column and wheel (wheel axis = its local Z, rotated onto the column).
box("Dash", (1.14, 0.2, 0.2), (0, 0.9, 0.5), "Black_Plastic", bevel=0.04)
box("DashTop", (1.12, 0.05, 0.26), (0, 1.0, 0.52), "Black_Plastic", bevel=0.02)
for x in (-0.3, 0.0):
    box("Cubby", (0.22, 0.08, 0.02), (x, 0.92, 0.395), "Panel")
cyl("SteeringColumn", (0.27, 0.82, 0.42), (0.27, 1.06, 0.24), 0.024, "Frame", 12)
bm = bmesh.new()
segs, rs, rt = 32, 0.175, 0.017
ring = []
for i in range(segs):
    a = 2 * math.pi * i / segs
    row = []
    for j in range(8):
        b = 2 * math.pi * j / 8
        row.append(bm.verts.new(((rs + rt * math.cos(b)) * math.cos(a), (rs + rt * math.cos(b)) * math.sin(a), rt * math.sin(b))))
    ring.append(row)
for i in range(segs):
    for j in range(8):
        bm.faces.new((ring[i][j], ring[(i + 1) % segs][j], ring[(i + 1) % segs][(j + 1) % 8], ring[i][(j + 1) % 8]))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
me = bpy.data.meshes.new("SteeringWheel")
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True
me.materials.append(MATS["Seat_Vinyl"])
sw = link(bpy.data.objects.new("SteeringWheel", me))
for ang in (0, math.pi, math.pi / 2 * 3):
    sp = bpy.data.meshes.new("Spoke")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(0.17, 0.03, 0.02), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(0.085, 0, 0), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(ang, 3, "Z"), verts=bm.verts)
    bm.to_mesh(sp)
    bm.free()
    sp.materials.append(MATS["Seat_Vinyl"])
    o = link(bpy.data.objects.new("Spoke", sp))
    o.parent = sw
hub = bpy.data.meshes.new("Hub")
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.045, radius2=0.04, depth=0.05)
bm.to_mesh(hub)
bm.free()
hub.materials.append(MATS["Panel"])
o = link(bpy.data.objects.new("Hub", hub))
o.parent = sw
col_dir = (P(0.27, 1.06, 0.24) - P(0.27, 0.82, 0.42)).normalized()
sw.rotation_mode = "QUATERNION"
sw.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(col_dir)
sw.location = P(0.27, 1.07, 0.23)

# Front bench: black seat base with the AED case in front, contoured cushion and backrest, hip rails.
box("FrontSeatBase", (1.1, 0.3, 0.5), (0, 0.56, 0.02), "Black_Plastic", bevel=0.02)
box("AEDCase", (0.3, 0.24, 0.16), (-0.24, 0.53, 0.35), "AED", bevel=0.02)
box("AEDLabel", (0.14, 0.1, 0.004), (-0.24, 0.55, 0.431), "Body_White")
box("FrontCushion", (1.08, 0.11, 0.5), (0, 0.77, 0.04), "Seat_Vinyl", bevel=0.045, segs=4)
box("FrontBack", (1.08, 0.46, 0.1), (0, 1.08, -0.21), "Seat_Vinyl", bevel=0.045, segs=4)
for s_ in (-1, 1):
    tube("FrontHipRail", [(s_ * 0.56, 0.78, 0.22), (s_ * 0.57, 0.93, 0.18), (s_ * 0.57, 0.95, -0.02), (s_ * 0.56, 0.8, -0.12)], 0.016, "Black_Plastic")

# Rear body: white fenders over the rear wheels, battery bay, tail lights, bumper.
# Side UVs run front-to-back on each side so the livery reads correctly from both sides.
rear_uv = lambda co: ((((-0.42) - (-co.y)) / 0.86) if co.x > 0 else (((-co.y) + 1.28) / 0.86), (co.z - 0.58) / 0.22)
rear = loft("RearBody", [
    (-0.42, 1.18, 0.58, 0.8, 0.06),
    (-0.5, 1.2, 0.58, 0.8, 0.07),
    (-1.2, 1.2, 0.58, 0.8, 0.09),
    (-1.27, 1.12, 0.6, 0.78, 0.09),
], "RearBody", uv=rear_uv, cap_front=False)
add_mod(rear, "SUBSURF", levels=1, render_levels=1)
box("BatteryBay", (0.74, 0.22, 0.75), (0, 0.48, -0.85), "Black_Plastic")
for x in (-0.2, 0.2):
    box("Battery", (0.24, 0.16, 0.17), (x, 0.66, -1.12), "Battery", bevel=0.01)
    box("BatteryTop", (0.24, 0.02, 0.17), (x, 0.75, -1.12), "Body_White")
for s_ in (-1, 1):
    cyl("TailLight", (s_ * 0.44, 0.69, -1.255), (s_ * 0.44, 0.69, -1.285), 0.058, "Brake", 24)
box("RearBumper", (1.0, 0.07, 0.07), (0, 0.46, -1.31), "Frame")

# Rear-facing flip seat with its own grab rails.
box("RearSeatBase", (1.0, 0.06, 0.48), (0, 0.8, -0.66), "Black_Plastic")
box("RearCushion", (1.08, 0.11, 0.46), (0, 0.88, -0.66), "Seat_Vinyl", bevel=0.045, segs=4)
box("RearBack", (1.08, 0.42, 0.1), (0, 1.12, -0.33), "Seat_Vinyl", bevel=0.045, segs=4)
for s_ in (-1, 1):
    tube("RearHipRail", [(s_ * 0.56, 0.88, -0.86), (s_ * 0.57, 1.02, -0.82), (s_ * 0.57, 1.04, -0.6), (s_ * 0.56, 0.9, -0.48)], 0.016, "Black_Plastic")

# Roof posts, soft top with rolled side curtains, light heads, mirrors, console, windshield.
for s_ in (-1, 1):
    tube("FrontPost", [(s_ * 0.57, 0.98, 0.52), (s_ * 0.57, 1.4, 0.5), (s_ * 0.57, 1.8, 0.46), (s_ * 0.57, 1.86, 0.4)], 0.02, "Frame")
    tube("RearPost", [(s_ * 0.57, 0.8, -1.04), (s_ * 0.57, 1.86, -1.08)], 0.02, "Frame")
    box("LED_Red_Post", (0.025, 0.2, 0.03), (s_ * 0.57, 1.36, -1.1), "LED_Red")
    cyl("Curtain", (s_ * 0.6, 1.8, 0.45), (s_ * 0.6, 1.8, -1.12), 0.04, "Fabric", 12)
box("Roof", (1.26, 0.06, 1.86), (0, 1.89, -0.33), "Fabric", bevel=0.025)
box("RoofSkirt", (1.27, 0.06, 1.87), (0, 1.84, -0.33), "Fabric")
box("LED_RB_Roof", (0.16, 0.045, 0.06), (-0.3, 1.945, 0.52), "LED_RB", bevel=0.008)
box("LED_White_Roof", (0.16, 0.045, 0.06), (0.3, 1.945, 0.52), "LED_White", bevel=0.008)
for x in (-0.52, -0.44, 0.44, 0.52):
    cyl("Puck", (x, 1.93, 0.5), (x, 1.96, 0.5), 0.022, "Black_Plastic", 12)
for x in (-0.3, 0.3):
    box("LED_Red_Rear", (0.16, 0.045, 0.06), (x, 1.945, -1.2), "LED_Red", bevel=0.008)
for s_ in (-1, 1):
    tube("MirrorArm", [(s_ * 0.57, 1.45, 0.48), (s_ * 0.66, 1.46, 0.49)], 0.012, "Frame")
    box("Mirror", (0.13, 0.2, 0.035), (s_ * 0.7, 1.46, 0.49), "Black_Plastic", bevel=0.012)
box("Console", (0.34, 0.07, 0.16), (0.2, 1.78, 0.32), "Panel", bevel=0.01)
box("ConsoleKeys", (0.24, 0.004, 0.07), (0.2, 1.744, 0.32), "Panel")
box("Windshield", (1.12, 0.8, 0.006), (0, 1.41, 0.49), "Glass")
ws_uv = lambda co: ((co.x + 0.5) / 1.0, (co.z - 1.73) / 0.07)
wd = mesh_obj("WindshieldDecal", [P(-0.5, 1.73, 0.494), P(0.5, 1.73, 0.494), P(0.5, 1.80, 0.494), P(-0.5, 1.80, 0.494)], [(0, 1, 2, 3)], "WindshieldDecal", uv=ws_uv)
box("WindshieldHinge", (1.12, 0.02, 0.02), (0, 1.4, 0.495), "Black_Plastic")


# ---------------------------------------------------------------- wheel
def build_wheel():
    """205/30-14 street tire on a 14-inch multi-spoke alloy. Axle = local X, centered at origin."""
    bm = bmesh.new()
    K = 48
    prof = [(0.095, 0.178), (0.104, 0.2), (0.106, 0.25), (0.098, 0.272), (0.08, 0.279), (0.04, 0.28), (0.012, 0.276), (0.006, 0.28),
            (-0.006, 0.28), (-0.012, 0.276), (-0.04, 0.28), (-0.08, 0.279), (-0.098, 0.272), (-0.106, 0.25), (-0.104, 0.2), (-0.095, 0.178)]
    rings = []
    for k in range(K):
        t = 2 * math.pi * k / K
        rings.append([bm.verts.new((a, r * math.cos(t), r * math.sin(t))) for a, r in prof])
    for k in range(K):
        for j in range(len(prof) - 1):
            bm.faces.new((rings[k][j], rings[(k + 1) % K][j], rings[(k + 1) % K][j + 1], rings[k][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("Tire")
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    me.materials.append(MATS["Tire"])
    tire = link(bpy.data.objects.new("Wheel", me))

    parts = [cyl("RimBarrel", (-0.09, 0, 0), (0.09, 0, 0), 0.172, "Rim", 32, cap=False),
             cyl("RimLip", (0.085, 0, 0), (0.1, 0, 0), 0.18, "Rim_Machined", 32, cap=False),
             cyl("RimDisk", (0.03, 0, 0), (0.045, 0, 0), 0.165, "Rim", 32),
             cyl("Hub", (0.04, 0, 0), (0.095, 0, 0), 0.045, "Rim_Machined", 16)]
    for k in range(12):
        t = 2 * math.pi * k / 12
        # Twisted split spokes: black body with a machined face.
        for mat_name, dx, w in (("Rim", 0.065, 0.026), ("Rim_Machined", 0.083, 0.012)):
            sp = box("Spoke", (0.02, w, 0.13), (0, 0, 0), mat_name)
            sp.data.transform(Matrix.Rotation(0.18, 4, "X"))
            sp.data.transform(Matrix.Translation((dx, 0, 0.105)))
            sp.data.transform(Matrix.Rotation(t, 4, "X"))
            parts.append(sp)
    rim = join("Rim", parts)
    rim.parent = tire
    return tire


wheel = build_wheel()
# The wheel template sits at the origin; the game clones it onto the four hubs.

# ---------------------------------------------------------------- export
body_objs = [o for o in scene.objects if o.parent is None and o.name not in ("Wheel", "SteeringWheel")]
root = bpy.data.objects.new("UEMR_Cart", None)
link(root)
for o in body_objs:
    mw = o.matrix_world.copy()
    o.parent = root
    o.matrix_world = mw
sw.parent = root

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True)
print("exported", OUT)

if PREVIEW:
    wheel_objs = []
    for x, z in ((TRACK_F / 2, ZF), (-TRACK_F / 2, ZF), (TRACK_R / 2, ZR), (-TRACK_R / 2, ZR)):
        w = wheel.copy()
        link(w)
        for ch in wheel.children:
            c = ch.copy()
            link(c)
            c.parent = w
        w.location = P(x, WR, z)
        if x < 0:
            w.rotation_euler = (0, 0, math.pi)
        wheel_objs.append(w)
    wheel.hide_render = True
    for ch in wheel.children:
        ch.hide_render = True
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    link(cam)
    cam.location = P(2.4, 1.4, 3.6)
    cam.rotation_mode = "QUATERNION"
    cam.rotation_quaternion = (P(0, 0.95, 0) - cam.location).to_track_quat("-Z", "Y")
    cam.data.lens = 50
    scene.camera = cam
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    link(sun)
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scene.world = world
    ground = bpy.data.objects.new("Ground", bpy.data.meshes.new("G"))
    ground.data.from_pydata([(-20, -20, 0), (20, -20, 0), (20, 20, 0), (-20, 20, 0)], [], [(0, 1, 2, 3)])
    gm = bpy.data.materials.new("GroundMat")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.25, 0.24, 1)
    ground.data.materials.append(gm)
    link(ground)
    for eng in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "CYCLES"):
        try:
            scene.render.engine = eng
            break
        except TypeError:
            continue
    if scene.render.engine == "CYCLES":
        scene.cycles.samples = 32
    scene.render.resolution_x, scene.render.resolution_y = 1200, 800
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print("preview", PREVIEW)
