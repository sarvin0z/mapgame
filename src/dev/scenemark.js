/**
 * scenemark (3D-Agentation-Editor) — click-to-annotate feedback for 3D web pages.
 *
 * Click a point in a WebGL view, type a note, and scenemark records what is under the cursor
 * (object path, mesh, material, world point, normal, UV), the camera pose, and a screenshot with
 * the click marked. Notes go to a local receiver (server.mjs -> .scenemark/notes.json + shots) or
 * are copied as Markdown for a coding agent.
 *
 * Zero dependencies: it does NOT import three. Picking uses its own ray/triangle code that reads
 * standard three.js object fields, so it works with any three.js build (npm, CDN, A-Frame,
 * react-three-fiber). Other engines: pass `pick` (Babylon is built in); with nothing else it still
 * records screenshot + pixel + canvas info.
 *
 *   import { attachSceneMark } from './scenemark.js';
 *   attachSceneMark({ renderer, scene, camera });          // explicit (best)
 *   autoAttachSceneMark();                                  // find renderer/scene/camera on the page
 */

// ---------- small math (column-major 4x4 like three.js, plain arrays) ----------
const r3 = n => Math.round(n * 1000) / 1000;
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-3);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mul4(a, b) {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function inv4(m) {
  const o = new Float64Array(16);
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return o;
}
const pt4 = (m, x, y, z) => { // point, with perspective divide
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
};
const dir4 = (m, x, y, z) => [m[0] * x + m[4] * y + m[8] * z, m[1] * x + m[5] * y + m[9] * z, m[2] * x + m[6] * y + m[10] * z];
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const maxScale = m => Math.sqrt(Math.max(m[0] * m[0] + m[1] * m[1] + m[2] * m[2], m[4] * m[4] + m[5] * m[5] + m[6] * m[6], m[8] * m[8] + m[9] * m[9] + m[10] * m[10]));
const det3 = m => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
const rv = v => v.map(r3);

// ---------- ray casting against three.js meshes ----------
/** Nearest triangle hit of a world-space ray (unit direction d) on one Mesh / InstancedMesh, or null. */
function raycastMesh(mesh, o, d) {
  const geo = mesh.geometry, pos = geo?.attributes?.position;
  if (!pos || !(pos.array || pos.data?.array)) return null; // freed CPU-side data (common in streamed worlds)
  const idx = geo.index;
  if (idx && !idx.array) return null;
  if (!geo.boundingSphere) { try { geo.computeBoundingSphere(); } catch { /* ignore */ } }
  const bs = geo.boundingSphere, uvAttr = geo.attributes.uv;
  const world = mesh.matrixWorld.elements;
  const inst = mesh.isInstancedMesh && mesh.instanceMatrix?.array ? mesh.instanceMatrix.array : null;
  const n = inst ? Math.min(mesh.count, inst.length / 16) : 1;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const groups = Array.isArray(mesh.material) && geo.groups?.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
  const total = idx ? idx.count : pos.count;
  const dr = geo.drawRange ?? { start: 0, count: Infinity };
  let best = null;

  for (let i = 0; i < n; i++) {
    const E = inst ? mul4(world, inst.subarray(i * 16, i * 16 + 16)) : world;
    if (bs) { // cull by distance from the ray line to the bounding sphere
      const c = pt4(E, bs.center.x, bs.center.y, bs.center.z), rad = bs.radius * maxScale(E);
      const ox = c[0] - o[0], oy = c[1] - o[1], oz = c[2] - o[2], t = ox * d[0] + oy * d[1] + oz * d[2];
      if (ox * ox + oy * oy + oz * oz - t * t > rad * rad) continue;
    }
    const inv = inv4(E); if (!inv) continue;
    const lo = pt4(inv, o[0], o[1], o[2]), ld = dir4(inv, d[0], d[1], d[2]);
    const mirrored = det3(E) < 0;
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0] ?? mats[0];
      const side = mat?.side ?? 0;
      const s0 = Math.max(g.start, dr.start), s1 = Math.min(g.start + g.count, total, dr.start + dr.count);
      for (let j = s0; j + 2 < s1; j += 3) {
        const ia = idx ? idx.getX(j) : j, ib = idx ? idx.getX(j + 1) : j + 1, ic = idx ? idx.getX(j + 2) : j + 2;
        const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
        const e1x = pos.getX(ib) - ax, e1y = pos.getY(ib) - ay, e1z = pos.getZ(ib) - az;
        const e2x = pos.getX(ic) - ax, e2y = pos.getY(ic) - ay, e2z = pos.getZ(ic) - az;
        const px = ld[1] * e2z - ld[2] * e2y, py = ld[2] * e2x - ld[0] * e2z, pz = ld[0] * e2y - ld[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-14) continue;
        const front = mirrored ? det < 0 : det > 0;
        if ((side === 0 && !front) || (side === 1 && front)) continue;
        const f = 1 / det, tx = lo[0] - ax, ty = lo[1] - ay, tz = lo[2] - az;
        const u = (tx * px + ty * py + tz * pz) * f; if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (ld[0] * qx + ld[1] * qy + ld[2] * qz) * f; if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * f; if (t < 1e-6) continue;
        if (best && t >= best.t) continue;
        best = { t, ia, ib, ic, u, v, inv, materialIndex: g.materialIndex ?? 0, instanceId: inst ? i : null, e: [e1x, e1y, e1z, e2x, e2y, e2z] };
      }
    }
  }
  if (!best) return null;
  const e = best.e;
  const nl = [e[1] * e[5] - e[2] * e[4], e[2] * e[3] - e[0] * e[5], e[0] * e[4] - e[1] * e[3]];
  const inv = best.inv; // world normal = transpose(inverse) * local normal
  let nw = norm3([inv[0] * nl[0] + inv[1] * nl[1] + inv[2] * nl[2], inv[4] * nl[0] + inv[5] * nl[1] + inv[6] * nl[2], inv[8] * nl[0] + inv[9] * nl[1] + inv[10] * nl[2]]);
  if (nw[0] * d[0] + nw[1] * d[1] + nw[2] * d[2] > 0) nw = [-nw[0], -nw[1], -nw[2]]; // face the viewer
  let uv = null;
  if (uvAttr) {
    const w0 = 1 - best.u - best.v;
    uv = [w0 * uvAttr.getX(best.ia) + best.u * uvAttr.getX(best.ib) + best.v * uvAttr.getX(best.ic),
      w0 * uvAttr.getY(best.ia) + best.u * uvAttr.getY(best.ib) + best.v * uvAttr.getY(best.ic)];
  }
  return {
    object: mesh, distance: best.t, point: [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t],
    normal: nw, uv, instanceId: best.instanceId, material: mats[best.materialIndex] ?? mats[0],
  };
}

