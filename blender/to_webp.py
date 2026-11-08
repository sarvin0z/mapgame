"""Converts the photo textures in public/textures from PNG to WebP (smaller
downloads; alpha kept for leaves). Run headless:
  blender -b --factory-startup --python blender/to_webp.py -- public/textures
"""
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
folder = os.path.abspath(argv[0] if argv else "public/textures")
scene = bpy.context.scene
# Write pixel values unchanged (save_render otherwise applies the AgX view transform).
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"
for name in sorted(os.listdir(folder)):
    if not name.endswith(".png"):
        continue
    img = bpy.data.images.load(os.path.join(folder, name))
    alpha = name.startswith("leaves")
    s = scene.render.image_settings
    s.file_format = "WEBP"
    s.color_mode = "RGBA" if alpha else "RGB"
    s.quality = 88
    out = os.path.join(folder, name[:-4] + ".webp")
    img.save_render(out, scene=scene)
    print("wrote", out, os.path.getsize(out))
