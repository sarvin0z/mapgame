// three.js objects are typed loosely so this works with any three version without importing it.
type Obj3D = any;

export interface SceneMarkOptions {
  renderer?: any;
  scene?: Obj3D;
  /** A camera, or a function returning the active one (for apps that swap cameras). */
  camera?: Obj3D | (() => Obj3D);
  /** The WebGL canvas. Defaults to renderer.domElement, else the largest canvas on the page. */
  canvas?: HTMLCanvasElement;
  /** OrbitControls-like; its `target` is saved and restored by goto(). */
  controls?: { target?: { x: number; y: number; z: number; set(x: number, y: number, z: number): unknown }; update?: () => void } | null;
  /** Draw one frame. Pass when rendering through EffectComposer so screenshots include post-processing. */
  render?: () => void;
  /** Non-three engines: resolve what is under a client-pixel position. */
  pick?: (clientX: number, clientY: number) => Record<string, unknown> | null;
  /** Receiver URL (default http://localhost:4748); false disables network sync. */
  endpoint?: string | false;
  /** Shift+<code> toggles marking. Default 'KeyM'. */
  hotkey?: string;
  /** Return true to make an object unpickable. Also: set object.userData.scenemarkIgnore = true. */
  ignore?: (o: Obj3D) => boolean;
  storageKey?: string;
  /** Called when mark mode flips; use it to pause app input. */
  onModeChange?: (active: boolean) => void;
}

export interface SceneMarkHit {
  object: Obj3D; point: number[]; normal: number[] | null; uv: number[] | null;
  distance: number; instanceId: number | null; material: any;
}

export interface SceneMarkApi {
  enable(): void; disable(): void; toggle(): void;
  pick(clientX: number, clientY: number): { hit: SceneMarkHit | null; behind: string[]; custom?: unknown };
  annotateAt(clientX: number, clientY: number, text?: string): any;
  annotateObject(obj: Obj3D, text?: string): any;
  list(): any[]; remove(id: string): void; clear(): void; goto(id: string): boolean;
  toMarkdown(): string; copy(): Promise<string>; destroy(): void;
  readonly active: boolean; readonly connected: boolean; readonly canvas: HTMLCanvasElement;
}

export function attachSceneMark(opts?: SceneMarkOptions): SceneMarkApi;
/** Finds the renderer / scene / camera on the page (three.js globals, A-Frame, devtools hook; Babylon via scene.pick). */
export function autoAttachSceneMark(opts?: SceneMarkOptions): Promise<SceneMarkApi>;
