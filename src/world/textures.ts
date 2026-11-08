// Procedural canvas textures, so the game ships without binary texture assets.
// Facade textures cover one bay x one storey and come with a matching
// roughness/metalness map (G = roughness, B = metalness) so glass reflects
// the sky while masonry stays matte.
import * as THREE from 'three';
import { drawBrick } from './photos.ts';

let seed = 1;
function rand() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: number[], amp: number, count: number, size = 2) {
  g.fillStyle = `rgb(${base.join(',')})`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const d = (rand() - 0.5) * amp;
    g.fillStyle = `rgb(${base.map(v => Math.max(0, Math.min(255, v + d))).join(',')})`;
    g.fillRect(rand() * w, rand() * h, size, size);
  }
}

export interface FacadeStyle {
  /** Bay width and storey height in meters that one texture tile covers. */
  bay: number;
  storey: number;
  map: THREE.Texture;
  orm: THREE.Texture;
  /** Flat-roof color (sRGB 0-1), used when the roof is not pitched. */
  roof: number[];
  pitched?: boolean;
  /** Vertex-color tint variation between buildings of this style. */
  tint: number;
}

interface Win { x0: number; x1: number; y0: number; y1: number; glass: string; frame: string; mullions?: number; transoms?: number; frameW?: number }

/** Draws the same layout into the color canvas and the roughness/metalness canvas. */
type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;
/** `over` draws on top of the windows (fins, louvers); `overOrm` is its roughness/metal mask. */
function facade(px: number, bay: number, storey: number, wall: Draw, wins: Win[], wallRough = 0.85, over?: Draw, overOrm?: Draw) {
  const w = px, h = Math.round(px * storey / bay);
  const drawWins = (g: CanvasRenderingContext2D, orm: boolean) => {
    for (const o of wins) {
      const X0 = o.x0 * w, X1 = o.x1 * w, Y0 = (1 - o.y1) * h, Y1 = (1 - o.y0) * h;
      const fw = (o.frameW ?? 0.012) * w;
      g.fillStyle = orm ? 'rgb(0,128,200)' : o.frame;
      g.fillRect(X0 - fw, Y0 - fw, X1 - X0 + 2 * fw, Y1 - Y0 + 2 * fw);
      if (orm) g.fillStyle = 'rgb(0,18,30)';
      else {
        const gr = g.createLinearGradient(0, Y0, 0, Y1);
        gr.addColorStop(0, o.glass);
        gr.addColorStop(1, shade(o.glass, 0.55));
        g.fillStyle = gr;
      }
      g.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
      g.fillStyle = orm ? 'rgb(0,128,200)' : o.frame;
      for (let k = 1; k < (o.mullions ?? 1); k++) g.fillRect(X0 + (X1 - X0) * k / (o.mullions ?? 1) - fw / 2, Y0, fw, Y1 - Y0);
      for (let k = 1; k < (o.transoms ?? 1); k++) g.fillRect(X0, Y0 + (Y1 - Y0) * k / (o.transoms ?? 1) - fw / 2, X1 - X0, fw);
    }
  };
  const map = canvas(w, h, (g) => { wall(g, w, h); drawWins(g, false); over?.(g, w, h); });
  const orm = canvas(w, h, (g) => {
    const r = Math.round(wallRough * 255);
    g.fillStyle = `rgb(0,${r},0)`;
    g.fillRect(0, 0, w, h);
    drawWins(g, true);
    overOrm?.(g, w, h);
  }, false);
  return { map, orm };
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(v * f));
  return `rgb(${c.join(',')})`;
}

function hLines(g: CanvasRenderingContext2D, w: number, h: number, every: number, color: string, thick = 1) {
  g.fillStyle = color;
  for (let y = 0; y < h; y += every) g.fillRect(0, y, w, thick);
}