// ---------- page discovery ----------
/** Find three.js renderer/scene/camera objects reachable from window globals, A-Frame, or the devtools hook. */
function discover() {
  const found = { renderers: new Set(), scenes: new Set(), cameras: new Set() };
  const seen = new Set();
  const consider = (v, depth) => {
    if (!v || typeof v !== 'object' || seen.has(v)) return;
    seen.add(v);
    if (v.isWebGLRenderer) { found.renderers.add(v); return; }
    if (v.isScene) { found.scenes.add(v); return; }
    if (v.isCamera) { found.cameras.add(v); return; }
    if (depth <= 0 || (typeof Node !== 'undefined' && v instanceof Node) || v === window) return;
    let keys; try { keys = Object.keys(v); } catch { return; }
    for (const k of keys.slice(0, 200)) { try { consider(v[k], depth - 1); } catch { /* getter threw */ } }
  };
  for (const k of Object.keys(window)) { try { consider(window[k], 2); } catch { /* ignore */ } }
  for (const o of window.__sceneMarkObserved ?? []) consider(o, 0);
  for (const s of window.AFRAME?.scenes ?? []) { consider(s.object3D, 0); consider(s.renderer, 0); consider(s.camera, 0); }
  return found;
}

const area = c => { const r = c.getBoundingClientRect(); return r.width * r.height; };
function biggestCanvas() {
  return [...document.querySelectorAll('canvas')].filter(c => area(c) > 0).sort((a, b) => area(b) - area(a))[0] ?? null;
}
function canvasSelector(c) {
  if (c.id) return `canvas#${c.id}`;
  const all = [...document.querySelectorAll('canvas')];
  return `canvas:nth-of-type(${all.indexOf(c) + 1})` + (c.className && typeof c.className === 'string' && c.className.trim() ? '.' + c.className.trim().split(/\s+/).join('.') : '');
}

// requestAnimationFrame wrapper so a screenshot can be taken right after the page's own render,
// while the WebGL drawing buffer is still valid (no preserveDrawingBuffer needed).
let rawRaf = null, rafHooked = false;
const afterFrame = [];
function hookRaf() {
  if (rafHooked) return; rafHooked = true;
  const orig = window.requestAnimationFrame.bind(window);
  rawRaf = orig;
  window.requestAnimationFrame = cb => orig(t => { try { cb(t); } finally { for (const f of afterFrame.splice(0)) f(); } });
}
const isBlank = canvas => {
  try {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, 16, 16);
    const d = g.getImageData(0, 0, 16, 16).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] && (d[i] | d[i + 1] | d[i + 2])) return false;
    return true;
  } catch { return false; }
};

