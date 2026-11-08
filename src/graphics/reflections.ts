// Sky reflections on glossy surfaces. The scene's environment intensity is
// kept low because the sky probe would otherwise light shaded areas as if
// sunlit, and three.js applies that one intensity to every material that has
// no envMap of its own, so windows, glass and car paint reflected almost
// nothing. This scales only the specular image-based light, in proportion to
// smoothness: rough walls and ground are unchanged, glass and polished paint
// reflect the sky properly.
import * as THREE from 'three';

const DONE = 'reflectionBoost';

export function boostReflections(m: THREE.Material, boost = 8) {
  const std = m as THREE.MeshStandardMaterial;
  if (!std.isMeshStandardMaterial || m.userData[DONE]) return;
  m.userData[DONE] = true;
  // The default cache key is onBeforeCompile's source text, which after wrapping would be the
  // same wrapper for every material; take the original key now so programs are not mixed up.
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey.call(m);
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
  radiance *= mix(1.0, ${boost.toFixed(2)}, pow(1.0 - roughnessFactor, 4.0));
#endif`);
  };
  m.customProgramCacheKey = () => prevKey + '|refl' + boost;
  m.needsUpdate = true;
}

/** Applies boostReflections to every material under `root`. */
export function boostTree(root: THREE.Object3D, boost = 8) {
  root.traverse(o => {
    const mat = (o as THREE.Mesh).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) boostReflections(m, boost);
  });
}

/** Applies boostReflections to every material held by `obj` (one level of records too). */
export function boostAll(obj: object, boost = 8) {
  for (const v of Object.values(obj)) {
    if (v instanceof THREE.Material) boostReflections(v, boost);
    else if (v && typeof v === 'object' && !(v instanceof THREE.Texture)) for (const w of Object.values(v)) if (w instanceof THREE.Material) boostReflections(w, boost);
  }
}