let styles: Record<string, FacadeStyle> | null = null;
export function facadeStyles(): Record<string, FacadeStyle> {
  if (styles) return styles;
  seed = 7;
  const mk = (bay: number, storey: number, roof: number[], tint: number, f: ReturnType<typeof facade>, pitched = false): FacadeStyle => ({ bay, storey, roof, tint, pitched, ...f });
  styles = {
    // 1970s-80s UT Dallas core: tan precast concrete with deep ribbon windows.
    precast: mk(6, 4.2, [0.72, 0.62, 0.48], 0.08, facade(256, 6, 4.2, (g, w, h) => {
      speckle(g, w, h, [205, 186, 152], 14, 3000, 2);
      hLines(g, w, h, Math.round(h / 6), 'rgba(90,70,40,0.10)');
      g.fillStyle = 'rgba(60,45,25,0.25)';
      g.fillRect(0, h * 0.24, w, h * 0.03);
    }, [{ x0: 0.0, x1: 1.0, y0: 0.36, y1: 0.7, glass: '#5b6670', frame: '#5b4e3d', mullions: 4, frameW: 0.01 }])),
    // Post-2000 buildings: white and light-gray panels with blue-green curtain wall.
    modern: mk(3, 4.2, [0.86, 0.87, 0.86], 0.05, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [232, 233, 230], 8, 1500, 2);
      // Metal panel joints and a deep spandrel between glass bands.
      hLines(g, w, h, Math.round(h / 4), 'rgba(0,0,0,0.07)');
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(0, 0, 2, h);
    }, [{ x0: 0.0, x1: 1.0, y0: 0.3, y1: 0.82, glass: '#4d6577', frame: '#9aa2a8', mullions: 2, frameW: 0.012 }], 0.6)),
    darkModern: mk(3.2, 3.3, [0.88, 0.88, 0.87], 0.04, facade(256, 3.2, 3.3, (g, w, h) => {
      speckle(g, w, h, [78, 82, 88], 10, 1500, 2);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, w * 0.03, h);
    }, [{ x0: 0.22, x1: 0.78, y0: 0.25, y1: 0.85, glass: '#536676', frame: '#e8e8e6', mullions: 2, frameW: 0.02 }], 0.7)),
    // Residence halls: cream stucco, paired punched windows, gray pitched roofs.
    hall: mk(3.6, 3.2, [0.45, 0.47, 0.5], 0.04, facade(256, 3.6, 3.2, (g, w, h) => {
      speckle(g, w, h, [232, 226, 212], 10, 2500, 2);
      g.fillStyle = 'rgba(120,100,80,0.10)';
      g.fillRect(0, h * 0.96, w, h * 0.04);
    }, [{ x0: 0.24, x1: 0.76, y0: 0.3, y1: 0.82, glass: '#4b5a67', frame: '#f4f3ef', mullions: 2, transoms: 2, frameW: 0.02 }]), true),
    // University Village apartments: beige lap siding, white-trimmed windows, gray hip roofs.
    village: mk(4.4, 3.0, [0.42, 0.44, 0.46], 0.07, facade(256, 4.4, 3.0, (g, w, h) => {
      speckle(g, w, h, [214, 198, 172], 10, 2500, 2);
      hLines(g, w, h, 6, 'rgba(70,50,30,0.16)', 2);
    }, [{ x0: 0.32, x1: 0.68, y0: 0.3, y1: 0.82, glass: '#46525e', frame: '#f6f4ee', mullions: 2, transoms: 2, frameW: 0.022 }]), true),
    house: mk(5, 3.0, [0.4, 0.38, 0.36], 0.12, facade(256, 5, 3.0, (g, w, h) => {
      speckle(g, w, h, [178, 128, 98], 26, 6000, 2);
      g.fillStyle = 'rgba(230,220,205,0.35)';
      for (let y = 0; y < h; y += 5) for (let x = (y / 5) % 2 ? 0 : 9; x < w; x += 18) g.fillRect(x, y, 1, 5);
      hLines(g, w, h, 5, 'rgba(235,225,210,0.45)');
    }, [{ x0: 0.35, x1: 0.65, y0: 0.3, y1: 0.8, glass: '#3f4a55', frame: '#f2efe8', mullions: 2, transoms: 2, frameW: 0.02 }]), true),
    garage: mk(8, 3.2, [0.55, 0.55, 0.54], 0.03, facade(256, 8, 3.2, (g, w, h) => {
      speckle(g, w, h, [190, 189, 184], 12, 2500, 2);
      g.fillStyle = '#2a2c2e';
      g.fillRect(0, h * 0.06, w, h * 0.5);
      g.fillStyle = '#bdbcb7';
      g.fillRect(0, h * 0.06, w * 0.05, h * 0.5);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fillRect(0, h * 0.54, w, h * 0.02);
    }, [])),
    metal: mk(6, 4, [0.72, 0.74, 0.76], 0.04, facade(256, 6, 4, (g, w, h) => {
      speckle(g, w, h, [196, 200, 203], 8, 1200, 2);
      for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 3, 0, 1, h); }
    }, [{ x0: 0.42, x1: 0.58, y0: 0.45, y1: 0.75, glass: '#4b5865', frame: '#8a9096' }], 0.55)),
    office: mk(4, 4, [0.7, 0.7, 0.68], 0.1, facade(256, 4, 4, (g, w, h) => {
      speckle(g, w, h, [186, 160, 132], 14, 2500, 2);
    }, [{ x0: 0.1, x1: 0.9, y0: 0.3, y1: 0.78, glass: '#5f7486', frame: '#4a4a4a', mullions: 3 }])),
    construction: mk(6, 4.2, [0.6, 0.6, 0.58], 0.0, facade(256, 6, 4.2, (g, w, h) => {
      speckle(g, w, h, [168, 166, 160], 16, 2500, 2);
      g.fillStyle = '#3a3b3c';
      g.fillRect(w * 0.06, h * 0.1, w * 0.88, h * 0.75);
      g.fillStyle = 'rgba(230,110,30,0.55)';
      g.fillRect(w * 0.06, h * 0.55, w * 0.88, h * 0.12);
    }, [])),
    greenhouse: mk(3, 3, [0.9, 0.92, 0.9], 0.0, facade(128, 3, 3, (g, w, h) => {
      speckle(g, w, h, [215, 222, 220], 6, 400, 2);
    }, [{ x0: 0.03, x1: 0.97, y0: 0.03, y1: 0.97, glass: '#a9bcbc', frame: '#e9ece9', mullions: 3, transoms: 2 }], 0.3)),
    shed: mk(4, 3, [0.45, 0.45, 0.45], 0.08, facade(128, 4, 3, (g, w, h) => {
      speckle(g, w, h, [205, 196, 180], 10, 800, 2);
      hLines(g, w, h, 5, 'rgba(0,0,0,0.12)');
    }, [])),
    // ---- Building-specific looks, matched to reference photos of each building ----
    // Tan exposed-aggregate concrete with deep punched windows (Green Hall, Berkner, JO, Administration).
    precastPunched: mk(3.6, 4.0, [0.72, 0.62, 0.48], 0.06, facade(256, 3.6, 4.0, (g, w, h) => {
      speckle(g, w, h, [204, 184, 146], 22, 5000, 2);
      g.fillStyle = 'rgba(70,50,25,0.45)'; g.fillRect(w * 0.2, h * 0.16, w * 0.6, h * 0.54);
    }, [{ x0: 0.25, x1: 0.75, y0: 0.34, y1: 0.8, glass: '#3e4650', frame: '#3a3128', mullions: 2, frameW: 0.01 }])),
    // White concrete with tall vertical fins over full-height glass (Founders).
    finsWhite: mk(1.8, 4.2, [0.86, 0.86, 0.85], 0.02, facade(256, 1.8, 4.2, (g, w, h) => {
      speckle(g, w, h, [232, 232, 228], 8, 1500, 2);
    }, [{ x0: 0.0, x1: 1.0, y0: 0.06, y1: 0.97, glass: '#56707f', frame: '#c8ccce', transoms: 2, frameW: 0.01 }], 0.6, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w * 0.22, 0);
      gr.addColorStop(0, '#f4f4f1'); gr.addColorStop(1, '#c9cac6');
      g.fillStyle = gr; g.fillRect(0, 0, w * 0.22, h);
    }, (g, w, h) => { g.fillStyle = 'rgb(0,200,0)'; g.fillRect(0, 0, w * 0.22, h); })),
    // Blue-violet tile with teal glass bays (NSERL).
    nserl: mk(3, 4.2, [0.8, 0.82, 0.84], 0.04, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [78, 80, 168], 14, 2500, 2);
      g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
      for (let x = 0; x < w; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
      for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    }, [{ x0: 0.1, x1: 0.9, y0: 0.22, y1: 0.88, glass: '#3d8f99', frame: '#c7ccd0', mullions: 3, transoms: 2 }], 0.5)),
    // Full-height curtain wall framed by beige stone (BSB).
    glassStone: mk(3, 4.2, [0.84, 0.84, 0.82], 0.03, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [216, 204, 180], 10, 2000, 2);
    }, [{ x0: 0.04, x1: 0.96, y0: 0.1, y1: 0.95, glass: '#3b5568', frame: '#8d969c', mullions: 3, transoms: 2, frameW: 0.008 }], 0.5)),
    // Dark blue-gray glass behind light metal louvers (Arts & Technology).
    atec: mk(3, 4.2, [0.55, 0.58, 0.62], 0.02, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [88, 104, 124], 10, 1500, 2);
    }, [{ x0: 0.0, x1: 1.0, y0: 0.05, y1: 0.98, glass: '#2c3d50', frame: '#53606e', mullions: 3 }], 0.5, (g, w, h) => {
      g.fillStyle = 'rgba(200,206,212,0.55)';
      for (let y = 0; y < h; y += 10) g.fillRect(0, y, w, 3);
    })),
    // Beige limestone with large punched windows (Sciences Building).
    sciences: mk(3.4, 4.2, [0.84, 0.82, 0.78], 0.03, facade(256, 3.4, 4.2, (g, w, h) => {
      speckle(g, w, h, [217, 205, 182], 10, 2500, 2);
      hLines(g, w, h, Math.round(h / 5), 'rgba(90,80,60,0.18)');
    }, [{ x0: 0.18, x1: 0.82, y0: 0.28, y1: 0.86, glass: '#4b6070', frame: '#6c6c66', mullions: 2 }])),
    // Beige stone and a blue glass mosaic (Science Learning Center).
    slc: mk(3, 4.2, [0.84, 0.84, 0.82], 0.03, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [214, 203, 184], 10, 2000, 2);
    }, [], 0.6, (g, w, h) => {
      const blues = ['#1f4fb6', '#2d66d1', '#5a86df', '#173c8f', '#7c9fe6', '#2a5cc4'];
      for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
        g.fillStyle = blues[Math.floor(rand() * blues.length)];
        g.fillRect(w * (0.05 + x * 0.15), h * (0.08 + y * 0.15), w * 0.145, h * 0.145);
      }
    }, (g, w, h) => { g.fillStyle = 'rgb(0,40,90)'; g.fillRect(w * 0.05, h * 0.08, w * 0.9, h * 0.9); })),
    // White panels, glass and white horizontal sun louvers (Student Services Building).
    ssb: mk(3, 4.2, [0.88, 0.88, 0.87], 0.02, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [236, 238, 237], 6, 1200, 2);
    }, [{ x0: 0.03, x1: 0.97, y0: 0.14, y1: 0.92, glass: '#6f93a8', frame: '#dde2e4', mullions: 2 }], 0.5, (g, w, h) => {
      g.fillStyle = 'rgba(246,247,246,0.9)';
      for (let y = h * 0.1; y < h * 0.9; y += h * 0.07) g.fillRect(0, y, w, 3);
    })),
    // Charcoal frame around full-height blue glass (SSB Addition).
    ssbAdd: mk(3, 4.2, [0.4, 0.42, 0.44], 0.02, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [74, 77, 82], 8, 1200, 2);
    }, [{ x0: 0.02, x1: 0.98, y0: 0.04, y1: 0.96, glass: '#2c5b8a', frame: '#3a3d42', mullions: 2, transoms: 2 }], 0.4)),
    // Gray vertical metal fins with an orange accent (Callier Center Richardson addition).
    callierAdd: mk(2, 4.2, [0.7, 0.72, 0.74], 0.02, facade(256, 2, 4.2, (g, w, h) => {
      speckle(g, w, h, [150, 156, 160], 8, 1200, 2);
    }, [{ x0: 0.0, x1: 1.0, y0: 0.05, y1: 0.45, glass: '#3e5363', frame: '#55606a', mullions: 2 }], 0.5, (g, w, h) => {
      for (let x = 0; x < w; x += 18) { g.fillStyle = 'rgba(205,210,214,0.95)'; g.fillRect(x, 0, 7, h * 0.55); }
      g.fillStyle = '#e2552a'; g.fillRect(0, h * 0.56, w, h * 0.05);
    })),
    // Dark gray ribbed metal over a stone base (Facilities Management).
    metalDark: mk(5, 4, [0.62, 0.64, 0.66], 0.03, facade(256, 5, 4, (g, w, h) => {
      speckle(g, w, h, [70, 73, 78], 8, 1200, 2);
      for (let y = 0; y < h; y += 6) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(0, y, w, 2); }
      g.fillStyle = '#cfc2a8'; g.fillRect(0, h * 0.82, w, h * 0.18);
    }, [{ x0: 0.42, x1: 0.58, y0: 0.4, y1: 0.66, glass: '#3c4954', frame: '#e8e8e6', frameW: 0.02 }], 0.5)),
    // Parking structure wrapped in silver vertical fins (Parking Structure 4).
    garageFins: mk(2, 3.2, [0.55, 0.55, 0.54], 0.02, facade(256, 2, 3.2, (g, w, h) => {
      // Open between the fins (alpha-tested): the decks behind show through.
      g.clearRect(0, 0, w, h);
    }, [], 0.5, (g, w, h) => {
      for (let x = 0; x < w; x += 20) {
        const gr = g.createLinearGradient(x, 0, x + 8, 0);
        gr.addColorStop(0, '#e6e9ec'); gr.addColorStop(1, '#9ea4aa');
        g.fillStyle = gr; g.fillRect(x, 0, 8, h);
      }
    }, (g, w, h) => { for (let x = 0; x < w; x += 20) { g.fillStyle = 'rgb(0,90,220)'; g.fillRect(x, 0, 8, h); } })),
    // Red brick with punched windows (Waterview Science and Technology Center).
    brickRed: mk(4, 3.8, [0.55, 0.55, 0.54], 0.06, facade(1024, 4, 3.8, (g, w, h) => {
      if (drawBrick(g, w, h, 'brick_red', 4, 3.8)) return;
      speckle(g, w, h, [142, 74, 56], 26, 6000, 2);
      g.fillStyle = 'rgba(220,210,195,0.35)';
      for (let y = 0; y < h; y += 5) g.fillRect(0, y, w, 1);
    }, [{ x0: 0.3, x1: 0.7, y0: 0.3, y1: 0.8, glass: '#2f3a44', frame: '#d8d2c6', mullions: 2 }])),
    // White bands with continuous dark ribbon glass (Synergy Park, Research and Operations).
    officeBands: mk(4, 4, [0.78, 0.78, 0.76], 0.03, facade(256, 4, 4, (g, w, h) => {
      speckle(g, w, h, [236, 234, 228], 8, 1200, 2);
    }, [{ x0: 0.0, x1: 1.0, y0: 0.3, y1: 0.78, glass: '#262d36', frame: '#3a3f46', mullions: 2, frameW: 0.006 }], 0.6)),
    // Glass pavilion (Dining Hall West, Davidson-Gundy Alumni Center).
    glassPavilion: mk(3, 4.2, [0.86, 0.86, 0.85], 0.02, facade(256, 3, 4.2, (g, w, h) => {
      speckle(g, w, h, [224, 228, 228], 6, 800, 2);
    }, [{ x0: 0.02, x1: 0.98, y0: 0.03, y1: 0.93, glass: '#5a7d90', frame: '#9aa3a8', mullions: 3, frameW: 0.008 }], 0.4)),
    // University Village: tan stone veneer with white-trimmed windows; brown hip roofs.
    villageStone: mk(4.4, 3.0, [0.36, 0.33, 0.3], 0.07, facade(1024, 4.4, 3.0, (g, w, h) => {
      if (drawBrick(g, w, h, 'brick_tan', 4.4, 3.0, 'saturate(0.85) brightness(1.04)')) return;
      speckle(g, w, h, [184, 160, 124], 30, 7000, 3);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = rand() < 0.5 ? 'rgba(120,98,70,0.35)' : 'rgba(214,196,160,0.35)';
        g.fillRect(rand() * w, rand() * h, 8 + rand() * 12, 4 + rand() * 4);
      }
    }, [{ x0: 0.34, x1: 0.66, y0: 0.3, y1: 0.82, glass: '#3f4a55', frame: '#f4f2ec', mullions: 2, transoms: 2, frameW: 0.022 }]), true),
    // Residence halls: tan stucco with white trim; gray hip roofs.
    hallTan: mk(3.6, 3.2, [0.45, 0.47, 0.5], 0.04, facade(256, 3.6, 3.2, (g, w, h) => {
      speckle(g, w, h, [220, 204, 172], 10, 2500, 2);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, h * 0.95, w, h * 0.05);
    }, [{ x0: 0.24, x1: 0.76, y0: 0.3, y1: 0.82, glass: '#4b5a67', frame: '#f4f3ef', mullions: 2, transoms: 2, frameW: 0.02 }]), true),
    // Naveen Jindal School of Management: orange-red brick bands with long ribbon windows under white sunshades.
    jsom: mk(4, 4.2, [0.8, 0.8, 0.78], 0.04, facade(1024, 4, 4.2, (g, w, h) => {
      if (!drawBrick(g, w, h, 'brick_red', 4, 4.2, 'saturate(1.15) brightness(1.08) hue-rotate(8deg)')) speckle(g, w, h, [170, 92, 58], 24, 6000, 2);
    }, [{ x0: 0.0, x1: 1.0, y0: 0.34, y1: 0.8, glass: '#33485a', frame: '#c9ccc9', mullions: 2, frameW: 0.006 }], 0.85, (g, w, h) => {
      g.fillStyle = '#eceae4'; g.fillRect(0, h * 0.17, w, h * 0.035);
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h * 0.205, w, h * 0.02);
    })),
    // Athenaeum Performance Hall and Music Building: pale limestone with tall slot windows and a glass base.
    stoneHall: mk(6, 5, [0.86, 0.85, 0.82], 0.02, facade(512, 6, 5, (g, w, h) => {
      speckle(g, w, h, [226, 218, 200], 8, 4000, 2);
      g.fillStyle = 'rgba(120,110,95,0.25)';
      for (let y = 0; y < h; y += h / 5) g.fillRect(0, y, w, 1.5);
      for (let x = 0; x < w; x += w / 4) g.fillRect(x, 0, 1.5, h);
    }, [{ x0: 0.42, x1: 0.5, y0: 0.08, y1: 0.95, glass: '#2f3e4b', frame: '#bdb6a6', frameW: 0.006 }], 0.8)),
    // Comets LANding (esports center, 2025): floor-to-ceiling clear glass in a heavy grey
    // aluminium grid, slim grey slab edges at each floor.
    cometsGlass: mk(3, 4.6, [0.42, 0.44, 0.47], 0.0, facade(256, 3, 4.6, (g, w, h) => {
      g.fillStyle = '#6d7277'; g.fillRect(0, 0, w, h);
    }, [{ x0: 0.03, x1: 0.97, y0: 0.12, y1: 0.97, glass: '#9fc4d6', frame: '#5d6267', mullions: 2, transoms: 2, frameW: 0.03 }], 0.5, (g, w, h) => {
      g.fillStyle = '#4c5156'; g.fillRect(0, h * 0.88, w, h * 0.12);
    })),
    // Callier Center Richardson: white panels, dark glass in deep orange surrounds, an orange fin per bay.
    callier: mk(3.6, 4.3, [0.86, 0.86, 0.85], 0.03, facade(256, 3.6, 4.3, (g, w, h) => {
      speckle(g, w, h, [232, 232, 228], 6, 900, 2);
      hLines(g, w, h, Math.round(h / 3), 'rgba(0,0,0,0.06)');
      g.fillStyle = '#e2552a'; g.fillRect(w * 0.9, 0, w * 0.1, h);
    }, [{ x0: 0.14, x1: 0.78, y0: 0.24, y1: 0.86, glass: '#2c3742', frame: '#e2552a', mullions: 2, frameW: 0.045 }], 0.6)),
    // Canyon Creek Heights and Northside: brown brick with tan stucco bays.
    canyonBrick: mk(3.4, 3.3, [0.86, 0.86, 0.85], 0.05, facade(1024, 3.4, 3.3, (g, w, h) => {
      if (!drawBrick(g, w, h, 'brick_red', 3.4, 3.3, 'brightness(0.82) saturate(0.75) hue-rotate(-6deg)')) {
        speckle(g, w, h, [122, 80, 62], 24, 5000, 2);
        g.fillStyle = 'rgba(230,220,200,0.3)';
        for (let y = 0; y < h; y += 5) g.fillRect(0, y, w, 1);
      }
      g.fillStyle = '#d9c8a6'; g.fillRect(w * 0.7, 0, w * 0.3, h);
    }, [{ x0: 0.18, x1: 0.62, y0: 0.28, y1: 0.86, glass: '#3d4853', frame: '#ecebe6', mullions: 2, transoms: 2, frameW: 0.02 }])),
  };
  return styles;
}