// ---------- styles ----------
const CSS = `
:host{all:initial}
*{box-sizing:border-box;font:12px/1.4 system-ui,-apple-system,Segoe UI,sans-serif}
.bar{position:fixed;right:12px;bottom:12px;display:flex;gap:4px;align-items:center;padding:4px;
  background:rgba(18,20,26,.92);color:#e8eaf0;border:1px solid rgba(255,255,255,.14);border-radius:10px;
  box-shadow:0 4px 18px rgba(0,0,0,.45);z-index:2147483000;user-select:none}
.bar button{all:unset;cursor:pointer;padding:5px 9px;border-radius:7px;color:inherit;font-size:12px}
.bar button:hover{background:rgba(255,255,255,.1)}
.bar button.on{background:#3b82f6;color:#fff}
.bar .dot{width:7px;height:7px;border-radius:50%;background:#6b7280;margin:0 4px}
.bar .dot.ok{background:#22c55e}
.bar .count{min-width:18px;text-align:center;opacity:.75}
.pin{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
  background:#ef4444;color:#fff;border:2px solid #fff;font-weight:700;font-size:11px;display:flex;
  align-items:center;justify-content:center;cursor:pointer;z-index:2147482990;box-shadow:0 2px 8px rgba(0,0,0,.5)}
.pin.miss{background:#f59e0b}
.pin:hover{transform:scale(1.15)}
.pop{position:fixed;width:300px;padding:10px;background:rgba(18,20,26,.97);color:#e8eaf0;z-index:2147483001;
  border:1px solid rgba(255,255,255,.18);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,.55)}
.pop .tgt{font-family:ui-monospace,Consolas,monospace;font-size:11px;opacity:.8;margin-bottom:6px;word-break:break-all}
.pop textarea{width:100%;height:78px;resize:vertical;background:#0c0d11;color:#fff;border:1px solid rgba(255,255,255,.2);
  border-radius:6px;padding:6px;outline:none}
.pop textarea:focus{border-color:#3b82f6}
.pop .row{display:flex;gap:6px;margin-top:8px;justify-content:flex-end}
.pop button{all:unset;cursor:pointer;padding:5px 10px;border-radius:6px;background:rgba(255,255,255,.1);font-size:12px}
.pop button.pri{background:#3b82f6;color:#fff}
.pop button.del{margin-right:auto;color:#fca5a5}
.toast{position:fixed;right:12px;bottom:56px;background:rgba(18,20,26,.95);color:#e8eaf0;padding:6px 10px;
  border-radius:8px;z-index:2147483002;border:1px solid rgba(255,255,255,.14)}
`;

/**
 * @param {object} opts
 *  renderer, scene, camera (or () => camera)   three.js objects (any may be omitted; see autoAttachSceneMark)
 *  canvas      the WebGL canvas (default renderer.domElement, else the largest canvas on the page)
 *  controls    OrbitControls-like; its target is saved/restored
 *  render      () => draw one frame, if you need screenshots to include post-processing
 *  pick        (clientX, clientY) => {path,type,point,...}|null, for non-three engines
 *  endpoint    receiver URL (default http://localhost:4748; false = none)
 *  hotkey      KeyboardEvent.code toggled with Shift (default 'KeyM')
 *  ignore      (object3D) => true to make an object unpickable (or set userData.scenemarkIgnore)
 *  onModeChange (active) => void
 */
