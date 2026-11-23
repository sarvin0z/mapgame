# Building-render performance investigation

Benchmarks use headless Chrome on the AMD Radeon 840M with ANGLE D3D11. The four fixed game views use the low preset in a 1280 × 800 viewport. Each timed render ends with a synchronous pixel readback. Calls and triangles come from Three.js `renderer.info`. Mesh streaming, physics and browser compositing are outside these timings.

## One-factor diagnostics on the previous renderer

Numbers are median milliseconds. Each toggle used 32 warmed frames, with 64 for the opening control. The closing control shows timing drift. The remaining columns compare against the opening control; the results are observational and the differences are not additive.

| View | Opening control | Normals off | Packed roughness/metalness off | 1024² | Opaque glass toggle | Diffuse shader swap | Closing control |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Crow | 21.3 | 21.1 | 17.9 | 20.0 | 19.6 | 19.1 | 22.0 |
| Sciences | 19.0 | 16.9 | 17.0 | 16.7 | 20.2 | 16.8 | 19.7 |
| Mall | 27.1 | 27.4 | 24.4 | 25.8 | 20.2 | 16.7 | 23.9 |
| University Village | 15.9 | 16.8 | 16.9 | 16.8 | 17.0 | 17.7 | 20.0 |

The diffuse swap removes the per-pixel PBR work and its auxiliary samples together. The independent packed-map toggle isolates the effect of removing that sampler and its surface parameters. The normal-map toggle was mixed across views. Crow had the only blended building material in this set and transmission was zero. Draw counts stayed equal in the forced-opacity test, and the timing at the mall varied across controls. The measured reduction at that view cannot be attributed to blend sorting alone.

Building atlas textures generate trilinear mipmaps and use anisotropy 1. A typical uncompressed RGBA8 texture with mips occupies about 21.3 MiB at 2048² and 5.3 MiB at 1024². WebP compresses the file on disk.

## Shader program identity

After the diffuse facade change, the same shaders were tested with shared keys and with a unique cache key per material. Each condition used 64 warmed frames. Program counts are resident in the renderer and may include variants from earlier views.

| View | Shared ms | Unique ms | Resident programs before / after split |
| --- | ---: | ---: | ---: |
| Crow | 10.3 | 10.5 | 67 / 121 |
| Sciences | 13.9 | 16.7 | 122 / 140 |
| Mall | 16.5 | 17.4 | 141 / 153 |
| University Village | 11.0 | 11.2 | 154 / 159 |

## Shadow rebakes and uploads

For the shadow test, the shadow map was rebuilt every frame, then rebuilt with atlas casters disabled. The differences in calls and triangles isolate the contribution of atlas meshes to that pass. The warmed final comparison uses a cached shadow map.

| View | Shadow ms with / without atlas casters | Atlas shadow calls / tris | Forced first upload ms | New textures | Warmed after upload ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| Crow | 18.0 / 16.7 | 5 / 38,568 | 4561.9 | 73 | 22.5 |
| Sciences | 16.8 / 16.9 | 10 / 38,598 | 804.0 | 30 | 24.5 |
| Mall | 24.6 / 23.8 | 26 / 87,684 | 1494.7 | 52 | 26.2 |
| University Village | 19.1 / 17.2 | 23 / 67,068 | 71.6 | 6 | 20.9 |

The upload test intentionally replaced all active atlas sources at once. It demonstrates an upper-bound burst and is not a normal live frame. Final runs report the texture-count change after warm-up.

## Final comparison

The benchmark warmed all four views before timing. Both builds used a fixed camera and a cached shadow map rebuilt for that view. Three rounds of 96 frames alternated which build ran first. The report uses the pooled median for each view.

The final gameplay renderer preserves the original atlas colours and baked joints, uses shared diffuse shaders for ordinary opaque surfaces and a vertex-computed sky reflection for ordinary opaque glazing. NSERL retains its roughness and metalness response, ECS West keeps its reflective green curtain wall, and Crow blends the entrance glazing where its illuminated interior is visible. Glazing is excluded from the shadow caster pass. Building batches draw between the sky and terrain layers. Compatible family roof and facade tiles share a material instance. Six landmark atlases were reduced to 1024². Compare sheets and final counters are indexed in [batch-results.md](batch-results.md).

## Entrance and sign revision

After the sign and entrance rebuilds, the first 288-frame comparison put the mall at 19.45 ms against HEAD's 18.30 ms. Profiling showed 115,200 submitted triangles for the distant terrain skirt. Keeping the original grid near the streamed terrain and widening it in the distance reduced that draw to 22,400 triangles. The sky and distant terrain now draw after the foreground depth-writing terrain, before the ground decals. The sky uses the correct far depth for both depth-buffer modes.

The final rerun passed at all four views, using fewer calls, fewer triangles, and less median render time in each comparison. The [building audit](batch-results.md) contains the paired counters and capture paths.
