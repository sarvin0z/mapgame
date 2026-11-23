"""Render paired building comparisons with Blender and Pillow.

From the repo, run:
    python blender/render_compare.py <slug> [<slug> ...]
Reference descriptors in observations.json may use a local file, a PDF image
position (one-based page, zero-based image index), or a direct photo URL.
PyMuPDF is required for PDF comparisons. All source photos and staging stay
outside tracked paths. The only project output is the ignored PNG sheet.
"""
import argparse
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
BLENDER = Path("C:/Program Files/Blender Foundation/Blender 5.2/blender.exe")


def reference_image(ref, downloads):
    from PIL import Image, ImageOps

    if "pdf" in ref:
        import pymupdf

        with pymupdf.open(downloads / ref["pdf"]) as document:
            page = document[ref["page"] - 1]
            image = page.get_image_info()[ref["image"]]
            pix = page.get_pixmap(clip=pymupdf.Rect(image["bbox"]), matrix=pymupdf.Matrix(2, 2), alpha=False)
        source = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    elif "url" in ref:
        req = Request(ref["url"], headers={"User-Agent": "Mozilla/5.0"})
        with urlopen(req, timeout=20) as response:
            source = Image.open(io.BytesIO(response.read()))
    elif "download" in ref:
        source = Image.open(downloads / "reference pics" / ref["download"])
    else:
        source = Image.open(ROOT / "data" / "refs" / ref["file"])
    source = ImageOps.exif_transpose(source).convert("RGB")
    if "crop" in ref:
        x0, y0, x1, y1 = ref["crop"]
        source = source.crop((int(x0 * source.width), int(y0 * source.height),
                              int(x1 * source.width), int(y1 * source.height)))
    return source