export function asphaltTexture() {
  seed = 11;
  return canvas(512, 512, (g, w, h) => {
    speckle(g, w, h, [98, 97, 95], 28, 60000, 1);
    // Patches and sealed cracks.
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '40,40,42' : '110,110,108'},0.12)`;
      g.beginPath(); g.ellipse(rand() * w, rand() * h, 20 + rand() * 60, 10 + rand() * 40, rand() * 3, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(30,30,30,0.3)';
    g.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      let x = rand() * w, y = rand() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 8; k++) { x += (rand() - 0.5) * 50; y += rand() * 30; g.lineTo(x, y); }
      g.stroke();
    }
  });
}

/** Sidewalk concrete: one 1.5 m panel per texture repeat with tooled joints. */
export function concreteTexture() {
  seed = 13;
  return canvas(256, 256, (g, w, h) => {
    // Broom-finished concrete: fine speckle and faint drag lines, no blotches.
    speckle(g, w, h, [192, 188, 179], 10, 12000, 1);
    for (let y = 0; y < h; y += 3) { g.fillStyle = `rgba(${rand() < 0.5 ? '120,115,105' : '225,221,212'},0.06)`; g.fillRect(0, y, w, 1); }
    g.fillStyle = 'rgba(40,36,30,0.35)';
    g.fillRect(0, 0, w, 2);
    g.fillRect(0, 0, 2, h);
  });
}

export function pavingTexture() {
  seed = 17;
  return canvas(256, 256, (g, w, h) => {
    speckle(g, w, h, [176, 160, 140], 18, 6000, 1);
    g.fillStyle = 'rgba(60,50,40,0.35)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 2);
    for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 0 : 32; x < w; x += 64) g.fillRect(x, y, 2, 32);
  });
}

/**
 * Bermuda/St. Augustine turf as it looks in late autumn in North Texas: a dense
 * layer of short blades in mixed greens and straw, with soft dry patches and
 * a few clover-dark spots. 1024 px covers 6 m.
 */
export function grassTexture() {
  seed = 19;
  return canvas(1024, 1024, (g, w, h) => {
    g.fillStyle = 'rgb(104,108,64)';
    g.fillRect(0, 0, w, h);
    // Large soft patches (wrapped so tiles match).
    for (let i = 0; i < 60; i++) {
      const dry = rand() < 0.55;
      const x = rand() * w, y = rand() * h, r = 60 + rand() * 180;
      const col = dry ? `${168 + rand() * 25},${150 + rand() * 18},${96 + rand() * 18}` : `${70 + rand() * 25},${100 + rand() * 25},${44 + rand() * 10}`;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, `rgba(${col},0.22)`);
        gr.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    }
    // Blades: short strokes in random directions, darker roots first, bright tips last.
    g.lineCap = 'round';
    for (const [n, lw, light] of [[60000, 2.2, 0.75], [70000, 1.6, 1.0], [30000, 1.1, 1.25]] as const) {
      g.lineWidth = lw;
      for (let i = 0; i < n; i++) {
        const x = rand() * w, y = rand() * h, a = rand() * Math.PI * 2, l = 3 + rand() * 7;
        const dry = rand() < 0.42;
        const r = (dry ? 150 + rand() * 50 : 62 + rand() * 40) * light;
        const gg = (dry ? 136 + rand() * 40 : 92 + rand() * 45) * light;
        const b = (dry ? 82 + rand() * 30 : 36 + rand() * 22) * light;
        g.strokeStyle = `rgba(${r | 0},${gg | 0},${b | 0},0.55)`;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
      }
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = 'rgba(40,58,26,0.25)';
      g.beginPath(); g.arc(rand() * w, rand() * h, 2 + rand() * 5, 0, Math.PI * 2); g.fill();
    }
  });
}

export function dirtTexture() {
  seed = 23;
  return canvas(256, 256, (g, w, h) => speckle(g, w, h, [168, 140, 104], 30, 12000, 2));
}

export function roofTexture() {
  seed = 29;
  return canvas(256, 256, (g, w, h) => {
    speckle(g, w, h, [210, 210, 206], 18, 6000, 2);
    g.fillStyle = 'rgba(0,0,0,0.06)';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 1, h);
  });
}

/** Asphalt shingles: rows of tabs, tinted by vertex color. */
export function shingleTexture() {
  seed = 31;
  return canvas(256, 256, (g, w, h) => {
    speckle(g, w, h, [150, 150, 150], 40, 12000, 1);
    for (let y = 0; y < h; y += 16) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y, w, 2);
      for (let x = (y / 16) % 2 ? 0 : 16; x < w; x += 32) g.fillRect(x, y, 2, 16);
    }
  });
}

/** Leaf cluster card with alpha, for tree canopies. */
export function leafTexture() {
  seed = 37;
  return canvas(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // Sprays of pointed leaves: dense in the middle, ragged at the edge. Each leaf
    // has a darker underside half and a lit upper half with a midrib, so the
    // crown reads as individual leaves up close.
    for (let c = 0; c < 12; c++) {
      const a0 = rand() * Math.PI * 2, d0 = Math.sqrt(rand()) * w * 0.27;
      const cx = w / 2 + Math.cos(a0) * d0, cy = h / 2 + Math.sin(a0) * d0;
      for (let i = 0; i < 120; i++) {
        const a = rand() * Math.PI * 2, d = Math.pow(rand(), 0.65) * w * 0.17;
        const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (Math.hypot(x - w / 2, y - h / 2) > w * 0.47) continue;
        const L = 26 + rand() * 30 - (d / (w * 0.17)) * 8, hue = 80 + rand() * 28, sat = 34 + rand() * 24;
        const len = 7 + rand() * 6, wid = 2.6 + rand() * 2, rot = rand() * Math.PI;
        g.save(); g.translate(x, y); g.rotate(rot);
        g.fillStyle = `hsl(${hue},${sat}%,${L * 0.72}%)`;
        g.beginPath(); g.moveTo(-len, 0); g.quadraticCurveTo(0, wid * 2, len, 0); g.quadraticCurveTo(0, -wid * 2, -len, 0); g.fill();
        g.fillStyle = `hsl(${hue - 4},${sat + 6}%,${L * 1.12}%)`;
        g.beginPath(); g.moveTo(-len, 0); g.quadraticCurveTo(0, -wid * 2, len, 0); g.closePath(); g.fill();
        g.strokeStyle = `hsla(${hue},${sat}%,${L * 0.6}%,0.6)`; g.lineWidth = 0.7;
        g.beginPath(); g.moveTo(-len, 0); g.lineTo(len, 0); g.stroke();
        g.restore();
      }
    }
  });
}

/** Bark for trunks. */
export function barkTexture() {
  seed = 41;
  return canvas(128, 256, (g, w, h) => {
    speckle(g, w, h, [92, 76, 60], 30, 3000, 2);
    g.fillStyle = 'rgba(30,22,15,0.45)';
    for (let x = 0; x < w; x += 6 + rand() * 8) g.fillRect(x, 0, 2, h);
  });
}

/** Painted markings atlas is not needed: markings use plain vertex-colored geometry. */
export function stairTexture() {
  seed = 43;
  return canvas(128, 128, (g, w, h) => {
    speckle(g, w, h, [196, 192, 184], 12, 2000, 1);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 0, w, 3);
    g.fillStyle = 'rgba(220,180,40,0.9)';
    g.fillRect(0, 4, w, 6);
  });
}

/** Chain-link mesh with alpha (one 0.5 m tile). */
export function chainLinkTexture() {
  return canvas(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(150,155,160,1)';
    g.lineWidth = 2;
    for (let k = -w; k < w * 2; k += 16) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke();
      g.beginPath(); g.moveTo(k, h); g.lineTo(k + h, 0); g.stroke();
    }
  });
}

/** Regulatory sign faces; the bottom-left corner is grey for the back of the panel. */
export function signTexture(kind: 'stop' | 'yield') {
  const t = canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#9a9c9e'; g.fillRect(0, 0, w, h);
    if (kind === 'stop') {
      g.fillStyle = '#c4161c';
      g.beginPath();
      for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(w / 2 + Math.cos(a) * w * 0.5, h / 2 + Math.sin(a) * h * 0.5); }
      g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 8;
      g.beginPath();
      for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(w / 2 + Math.cos(a) * w * 0.46, h / 2 + Math.sin(a) * h * 0.46); }
      g.closePath(); g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 74px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('STOP', w / 2, h / 2 + 3, w * 0.74);
    } else {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#c4161c'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(w * 0.5, h * 0.82); g.lineTo(w * 0.16, h * 0.24); g.lineTo(w * 0.84, h * 0.24); g.fill();
    }
  });
  return t;
}

/**
 * Rutford Avenue's promenade paving: a 3 m repeat of light and warm-gray
 * square pavers in an even checkerboard.
 */
export function promenadeTexture() {
  seed = 53;
  return canvas(256, 256, (g, w, h) => {
    speckle(g, w, h, [204, 198, 186], 12, 9000, 1);
    // Even checkerboard of 0.75 m pavers in two tones, with joints of one weight in both directions.
    const n = 4, c = w / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i + j) % 2) { g.fillStyle = 'rgba(150,138,120,0.42)'; g.fillRect(i * c, j * c, c, c); }
    }
    g.fillStyle = 'rgba(70,62,52,0.28)';
    for (let k = 0; k < n; k++) { g.fillRect(k * c, 0, 1, h); g.fillRect(0, k * c, w, 1); }
  });
}

/** Concrete street: one 4.5 m panel per repeat along, one lane per repeat across, sawn joints. */
export function concreteRoadTexture() {
  seed = 47;
  return canvas(256, 256, (g, w, h) => {
    speckle(g, w, h, [176, 172, 164], 14, 14000, 1);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = `rgba(${rand() < 0.5 ? '120,116,108' : '205,200,192'},0.12)`;
      g.beginPath(); g.ellipse(rand() * w, rand() * h, 20 + rand() * 60, 30 + rand() * 80, 0, 0, Math.PI * 2); g.fill();
    }
    // Tire tracks (slightly darker bands) and the joints.
    g.fillStyle = 'rgba(70,66,60,0.10)';
    g.fillRect(w * 0.22, 0, w * 0.14, h); g.fillRect(w * 0.64, 0, w * 0.14, h);
    g.fillStyle = 'rgba(40,36,32,0.55)';
    g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
  });
}

/** Aluminium louver slats with gaps (alpha), one slat per repeat. */
export function louverTexture() {
  return canvas(64, 8, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w * 0.42, h);
    g.fillStyle = 'rgba(200,200,196,1)'; g.fillRect(w * 0.36, 0, w * 0.06, h);
  });
}

/** Sports net mesh with alpha. */
export function netTexture() {
  return canvas(32, 32, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(245,245,245,1)'; g.lineWidth = 2;
    g.strokeRect(0, 0, w, h);
  });
}

/** Weathered tan-brown hardwood boards (Student Union bleacher steps): one 1 m repeat. */
export function timberTexture() {
  seed = 59;
  return canvas(256, 256, (g, w, h) => {
    speckle(g, w, h, [168, 128, 88], 22, 8000, 1);
    for (let y = 0; y < h; y += 32) {
      g.fillStyle = `rgba(${90 + rand() * 30},${60 + rand() * 20},40,0.25)`;
      g.fillRect(0, y, w, 32);
      g.fillStyle = 'rgba(40,28,18,0.6)'; g.fillRect(0, y, w, 2);
    }
    g.strokeStyle = 'rgba(70,48,30,0.2)';
    for (let i = 0; i < 60; i++) { const y = rand() * h; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1); g.stroke(); }
  });
}

/**
 * Building-name signs (UTD style: dark green panel, white serif name, orange
 * rule and "The University of Texas at Dallas" line). One shared 2048 x 4096
 * atlas, 4 x 32 slots of 512 x 128 px, filled on first use.
 */
let atlas: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; slots: Map<string, number> } | null = null;
export function signSlot(name: string): { tex: THREE.CanvasTexture; u0: number; v0: number; u1: number; v1: number } {
  if (!atlas) {
    const c = document.createElement('canvas');
    c.width = 2048; c.height = 4096;
    const g = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    atlas = { tex, g, slots: new Map() };
  }
  let i = atlas.slots.get(name);
  if (i === undefined) {
    i = atlas.slots.size % 128;
    atlas.slots.set(name, i);
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 128, g = atlas.g;
    g.fillStyle = '#154734'; g.fillRect(x, y, 512, 128);
    g.strokeStyle = '#e87500'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 24, y + 92); g.lineTo(x + 488, y + 92); g.stroke();
    g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 46;
    g.font = `bold ${size}px Georgia, serif`;
    while (g.measureText(name).width > 470 && size > 18) { size -= 2; g.font = `bold ${size}px Georgia, serif`; }
    g.fillText(name, x + 256, y + 52);
    g.font = '15px Georgia, serif';
    g.fillText('The University of Texas at Dallas', x + 256, y + 110);
    atlas.tex.needsUpdate = true;
  }
  const x = (i % 4) * 512, y = Math.floor(i / 4) * 128;
  // Canvas textures are flipped (row 0 at v = 1).
  return { tex: atlas.tex, u0: x / 2048, u1: (x + 512) / 2048, v0: 1 - (y + 128) / 4096, v1: 1 - y / 4096 };
}

/** University Village building numbers 1..72 on bronze plaques, 9 per row (see buildings.ts numberPlaque). */
export function numberAtlas() {
  const cols = 9, rows = 8;
  const t = canvas(cols * 112, rows * 112, (g, w, h) => {
    const c = w / cols;
    g.fillStyle = '#3a2e22'; g.fillRect(0, 0, w, h);
    for (let k = 0; k < cols * rows; k++) {
      const x = (k % cols) * c, y = Math.floor(k / cols) * c;
      g.fillStyle = '#4a3b2b'; g.fillRect(x + 4, y + 4, c - 8, c - 8);
      g.strokeStyle = '#c9a66b'; g.lineWidth = 3; g.strokeRect(x + 9, y + 9, c - 18, c - 18);
      g.fillStyle = '#efe2c4'; g.font = 'bold 62px Rajdhani, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(k + 1), x + c / 2, y + c / 2 + 3, c - 26);
    }
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Tileable small-ripple normal map for water: a sum of wrapped sine waves in a few directions. */
export function waterNormals() {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!, img = g.createImageData(n, n);
  const waves = [[1, 0, 0.6], [0, 1, 0.5], [1, 1, 0.35], [2, -1, 0.3], [3, 2, 0.2], [-1, 3, 0.18], [5, 1, 0.1]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let dx = 0, dy = 0;
    for (const [kx, ky, a] of waves) {
      const ph = (2 * Math.PI * (kx * x + ky * y)) / n + kx * 1.7 + ky * 0.9;
      const d = Math.cos(ph) * a;
      dx += d * kx; dy += d * ky;
    }
    const l = Math.hypot(dx * 0.25, dy * 0.25, 1), i = (y * n + x) * 4;
    img.data[i] = (-dx * 0.25 / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy * 0.25 / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