export function attachSceneMark(opts = {}) {
  if (window.__scenemark) window.__scenemark.destroy();
  const renderer = opts.renderer ?? null;
  const canvas = opts.canvas ?? renderer?.domElement ?? biggestCanvas();
  if (!canvas) throw new Error('scenemark: no canvas found');
  let scene = opts.scene ?? null;
  const camOpt = opts.camera ?? null;
  const getCam = () => (typeof camOpt === 'function' ? camOpt() : camOpt);
  const controls = opts.controls ?? null;
  const endpoint = opts.endpoint === false ? null : (opts.endpoint ?? 'http://localhost:4748');
  const storeKey = opts.storageKey ?? 'scenemark:' + location.pathname;
  hookRaf();

  /** @type {any[]} */
  let notes = [];
  try { notes = JSON.parse(localStorage.getItem(storeKey) || '[]'); } catch { /* storage blocked */ }
  let active = false, pinsVisible = true, connected = false, raf = 0, down = null, pop = null;

  // ---- UI (shadow DOM so page CSS and key handlers stay out) ----
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style><div class="bar" style="pointer-events:auto">
    <span class="dot" title="Receiver"></span><button data-a="mark">Mark</button><span class="count">0</span>
    <button data-a="copy">Copy</button><button data-a="pins">Pins</button><button data-a="clear">Clear</button></div><div id="pins"></div>`;
  for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, e => e.stopPropagation());
  for (const t of ['pointerdown', 'mousedown', 'wheel', 'click']) root.querySelector('.bar').addEventListener(t, e => e.stopPropagation());
  document.body.appendChild(host);
  const bar = root.querySelector('.bar'), pinLayer = root.getElementById('pins');
  const btn = a => bar.querySelector(`[data-a="${a}"]`);
  const dot = bar.querySelector('.dot'), countEl = bar.querySelector('.count');
  const toast = msg => {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; root.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  };

  // ---- camera helpers (plain field access, no three import) ----
  const camPos = cam => [cam.matrixWorld.elements[12], cam.matrixWorld.elements[13], cam.matrixWorld.elements[14]];
  const camForward = cam => norm3([-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[9], -cam.matrixWorld.elements[10]]);

  function rayAt(clientX, clientY, cam) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1, ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    const pinv = cam.projectionMatrixInverse?.elements ?? inv4(cam.projectionMatrix.elements);
    const W = cam.matrixWorld.elements;
    // Two points on the ray (valid for standard, reversed and logarithmic depth alike).
    const p0 = pt4(W, ...pt4(pinv, nx, ny, 0.3)), p1 = pt4(W, ...pt4(pinv, nx, ny, 0.6));
    let d = norm3([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const fwd = camForward(cam);
    if (d[0] * fwd[0] + d[1] * fwd[1] + d[2] * fwd[2] < 0) d = [-d[0], -d[1], -d[2]];
    const origin = cam.isOrthographicCamera ? [p0[0] - d[0] * 1e4, p0[1] - d[1] * 1e4, p0[2] - d[2] * 1e4] : camPos(cam);
    return { o: origin, d };
  }

  // ---- picking ----
  function pathOf(o) {
    const parts = [];
    for (let p = o; p && p !== scene; p = p.parent) parts.push(p.name || `<${p.type}>`);
    return parts.reverse().join(' > ') || '<scene>';
  }
  function pickable(h) {
    for (let o = h.object; o; o = o.parent) if (!o.visible || o.userData?.scenemarkIgnore) return false;
    const m = h.material;
    if (m && (m.visible === false || m.colorWrite === false || (m.transparent && m.opacity < 0.05))) return false;
    return opts.ignore ? !opts.ignore(h.object) : true;
  }

  function pick(clientX, clientY) {
    if (opts.pick) return { hit: null, custom: opts.pick(clientX, clientY) ?? null, behind: [] };
    const cam = getCam();
    if (!scene || !cam) return { hit: null, behind: [] };
    scene.updateMatrixWorld?.();
    cam.updateMatrixWorld?.();
    const { o, d } = rayAt(clientX, clientY, cam), fwd = camForward(cam), cp = camPos(cam);
    const hits = [];
    const visit = obj => {
      if (!obj.visible || obj.userData?.scenemarkIgnore) return;
      if (obj.isMesh && (!obj.layers?.test || !cam.layers || obj.layers.test(cam.layers))) {
        try {
          const h = raycastMesh(obj, o, d);
          if (h && (h.point[0] - cp[0]) * fwd[0] + (h.point[1] - cp[1]) * fwd[1] + (h.point[2] - cp[2]) * fwd[2] > 0) {
            h.distance = Math.hypot(h.point[0] - cp[0], h.point[1] - cp[1], h.point[2] - cp[2]);
            hits.push(h);
          }
        } catch { /* unpickable mesh */ }
      }
      for (const c of obj.children) visit(c);
    };
    visit(scene);
    hits.sort((a, b) => a.distance - b.distance);
    const ok = hits.filter(pickable);
    if (!ok.length) return { hit: null, behind: [] };
    const seen = new Set([ok[0].object]), behind = [];
    for (const h of ok.slice(1)) {
      if (seen.has(h.object)) continue;
      seen.add(h.object); behind.push(pathOf(h.object));
      if (behind.length >= 3) break;
    }
    return { hit: ok[0], behind };
  }

  function userDataOf(ud) {
    if (!ud || !Object.keys(ud).length) return null;
    try { const s = JSON.stringify(ud); return s.length > 400 ? s.slice(0, 400) + '…' : JSON.parse(s); } catch { return '(unserializable)'; }
  }
  function describe(hit, behind = []) {
    const o = hit.object, mat = hit.material, W = o.matrixWorld.elements;
    return {
      path: pathOf(o), name: o.name || null, type: o.type, uuid: o.uuid, instanceId: hit.instanceId ?? null,
      geometry: o.geometry ? { type: o.geometry.type, vertices: o.geometry.attributes?.position?.count ?? null } : null,
      material: mat ? {
        name: mat.name || null, type: mat.type, color: mat.color?.getHexString ? '#' + mat.color.getHexString() : null,
        map: mat.map ? (mat.map.name || '(unnamed texture)') : null, transparent: !!mat.transparent, opacity: mat.opacity,
      } : null,
      userData: userDataOf(o.userData),
      worldPosition: rv([W[12], W[13], W[14]]),
      point: rv(hit.point), normal: hit.normal ? rv(hit.normal) : null,
      uv: hit.uv ? rv(hit.uv) : null, distance: r3(hit.distance), alsoUnderCursor: behind,
    };
  }

  function poseOf(cam) {
    if (!cam?.matrixWorld) return null;
    const q = cam.quaternion;
    return {
      type: cam.type, position: rv(camPos(cam)), quaternion: q ? rv([q.x, q.y, q.z, q.w]) : null,
      direction: rv(camForward(cam)), fov: cam.fov ?? null, zoom: cam.zoom ?? 1, near: cam.near, far: cam.far,
      controlsTarget: controls?.target ? rv([controls.target.x, controls.target.y, controls.target.z]) : null,
    };
  }

  // ---- screenshots ----
  const drawMarked = (px, py) => {
    const rect = canvas.getBoundingClientRect(), sx = canvas.width / rect.width;
    const scale = Math.min(1, 1280 / canvas.width);
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * scale); c.height = Math.round(canvas.height * scale);
    const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0, c.width, c.height);
    const x = px * sx * scale, y = py * sx * scale, rad = 14 * scale * Math.max(1, sx);
    g.lineWidth = 3; g.strokeStyle = '#ef4444'; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, y, rad + 2, 0, Math.PI * 2); g.stroke();
    return c.toDataURL('image/jpeg', 0.85);
  };
  /** Resolves a JPEG data URL (or null). Prefers an explicit render(); else grabs the page's own next frame. */
  function snapshot(px, py) {
    return new Promise(resolve => {
      const fin = () => { try { resolve(drawMarked(px, py)); } catch { resolve(null); } };
      if (opts.render) { try { opts.render(); } catch { /* fall through */ } return fin(); }
      let done = false;
      const timer = setTimeout(() => { // page not redrawing: force one frame if we can, else take what is there
        if (done) return; done = true;
        try { const cam = getCam(); if (renderer && scene && cam) renderer.render(scene, cam); } catch { /* ignore */ }
        fin();
      }, 400);
      afterFrame.push(() => {
        if (done) return;
        if (isBlank(canvas)) { afterFrame.push(() => { if (!done) { done = true; clearTimeout(timer); fin(); } }); return; }
        done = true; clearTimeout(timer); fin();
      });
    });
  }

  // ---- notes ----
  function save() {
    try { localStorage.setItem(storeKey, JSON.stringify(notes.map(({ image, ...n }) => n))); } catch { /* quota */ }
    countEl.textContent = String(notes.length);
    renderPins();
  }
  async function http(method, path, body) {
    if (!endpoint) return null;
    try {
      const res = await fetch(endpoint + path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      setConnected(res.ok);
      return res.ok ? await res.json() : null;
    } catch { setConnected(false); return null; }
  }
  function setConnected(v) { connected = v; dot.classList.toggle('ok', v); dot.title = v ? 'Receiver connected: ' + endpoint : 'Receiver offline (use Copy)'; }
  http('GET', '/health');
  async function sync(note) {
    const res = await http('POST', '/notes', note);
    if (res?.shot) { note.shot = res.shot; delete note.image; save(); }
  }

  function annotate(clientX, clientY, text, preHit) {
    const rect = canvas.getBoundingClientRect();
    const picked = preHit ?? pick(clientX, clientY);
    const px = Math.round(clientX - rect.left), py = Math.round(clientY - rect.top);
    const note = {
      id: uid(), text, createdAt: new Date().toISOString(), url: location.href, title: document.title,
      viewport: { w: Math.round(rect.width), h: Math.round(rect.height), dpr: devicePixelRatio },
      pixel: { x: px, y: py }, canvas: canvasSelector(canvas),
      target: picked.hit ? describe(picked.hit, picked.behind) : (picked.custom ?? null),
      camera: poseOf(getCam()),
      image: null,
    };
    notes.push(note); save();
    snapshot(px, py).then(img => { note.image = img; sync(note); });
    return note;
  }
  const remove = id => { notes = notes.filter(n => n.id !== id); save(); http('DELETE', '/notes/' + id); };
  const clear = () => { notes = []; save(); http('DELETE', '/notes'); };
  function goto(id) {
    const n = notes.find(x => x.id === id), cam = getCam(), c = n?.camera;
    if (!n || !cam || !c?.quaternion) return false;
    cam.position.set(...c.position); cam.quaternion.set(...c.quaternion);
    if (c.fov != null && 'fov' in cam) { cam.fov = c.fov; cam.updateProjectionMatrix?.(); }
    if (controls?.target && c.controlsTarget) { controls.target.set(...c.controlsTarget); controls.update?.(); }
    cam.updateMatrixWorld?.(true);
    return true;
  }

  // ---- markdown for agents ----
  function toMarkdown() {
    const out = [`## 3D scene feedback (${notes.length} note${notes.length === 1 ? '' : 's'})`, `Page: ${location.href}`, ''];
    notes.forEach((n, i) => {
      out.push(`### ${i + 1}. ${n.text || '(no text)'}`);
      const t = n.target;
      if (t?.type && t.uuid) {
        out.push(`- Object: \`${t.path}\` (${t.type}${t.instanceId != null ? `, instance ${t.instanceId}` : ''}${t.geometry ? `, ${t.geometry.type}, ${t.geometry.vertices ?? '?'} verts` : ''})`);
        if (t.material) out.push(`- Material: ${t.material.name ? '`' + t.material.name + '` ' : ''}${t.material.type}${t.material.color ? ' ' + t.material.color : ''}${t.material.map ? ', map ' + t.material.map : ''}`);
        out.push(`- Hit point (world): (${t.point.join(', ')})${t.normal ? `, normal (${t.normal.join(', ')})` : ''}${t.uv ? `, uv (${t.uv.join(', ')})` : ''}, ${t.distance} from camera`);
        out.push(`- Object origin (world): (${t.worldPosition.join(', ')})`);
        if (t.userData) out.push(`- userData: \`${typeof t.userData === 'string' ? t.userData : JSON.stringify(t.userData)}\``);
        if (t.alsoUnderCursor?.length) out.push(`- Also under cursor (behind): ${t.alsoUnderCursor.map(p => '`' + p + '`').join(', ')}`);
      } else if (t) out.push(`- Target (engine pick): \`${JSON.stringify(t)}\``);
      else out.push(scene || opts.pick ? '- Object: none (clicked empty space / sky)' : '- Object: not resolvable (scene not accessible); see screenshot and pixel');
      const c = n.camera;
      if (c) out.push(`- Camera: pos (${c.position.join(', ')}), looking (${c.direction.join(', ')})${c.fov != null ? `, fov ${c.fov}` : ''}${c.controlsTarget ? `, target (${c.controlsTarget.join(', ')})` : ''}`);
      out.push(`- Viewport: ${n.viewport.w}x${n.viewport.h} @${n.viewport.dpr}x on \`${n.canvas}\`, click at (${n.pixel.x}, ${n.pixel.y})`);
      if (n.shot) out.push(`- Screenshot: ${n.shot}`);
      out.push('');
    });
    return out.join('\n');
  }
  async function copy() {
    const text = toMarkdown();
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ } ta.remove();
    }
    toast(`Copied ${notes.length} note${notes.length === 1 ? '' : 's'}${connected ? ' (also on disk)' : ''}`);
    return text;
  }

  // ---- popover ----
  const closePop = () => { pop?.remove(); pop = null; };
  function openPop(x, y, { label, text = '', onSave, onDelete, onView }) {
    closePop();
    pop = document.createElement('div'); pop.className = 'pop'; pop.style.pointerEvents = 'auto';
    pop.innerHTML = `<div class="tgt">${esc(label)}</div><textarea placeholder="What should change here?"></textarea>
      <div class="row">${onDelete ? '<button class="del">Delete</button>' : ''}${onView ? '<button data-v>View</button>' : ''}<button data-c>Cancel</button><button class="pri" data-s>Save</button></div>`;
    root.appendChild(pop);
    const ta = pop.querySelector('textarea'); ta.value = text;
    pop.style.left = Math.max(8, Math.min(innerWidth - 316, x + 14)) + 'px';
    pop.style.top = Math.max(8, Math.min(innerHeight - 190, y + 14)) + 'px';
    for (const t of ['pointerdown', 'mousedown', 'click', 'wheel']) pop.addEventListener(t, e => e.stopPropagation());
    const finish = save => { const v = ta.value.trim(); closePop(); if (save) onSave(v); };
    pop.querySelector('[data-s]').onclick = () => finish(true);
    pop.querySelector('[data-c]').onclick = () => finish(false);
    if (onDelete) pop.querySelector('.del').onclick = () => { closePop(); onDelete(); };
    if (onView) pop.querySelector('[data-v]').onclick = () => onView();
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') finish(false);
      else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true);
    });
    ta.focus(); rawRaf(() => ta.focus());
  }

  // ---- pins ----
  function renderPins() {
    pinLayer.innerHTML = '';
    notes.forEach((n, i) => {
      const p = document.createElement('div');
      p.className = 'pin' + (n.target?.point && n.camera ? '' : ' miss'); p.textContent = String(i + 1); p.dataset.id = n.id;
      p.title = n.text; p.style.pointerEvents = 'auto'; p.style.display = pinsVisible ? 'flex' : 'none';
      for (const t of ['pointerdown', 'mousedown']) p.addEventListener(t, e => e.stopPropagation());
      p.addEventListener('click', e => {
        e.stopPropagation();
        const rect = p.getBoundingClientRect();
        openPop(rect.left, rect.top, {
          label: `#${i + 1} ${n.target?.path ?? '(no object)'}`, text: n.text,
          onSave: v => { n.text = v; save(); sync(n); }, onDelete: () => remove(n.id), onView: () => goto(n.id),
        });
      });
      pinLayer.appendChild(p);
    });
  }
  function tick() {
    raf = rawRaf(tick);
    if (!pinsVisible || !notes.length) return;
    const cam = getCam(), rect = canvas.getBoundingClientRect();
    for (const el of pinLayer.children) {
      const n = notes.find(x => x.id === el.dataset.id); if (!n) continue;
      const w = n.target?.point;
      if (!w || !cam?.matrixWorldInverse) { // no 3D anchor: pin at the original screen position
        el.style.transform = `translate(${rect.left + n.pixel.x * (rect.width / n.viewport.w)}px,${rect.top + n.pixel.y * (rect.height / n.viewport.h)}px)`;
        continue;
      }
      const v = pt4(cam.matrixWorldInverse.elements, w[0], w[1], w[2]);
      if (v[2] >= 0) { el.style.transform = 'translate(-9999px,-9999px)'; continue; }
      const s = pt4(cam.projectionMatrix.elements, v[0], v[1], v[2]);
      el.style.transform = `translate(${rect.left + (s[0] * 0.5 + 0.5) * rect.width}px,${rect.top + (-s[1] * 0.5 + 0.5) * rect.height}px)`;
    }
  }

  // ---- mode + input ----
  function setActive(v) {
    active = v; btn('mark').classList.toggle('on', v);
    canvas.style.cursor = v ? 'crosshair' : '';
    if (v && document.pointerLockElement) document.exitPointerLock();
    if (!v) closePop();
    opts.onModeChange?.(v);
  }
  const onDown = e => { down = { x: e.clientX, y: e.clientY }; };
  const INTERACTIVE = 'button,a,input,select,textarea,label,[role=button],[contenteditable=true]';
  // Only `click` is swallowed, so drags (orbit) still reach the page; a click that moved is a drag.
  const onClick = e => {
    if (!active) return;
    if (e.composedPath().includes(host)) return; // clicks on our own toolbar, popover and pins (shadow DOM retargets e.target to the host)
    const rect = canvas.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside || (e.target !== canvas && e.target.closest?.(INTERACTIVE))) return;
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const picked = pick(e.clientX, e.clientY);
    const label = picked.hit ? pathOf(picked.hit.object) : picked.custom?.path ?? (scene || opts.pick ? '(empty space)' : `pixel ${Math.round(e.clientX - rect.left)},${Math.round(e.clientY - rect.top)}`);
    openPop(e.clientX, e.clientY, { label, onSave: v => annotate(e.clientX, e.clientY, v || '(no text)', picked) });
  };
  const onKey = e => {
    if (e.shiftKey && e.code === (opts.hotkey ?? 'KeyM') && !/INPUT|TEXTAREA/.test(e.target?.tagName ?? '')) {
      e.preventDefault(); setActive(!active);
    } else if (e.key === 'Escape' && active && !pop) setActive(false);
  };
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKey, true);
  btn('mark').onclick = () => setActive(!active);
  btn('copy').onclick = copy;
  btn('pins').onclick = () => { pinsVisible = !pinsVisible; btn('pins').classList.toggle('on', !pinsVisible); renderPins(); };
  btn('clear').onclick = () => { if (!notes.length || confirm(`Delete all ${notes.length} notes?`)) clear(); };
  save(); raf = rawRaf(tick);

  const api = {
    enable: () => setActive(true), disable: () => setActive(false), toggle: () => setActive(!active),
    /** Raycast at client pixel coords; returns { hit, behind } (hit = { object, point, normal, uv, distance, instanceId, material }). */
    pick,
    /** Programmatic note at client pixel coords (for agents driving the page). */
    annotateAt: (x, y, text = '') => annotate(x, y, text),
    /** Programmatic note on a specific three.js object, anchored at its first mesh's world bounding-sphere centre. */
    annotateObject(obj, text = '') {
      const cam = getCam(), rect = canvas.getBoundingClientRect();
      obj.updateWorldMatrix?.(true, true);
      let c = null;
      obj.traverse(m => {
        if (c || !m.isMesh || !m.geometry) return;
        if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere?.();
        const b = m.geometry.boundingSphere; if (b) c = pt4(m.matrixWorld.elements, b.center.x, b.center.y, b.center.z);
      });
      c ??= [obj.matrixWorld.elements[12], obj.matrixWorld.elements[13], obj.matrixWorld.elements[14]];
      const v = pt4(cam.matrixWorldInverse.elements, c[0], c[1], c[2]), s = pt4(cam.projectionMatrix.elements, v[0], v[1], v[2]);
      const cx = rect.left + (s[0] * 0.5 + 0.5) * rect.width, cy = rect.top + (-s[1] * 0.5 + 0.5) * rect.height;
      const cp = camPos(cam);
      const hit = { object: obj, point: c, normal: null, uv: null, instanceId: null, material: obj.material, distance: Math.hypot(c[0] - cp[0], c[1] - cp[1], c[2] - cp[2]) };
      return annotate(cx, cy, text, { hit, behind: [] });
    },
    list: () => notes.map(({ image, ...n }) => n), remove, clear, goto, toMarkdown, copy,
    get active() { return active; }, get connected() { return connected; }, canvas,
    destroy() {
      cancelAnimationFrame(raf); host.remove();
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('click', onClick, true); window.removeEventListener('keydown', onKey, true);
      canvas.style.cursor = ''; delete window.__scenemark;
    },
  };
  window.__scenemark = api;
  return api;
}

