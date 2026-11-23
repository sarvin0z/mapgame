"""Verify GLB budgets and emit the per-building comparison index."""
import argparse
import io
import json
from pathlib import Path
import struct
import subprocess

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "public/models/buildings"
PREVIEWS = ROOT / "data/preview/buildings"
LANDMARKS = {
    "crow_museum_of_asian_art", "sciences_building", "natural_science_and_engineering_research_lab",
    "engineering_and_computer_science_west", "student_union", "eugene_mcdermott_library",
    "naveen_jindal_school_of_management", "performance_hall_and_music_building",
}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def measure(path):
    data = path.read_bytes()
    magic, version, length, json_length = struct.unpack_from("<4sIII", data)
    if (magic, version, length) != (b"glTF", 2, len(data)):
        raise ValueError(f"Invalid GLB header: {path}")
    doc = json.loads(data[20:20 + json_length])
    primitives = [p for mesh in doc["meshes"] for p in mesh["primitives"]]
    triangles = sum(doc["accessors"][p["indices"]]["count"] // 3 for p in primitives)
    materials = len(doc["materials"])
    per_material = {p.get("material") for p in primitives}
    if len(doc["meshes"]) != materials or len(primitives) != materials or len(per_material) != materials:
        raise ValueError(f"{path.stem} must contain exactly one mesh and primitive per material")
    landmark = path.stem in LANDMARKS
    texture_limit, tri_limit = (2048, 60_000) if landmark else (1024, 30_000)
    sizes = []
    for image in doc["images"]:
        if "uri" in image:
            source = path.with_name(image["uri"]).read_bytes()
        else:
            view = doc["bufferViews"][image["bufferView"]]
            start = 28 + json_length + view.get("byteOffset", 0)
            source = data[start:start + view["byteLength"]]
        with Image.open(io.BytesIO(source)) as image_data:
            if image_data.format != "WEBP" or max(image_data.size) > texture_limit:
                raise ValueError(f"{path.stem} emitted an oversized or non-WebP atlas")
            sizes.append(image_data.size)
    if not sizes or len(sizes) > 3:
        raise ValueError(f"{path.stem}: expected a color atlas with optional normal and surface maps")
    if triangles > tri_limit or materials > 4:
        raise ValueError(f"{path.stem}: over budget ({triangles:,} triangles, {materials} materials)")
    return triangles, materials, sizes, len(data)


def check_reversion(scope, index, specs, solids):
    def git_file(path):
        return subprocess.check_output(["git", "show", f"{scope['head']}:{path}"], cwd=ROOT)

    head_index = set(json.loads(git_file("public/models/buildings/index.json")))
    head_solids = json.loads(git_file("public/models/buildings/solids.json"))
    head_specs = {b["slug"]: b for b in json.loads(git_file("reconstruction/specs.json"))["buildings"]}
    kept = set(scope["kept"])
    accessories = set(scope.get("accessoryModels", []))
    procedural = set(scope["proceduralKept"])
    assert index == head_index | kept | accessories, "Unexpected GLB index entry"
    assert {p.stem for p in MODELS.glob("*.glb")} == index, "Index and GLB files differ"
    for slug in head_index - kept:
        assert (MODELS / f"{slug}.glb").read_bytes() == git_file(f"public/models/buildings/{slug}.glb"), slug
    for before, after in [(head_solids, solids), (head_specs, specs)]:
        assert {k: v for k, v in before.items() if k not in kept | procedural | accessories} == {
            k: v for k, v in after.items() if k not in kept | procedural | accessories
        }, "A legacy recipe or collider differs from HEAD"


def main(output, metrics):
    scope = read_json(ROOT / "reconstruction/photo-scope.json")
    specs = {b["slug"]: b for b in read_json(ROOT / "reconstruction/specs.json")["buildings"]}
    solids = read_json(MODELS / "solids.json")
    index = set(read_json(MODELS / "index.json"))
    check_reversion(scope, index, specs, solids)
    kept = set(scope["kept"])
    gallery = set(scope.get("gallerySlugs", []))
    stair_views = [slug.removesuffix("_access") + "_stairs" for slug in scope.get("accessoryModels", [])]
    gallery_paths = [PREVIEWS.parent / f"gal_{slug}.png" for slug in sorted(gallery | set(stair_views))]
    for preview in gallery_paths:
        if not preview.is_file():
            raise ValueError(f"Missing in-game capture: {preview.name}")
    batches = {"Landmarks": sorted(kept & LANDMARKS), "Other photographed buildings": sorted(kept - LANDMARKS)}
    model_bytes = sum(f.stat().st_size for f in MODELS.iterdir() if f.is_file())
    lines = [
        "# Building reconstruction audit",
        "",
        f"Model directory size is **{model_bytes:,} bytes**, including shared WebPs and collider files.",
        "",
        "Each GLB exports one primitive per material. Column counts describe round posts. "
        "Hull counts cover angled supports and detailed stair parts. Closed volumes include elevated geometry. "
        "WebP dimensions list color and any normal and packed roughness/metalness maps.",
        "",
    ]
    all_slugs = set()
    for batch, slugs in batches.items():
        lines += [
            f"## {batch}", "",
            "| Building | Slug | Triangles | Materials | Atlas px | GLB KB | Collision geometry | Compare |",
            "| --- | --- | ---: | ---: | --- | ---: | --- | --- |",
        ]
        for slug in slugs:
            all_slugs.add(slug)
            spec = specs[slug]
            name = spec.get("displayName", spec["name"])
            triangles, materials, sizes, size = measure(MODELS / f"{slug}.glb")
            preview = PREVIEWS.parent / f"gal_{slug}.png" if slug in gallery else PREVIEWS / f"{slug}_compare.png"
            if slug not in index or not preview.is_file():
                raise ValueError(f"{slug}: missing index entry or preview")
            atlas = " + ".join(f"{w}×{h}" for w, h in sizes)
            family = spec["recipe"]["atlasModel"].get("atlasFamily")
            if family:
                atlas += f" shared ({family})"
            solid = solids[slug]
            if not solid.get("replaceFootprint"):
                raise ValueError(f"{slug}: atlas faces are using footprint fallback collision")
            collider = ", ".join(f"{len(solid.get(k, []))} {label}" for k, label in [
                ("rings", "rings"), ("posts", "posts"), ("volumes", "volumes"),
                ("shells", "shells"), ("hulls", "hulls"), ("paving", "paving patches"),
            ] if solid.get(k))
            lines.append(
                f"| {name} | `{slug}` | {triangles:,} | {materials} | {atlas} | {size / 1000:.1f} | "
                f"{collider} | [Preview](../{preview.relative_to(ROOT).as_posix()}) |"
            )
        lines.append("")
    lines += ["## Photographed procedural features", ""]
    for slug in scope["proceduralKept"]:
        preview = PREVIEWS.parent / f"gal_{slug}.png" if slug in gallery else PREVIEWS / f"{slug}_compare.png"
        if not preview.is_file():
            raise ValueError(f"Missing {slug} comparison")
        lines.append(f"- [`{slug}`](../{preview.relative_to(ROOT).as_posix()})")
    if scope.get("accessoryModels"):
        lines += ["", "## Callier access attachments", ""]
        for slug in scope["accessoryModels"]:
            triangles, materials, _, _ = measure(MODELS / f"{slug}.glb")
            base = slug.removesuffix("_access")
            lines.append(f"- [`{slug}`](../data/preview/gal_{base}_stairs.png) has {triangles:,} triangles and {materials} materials.")
        lines.append("")
        lines.append("The restored HEAD files retain their original material counts.")
    lines += ["", "## Restored to HEAD", "",
              f"The index, collider entries, and specs outside the retained scope match `{scope['head']}`.", "",
              f"### Procedural footprints ({len(scope['restoredProcedural'])})", "",
              *[f"- `{slug}`" for slug in scope["restoredProcedural"]], "",
              f"### Changed GLBs restored byte-for-byte ({len(scope['restoredHeadGLB'])})", "",
              *([f"- [`{slug}`](../data/preview/gal_{slug}.png)" for slug in scope["restoredHeadGLB"]] or
                ["All HEAD GLBs were already in the photographed keep set."]), "",
              "### Photo identification notes", "",
              *[f"- **{name}.** {note}" for name, note in scope["photoNotes"].items()], ""]
    if metrics:
        head, current = (read_json(path) for path in metrics)
        if head.get("errors") or current.get("errors"):
            raise ValueError("A benchmark reported browser errors")
        if head.get("gpu") != current.get("gpu"):
            raise ValueError("Baseline and current use different renderers")
        frames = min(row.get("frames", 8) for run in (head, current) for row in run["results"])
        statistic = "median" if frames >= 60 else "mean"
        lines += [
            "## In-game performance", "",
            "Headless Chrome using the low preset in a 1280 × 800 viewport. The same streamed chunks "
            f"were warmed for each pair. Times are the {statistic} of {frames} render-only frames per view "
            "with synchronous GPU readback. They exclude simulation, streaming, and browser compositor time.",
            "",
            f"Renderer: {current.get('gpu', 'WebGL')}.", "",
            "| View | HEAD calls | HEAD tris | HEAD ms | Current calls | Current tris | Current ms |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
        for before, after in zip(head["results"], current["results"], strict=True):
            assert before["name"] == after["name"]
            if before.get("chunks") != after.get("chunks"):
                raise ValueError(f"{before['name']}: benchmark used different visible chunks")
            lines.append(f"| {before['name']} | {before['calls']:,} | {before['tris']:,} | {before['ms']:.1f} | "
                         f"{after['calls']:,} | {after['tris']:,} | {after['ms']:.1f} |")
        if any(after["calls"] > before["calls"]
               for before, after in zip(head["results"], current["results"], strict=True)):
            raise ValueError("The current game exceeds HEAD's draw calls in at least one view")
        if frames >= 60 and any(after["ms"] > before["ms"] for before, after in
                                zip(head["results"], current["results"], strict=True)):
            raise ValueError("The current game exceeds HEAD's median render time in at least one view")
        lines.append("")
    lines += [
        "## Game captures", "",
        *[f"- [`{file.name}`](../{file.relative_to(ROOT).as_posix()})" for file in gallery_paths],
        "", "## Verification and reference coverage", "",
        "- [Overpass and canopy clearance](overpass-checks.md) lists the cart probe results by OSM ID.",
        "- Run `node --experimental-transform-types blender/check_building_colliders.mjs` to verify "
        "ground-wall contacts and the surveyed cart clearances.",
        "- See [observations.json](observations.json) for sources, OSM identity, references, and building-specific uncertainties.",
    ]
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Verified {len(all_slugs)} GLBs and {model_bytes:,} directory bytes")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "reconstruction/batch-results.md")
    parser.add_argument("--metrics", type=Path, nargs=2, metavar=("HEAD", "CURRENT"))
    args = parser.parse_args()
    main(args.output, args.metrics)