def render_scene(payload):
    import bpy
    from mathutils import Vector

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.dont_write_bytecode = True
    from atlas_buildings import Site

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.data.orphans_purge(do_recursive=True)
    bpy.ops.import_scene.gltf(filepath=payload["glb"])
    model_meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not model_meshes:
        raise RuntimeError("No building mesh imported")
    ring = payload["outer"]
    cx, cy = [sum(p[i] for p in ring) / len(ring) for i in range(2)]
    site = Site(ROOT / "public" / "data", ring)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = payload.get("samples", 32)
    scene.render.image_settings.file_format = "PNG"
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    world = scene.world.node_tree
    coords = world.nodes.new("ShaderNodeTexCoord")
    xyz = world.nodes.new("ShaderNodeSeparateXYZ")
    gradient = world.nodes.new("ShaderNodeValToRGB")
    gradient.color_ramp.elements[0].position = 0.0
    gradient.color_ramp.elements[0].color = (.61, .55, .47, 1.0)
    gradient.color_ramp.elements[1].position = 0.65
    gradient.color_ramp.elements[1].color = (.16, .32, .6, 1.0)
    direction = world.nodes.new("ShaderNodeMath")
    direction.operation = "MULTIPLY"
    direction.inputs[1].default_value = -2.0
    world.links.new(coords.outputs["Normal"], xyz.inputs[0])
    world.links.new(xyz.outputs["Z"], direction.inputs[0])
    world.links.new(direction.outputs[0], gradient.inputs[0])
    world.links.new(gradient.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = .85

    def light(name, kind, energy, color, p, target):
        data = bpy.data.lights.new(name, kind)
        data.color, data.energy = color, energy
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = p
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
        return data

    # A warm directional key and broad cool fill keep the glass and shadowed soffits legible.
    sun = light("Late afternoon sun", "SUN", 2.3, (1.0, .84, .66), (8, -13, 8), (0, 0, 0))
    sun.angle = .17
    fill = light("Open sky", "AREA", 46000, (.68, .79, 1.0), (-22, 13, 42), (0, 0, 0))
    fill.shape, fill.size = "DISK", 85
    light("Sky bounce", "SUN", .88, (.68, .79, 1.0), (-8, 12, 15), (0, 0, 0))

    ground = bpy.data.materials.new("Preview paving")
    ground.use_nodes = True
    shader = ground.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (.24, .214, .182, 1)
    shader.inputs["Roughness"].default_value = .92
    stations = range(-65, 66)
    vertices = [(i * 2, j * 2, site.height(cx + i * 2, cy + j * 2) - site.base - .025)
                for j in stations for i in stations]
    width = len(stations)
    faces = []
    for j in range(width - 1):
        for i in range(width - 1):
            a = j * width + i
            faces.extend(((a, a + 1, a + width + 1), (a, a + width + 1, a + width)))
    mesh = bpy.data.meshes.new("Terrain sample")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(ground)
    floor = bpy.data.objects.new("Terrain sample", mesh)
    scene.collection.objects.link(floor)
    # Match the game foundation immediately below the architecturally detailed model.
    import mathutils
    loops = [ring, *payload.get("holes", [])]
    loops = [[Vector((p[0] - cx, p[1] - cy, .019)) for p in r] for r in loops]
    mesh = bpy.data.meshes.new("Ground floor")
    mesh.from_pydata([p for loop in loops for p in loop], [], mathutils.geometry.tessellate_polygon(loops))
    mesh.materials.append(ground)
    slab = bpy.data.objects.new("Ground floor", mesh)
    scene.collection.objects.link(slab)

    camera = bpy.data.objects.new("Architectural camera", bpy.data.cameras.new("Architectural camera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    for item in payload["views"]:
        scene.render.resolution_x, scene.render.resolution_y = item["resolution"]
        eye = Vector((item["eye"][0] - cx, item["eye"][1] - cy, item["eye"][2]))
        at = Vector((item["at"][0] - cx, item["at"][1] - cy, item["at"][2]))
        camera.location = eye
        camera.rotation_euler = (at - eye).to_track_quat("-Z", "Y").to_euler()
        camera.data.lens = item.get("lens", 38)
        camera.data.clip_start = .12
        scene.render.filepath = item["output"]
        bpy.ops.render.render(write_still=True)


def write_sheet(title, output, panels):
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    output.parent.mkdir(parents=True, exist_ok=True)
    panel_width, panel_height, gap = 645, 380, 20
    sheet = Image.new("RGB", (panel_width * 2 + gap * 3, 85 + len(panels) * (panel_height + 54)), "#1c242a")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=17)
    draw.text((gap, 15), title, fill="#f7f0e3", font=ImageFont.load_default(size=25))
    draw.text((gap, 53), "MODEL", fill="#e5c090", font=font)
    draw.text((panel_width + gap * 2, 53), "REFERENCE", fill="#e5c090", font=font)
    for i, (label, image_path, photo) in enumerate(panels):
        y = 85 + i * (panel_height + 54)
        with Image.open(image_path) as original:
            render = original.convert("RGB")
        for j, picture in enumerate((render, photo)):
            if picture is None:
                draw.text((panel_width + 2 * gap + 20, y + panel_height / 2), "Exterior reference unavailable",
                          fill="#c0cbd2", font=font)
                continue
            sized = ImageOps.contain(picture, (panel_width, panel_height))
            x = gap + j * (panel_width + gap) + (panel_width - sized.width) // 2
            sheet.paste(sized, (x, y + (panel_height - sized.height) // 2))
        draw.text((gap, y + panel_height + 9), label, fill="#d3dce0", font=font)
    sheet.save(output)
    print(output, flush=True)


def compare(args):
    from functools import lru_cache
    from PIL import ImageOps

    @lru_cache(maxsize=48)
    def cached_reference(key):
        return ImageOps.contain(reference_image(json.loads(key), args.downloads), (900, 700))

    specs = json.loads((ROOT / "reconstruction/specs.json").read_text(encoding="utf-8"))
    observations = json.loads((ROOT / "reconstruction/observations.json").read_text(encoding="utf-8"))["buildings"]
    lookup = {s["slug"]: s for s in specs["buildings"]}
    visual_dir = ROOT / "data" / "preview" / "buildings"
    with tempfile.TemporaryDirectory(prefix="utd-compare-") as temp:
        folder = Path(temp)
        jobs, sheets = [], []
        for slug in args.slugs:
            spec = lookup.get(slug)
            if spec is None:
                title, row = next((name, row) for name, row in observations.items() if row.get("modelSlug") == slug)
            else:
                title = spec.get("displayName", spec["name"])
                row = observations[title]
            family = spec and spec["recipe"].get("atlasModel", {}).get("atlasFamily")
            fast = family is not None
            render_views, panels = [], []
            for i, view in enumerate(row["compareViews"]):
                photo = cached_reference(json.dumps(view["ref"], sort_keys=True)) if view.get("ref") else None
                maximum = (640, 455) if fast else (900, 660)
                resolution = ImageOps.contain(photo, maximum).size if photo else (760, 460)
                if max(resolution) < (480 if fast else 640):
                    scale = (480 if fast else 640) / max(resolution)
                    resolution = tuple(round(n * scale) for n in resolution)
                if "render" in view:
                    image = visual_dir / view["render"]
                else:
                    image = folder / f"{slug}_{i}.png"
                    render_views.append({**view, "resolution": resolution, "output": str(image)})
                panels.append((view["name"], image, photo))
            if render_views:
                jobs.append({"glb": str(args.models.resolve() / f"{slug}.glb"),
                             "outer": spec["outer"], "holes": spec.get("holes", []),
                             "samples": 12 if fast else 32, "views": render_views})
            sheets.append((title, visual_dir / f"{slug}_compare.png", panels))
        job = folder / "job.json"
        if jobs:
            job.write_text(json.dumps(jobs), encoding="utf-8")
            subprocess.run([str(args.blender), "-b", "--factory-startup", "--python-exit-code", "1",
                            "--python", str(Path(__file__).resolve()), "--", "--render", str(job)], check=True, cwd=ROOT)
        for sheet in sheets:
            write_sheet(*sheet)


if __name__ == "__main__":
    if "--render" in sys.argv:
        for payload in json.loads(Path(sys.argv[sys.argv.index("--render") + 1]).read_text(encoding="utf-8")):
            render_scene(payload)
    else:
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("slugs", nargs="+")
        parser.add_argument("--blender", type=Path, default=BLENDER)
        parser.add_argument("--models", type=Path, default=ROOT / "public" / "models" / "buildings")
        parser.add_argument("--downloads", type=Path, default=Path.home() / "Downloads")
        compare(parser.parse_args())