/** Babylon.js adapter: picks through the engine's own scene.pick. */
function babylonOptions() {
  const B = window.BABYLON, eng = B?.Engine?.LastCreatedEngine ?? B?.EngineStore?.LastCreatedEngine;
  const scene = eng?.scenes?.[0] ?? B?.EngineStore?.LastCreatedScene;
  const canvas = eng?.getRenderingCanvas?.();
  if (!scene || !canvas) return null;
  return {
    canvas,
    pick: (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      const p = scene.pick(cx - r.left, cy - r.top);
      if (!p?.hit || !p.pickedMesh) return null;
      const pp = p.pickedPoint;
      return { engine: 'babylon', path: p.pickedMesh.name, type: p.pickedMesh.getClassName?.() ?? 'Mesh', id: p.pickedMesh.id, point: pp ? [r3(pp.x), r3(pp.y), r3(pp.z)] : null, material: p.pickedMesh.material?.name ?? null };
    },
  };
}

/**
 * Attach to whatever 3D view the page has, without being handed any objects.
 * three.js: finds the renderer (and the scene/camera it renders) via window globals, A-Frame, or the
 * __THREE_DEVTOOLS__ hook, then learns the real scene + camera from the page's own render() calls.
 * Babylon: uses scene.pick. Otherwise: screenshot + pixel + canvas info only.
 * Resolves to the scenemark API.
 */
export async function autoAttachSceneMark(opts = {}) {
  const f = discover();
  const o = { ...opts };
  const renderer = opts.renderer ?? [...f.renderers].sort((a, b) => area(b.domElement) - area(a.domElement))[0] ?? null;
  if (renderer) {
    o.renderer = renderer;
    let lastScene = opts.scene ?? null, lastCam = typeof opts.camera === 'function' ? opts.camera() : (opts.camera ?? null);
    if (!renderer.__scenemarkWrapped) {
      const orig = renderer.render;
      renderer.render = function (s, c) { lastScene = s; lastCam = c; return orig.apply(this, arguments); };
      renderer.__scenemarkWrapped = true;
    }
    const t0 = performance.now();
    while (!(lastScene && lastCam) && performance.now() - t0 < 3000) await new Promise(r => setTimeout(r, 50));
    o.scene = lastScene ?? [...f.scenes][0] ?? null;
    o.camera = () => lastCam ?? [...f.cameras][0] ?? null;
  } else if (window.BABYLON) {
    Object.assign(o, babylonOptions() ?? {});
  }
  return attachSceneMark(o);
}
