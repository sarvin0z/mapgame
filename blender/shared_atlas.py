"""Link identical building-family GLB images to one runtime WebP."""
import json
import struct
from pathlib import Path


def share_atlas(model_path, family):
    path = Path(model_path)
    raw = path.read_bytes()
    json_length, = struct.unpack_from("<I", raw, 12)
    doc = json.loads(raw[20:20 + json_length])
    payload = memoryview(raw)[28 + json_length:]
    images = doc["images"]
    if len(images) != 1 or images[0]["mimeType"] != "image/webp":
        raise ValueError(f"{family}: expected a single WebP color atlas")
    image = images[0]
    old_views = doc["bufferViews"]
    removed = image.pop("bufferView")
    view = old_views[removed]
    offset = view.get("byteOffset", 0)
    atlas = bytes(payload[offset:offset + view["byteLength"]])
    shared = path.with_name(f"atlas_{family}.webp")
    if shared.exists() and shared.read_bytes() != atlas:
        raise ValueError(f"{family}: recipes generated different atlases")
    if not shared.exists():
        shared.write_bytes(atlas)
    image["uri"] = shared.name

    index_map = {}
    packed = bytearray()
    views = []
    for i, old in enumerate(old_views):
        if i == removed:
            continue
        index_map[i] = len(views)
        offset = old.get("byteOffset", 0)
        views.append({**old, "byteOffset": len(packed)})
        packed.extend(payload[offset:offset + old["byteLength"]])
        packed.extend(b"\0" * (-len(packed) % 4))

    def remap(obj):
        if isinstance(obj, dict):
            for key, value in obj.items():
                if key == "bufferView":
                    obj[key] = index_map[value]
                else:
                    remap(value)
        elif isinstance(obj, list):
            for row in obj:
                remap(row)

    remap(doc)
    doc["bufferViews"] = views
    doc["buffers"][0]["byteLength"] = len(packed)
    encoded = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    encoded += b" " * (-len(encoded) % 4)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, len(encoded) + len(packed) + 28)
                     + struct.pack("<I4s", len(encoded), b"JSON") + encoded
                     + struct.pack("<I4s", len(packed), b"BIN\0") + packed)
