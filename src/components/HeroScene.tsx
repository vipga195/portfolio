"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  MathUtils,
  PerspectiveCamera,
  Plane,
  Points,
  PointsMaterial,
  Raycaster,
  Scene,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

import { BURST_DURATION } from "@/lib/intro";

const PARTICLE_COUNT = 2400;
const CAMERA_Z = 5;
const CAMERA_FOV = 60;

// Monogram geometry in icon.svg units (viewBox 64x64)
const H_RECTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [11, 13, 7, 38],
  [28, 13, 7, 38],
  [18, 28, 10, 8],
];
const DOT = { cx: 44, cy: 47, r: 5 };
const BOUNDS = { minX: 11, maxX: 49, minY: 13, maxY: 51 };
const MONOGRAM_HEIGHT = BOUNDS.maxY - BOUNDS.minY;
const MONOGRAM_HALF_WIDTH = (BOUNDS.maxX - BOUNDS.minX) / MONOGRAM_HEIGHT / 2;
const DEPTH = 0.08;

const COLOR_START = new Color("#3b82f6");
const COLOR_END = new Color("#8b5cf6");
const COLOR_DOT = new Color("#fbbf24");

const INTRO_DURATION = 2;
// Seconds of BURST_DURATION spent flying out; the rest holds particles scattered
const BURST_FLY = 0.9;
const BURST_DEPTH = 0.6;
// Scattered particles are sparse, so enlarge them until they gather back
const BURST_SIZE = 6;
const LABEL_RATIO = 0.18;
const SPRING = 40;
const DAMPING = 6;
const REPEL_RADIUS = 0.2;
const REPEL_FORCE = 40;
const FLOAT_AMP = 0.008;
const WAVE_AMP = 0.08;
const WAVE_FREQ = 5;
const WAVE_SPEED = 1.6;
const IDLE_SWAY = 0.25;
const IDLE_SWAY_SPEED = 0.45;
const REDUCED_MOTION_SCALE = 0.4;
const MAX_TILT = 0.3;
const TILT_EASE = 3;
const MAX_DT = 1 / 30;
const POINT_SIZE_RATIO = 0.012;
const FULL_SCREEN_FILL = 0.75;

type ParticleData = {
  targets: Float32Array;
  starts: Float32Array;
  colors: Float32Array;
  dotCount: number;
};

// Positions are local units: monogram height = 1, centered at origin, y up
function toLocal(x: number, y: number): [number, number] {
  return [
    (x - (BOUNDS.minX + BOUNDS.maxX) / 2) / MONOGRAM_HEIGHT,
    ((BOUNDS.minY + BOUNDS.maxY) / 2 - y) / MONOGRAM_HEIGHT,
  ];
}

function createParticles(): ParticleData {
  const targets = new Float32Array(PARTICLE_COUNT * 3);
  const starts = new Float32Array(PARTICLE_COUNT * 3);
  const colors = new Float32Array(PARTICLE_COUNT * 3);
  const rectAreas = H_RECTS.map(([, , w, h]) => w * h);
  const hArea = rectAreas.reduce((sum, a) => sum + a, 0);
  const dotArea = Math.PI * DOT.r * DOT.r;
  const dotCount = Math.round((PARTICLE_COUNT * dotArea) / (hArea + dotArea));
  const color = new Color();

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    let sx: number;
    let sy: number;
    if (i < dotCount) {
      const radius = DOT.r * Math.sqrt(Math.random());
      const angle = Math.random() * Math.PI * 2;
      sx = DOT.cx + radius * Math.cos(angle);
      sy = DOT.cy + radius * Math.sin(angle);
      color.copy(COLOR_DOT);
    } else {
      let pick = Math.random() * hArea;
      let rectIndex = 0;
      while (pick > rectAreas[rectIndex] && rectIndex < H_RECTS.length - 1) {
        pick -= rectAreas[rectIndex];
        rectIndex++;
      }
      const [x, y, w, h] = H_RECTS[rectIndex];
      sx = x + Math.random() * w;
      sy = y + Math.random() * h;
      const t = ((sx - 11) / 24 + (sy - 13) / 38) / 2;
      color.lerpColors(COLOR_START, COLOR_END, t);
    }
    const [lx, ly] = toLocal(sx, sy);
    targets[i * 3] = lx;
    targets[i * 3 + 1] = ly;
    targets[i * 3 + 2] = (Math.random() - 0.5) * DEPTH;

    const r = 0.8 + Math.random() * 1.2;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starts[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starts[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starts[i * 3 + 2] = r * Math.cos(phi);

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  return { targets, starts, colors, dotCount };
}

function createDotTexture(): DataTexture {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
      const i = (y * size + x) * 4;
      data.fill(255, i, i + 3);
      data[i + 3] = Math.round(255 * Math.max(0, 1 - d) ** 1.5);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

// Mutated externally: `active` starts the particle intro, `settle` morphs full screen (0) -> final layout (1),
// `burst` is the loader ring radius in px particles explode from (0 = no burst)
export type IntroState = {
  active: boolean;
  settle: number;
  burst: number;
};

type HeroSceneProps = {
  paused?: boolean;
  intro?: RefObject<IntroState>;
};

export default function HeroScene({ paused = false, intro }: HeroSceneProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    // TEMP preview: force the intro even with reduced motion (restore the matchMedia check)
    const reducedMotion = false;
    const { targets, starts, colors, dotCount } = createParticles();

    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    camera.position.set(0, 0, CAMERA_Z);

    const positions = new Float32Array(reducedMotion ? targets : starts);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);
    const positionAttr = new BufferAttribute(positions, 3);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", positionAttr);
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    const texture = createDotTexture();
    const material = new PointsMaterial({
      size: 0.03,
      map: texture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const points = new Points(geometry, material);
    scene.add(points);

    const layout = { fullScale: 1, finalScale: 1, finalX: 0, pxToLocal: 1, halfWidth: 1, halfHeight: 1, sizeBoost: 1 };
    const applyLayout = (): void => {
      const settle = intro?.current.settle ?? 1;
      const scale = MathUtils.lerp(layout.fullScale, layout.finalScale, settle);
      points.scale.setScalar(scale);
      points.position.x = layout.finalX * settle;
      material.size = scale * POINT_SIZE_RATIO * layout.sizeBoost;
    };

    const resize = (): void => {
      const { clientWidth: width, clientHeight: height } = el;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      const viewHeight = 2 * CAMERA_Z * Math.tan(MathUtils.degToRad(CAMERA_FOV / 2));
      const viewWidth = viewHeight * camera.aspect;
      if (camera.aspect > 1) {
        layout.finalScale = viewHeight * 0.5;
        layout.finalX = Math.min(viewWidth * 0.25, viewWidth / 2 - MONOGRAM_HALF_WIDTH * layout.finalScale - 0.3);
      } else {
        layout.finalScale = Math.min(viewHeight * 0.3, (viewWidth * 0.6) / (MONOGRAM_HALF_WIDTH * 2));
        layout.finalX = 0;
      }
      layout.fullScale = Math.min(viewHeight, viewWidth / (MONOGRAM_HALF_WIDTH * 2)) * FULL_SCREEN_FILL;
      layout.pxToLocal = viewHeight / (height * layout.fullScale);
      layout.halfWidth = viewWidth / 2 / layout.fullScale;
      layout.halfHeight = viewHeight / 2 / layout.fullScale;
      applyLayout();
      renderer.render(scene, camera);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    const pointer = new Vector2();
    let pointerActive = false;
    const onPointerMove = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
      pointerActive = true;
    };
    const onPointerOut = (e: PointerEvent): void => {
      if (!e.relatedTarget) pointerActive = false;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerout", onPointerOut);

    const raycaster = new Raycaster();
    const plane = new Plane();
    const hit = new Vector3();
    const localPointer = new Vector3();
    const baseNormal = new Vector3(0, 0, 1);
    // Reduced motion: skip the intro and keep only subtle idle motion and pointer interaction
    const motionScale = reducedMotion ? REDUCED_MOTION_SCALE : 1;
    let introTime = reducedMotion ? INTRO_DURATION : 0;
    let burstPending = !reducedMotion;
    let burstDelay = 0;
    // Where each particle flies out from; equals starts when there is no burst
    const origins = new Float32Array(starts);

    // Particles fill the loader ring (dot particles sit on the percent label), then scatter across the whole screen
    const seedBurst = (radiusPx: number): void => {
      const radius = radiusPx * layout.pxToLocal;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const r = radius * (i < dotCount ? LABEL_RATIO : 1) * Math.sqrt(Math.random());
        const angle = Math.random() * Math.PI * 2;
        positions[i3] = origins[i3] = Math.cos(angle) * r;
        positions[i3 + 1] = origins[i3 + 1] = Math.sin(angle) * r;
        positions[i3 + 2] = origins[i3 + 2] = 0;
        starts[i3] = (Math.random() * 2 - 1) * layout.halfWidth;
        starts[i3 + 1] = (Math.random() * 2 - 1) * layout.halfHeight;
        starts[i3 + 2] = (Math.random() - 0.5) * BURST_DEPTH;
      }
      burstDelay = BURST_DURATION;
    };

    const timer = new Timer();
    timer.connect(document);
    renderer.setAnimationLoop((timestamp: number): void => {
      timer.update(timestamp);
      if (pausedRef.current) return;
      const dt = Math.min(timer.getDelta(), MAX_DT);
      const elapsed = timer.getElapsed();
      const active = intro?.current.active ?? true;
      if (active && burstPending) {
        burstPending = false;
        const burst = intro?.current.burst ?? 0;
        if (burst > 0) seedBurst(burst);
      }
      if (active) introTime += dt;
      const progress = Math.min(Math.max((introTime - burstDelay) / INTRO_DURATION, 0), 1);
      const ease = 1 - (1 - progress) ** 3;
      const burstEase = burstDelay > 0 ? 1 - (1 - Math.min(introTime / BURST_FLY, 1)) ** 3 : 1;
      layout.sizeBoost = burstDelay > 0 ? 1 + (BURST_SIZE - 1) * burstEase * (1 - ease) : 1;
      applyLayout();

      const tiltEase = 1 - Math.exp(-TILT_EASE * dt);
      const swayX = Math.sin(elapsed * IDLE_SWAY_SPEED * 0.7) * IDLE_SWAY * 0.4 * motionScale;
      const swayY = Math.sin(elapsed * IDLE_SWAY_SPEED) * IDLE_SWAY * motionScale;
      const tiltX = (pointerActive ? -pointer.y * MAX_TILT : 0) + swayX;
      const tiltY = (pointerActive ? pointer.x * MAX_TILT : 0) + swayY;
      points.rotation.x += (tiltX - points.rotation.x) * tiltEase;
      points.rotation.y += (tiltY - points.rotation.y) * tiltEase;
      points.updateMatrixWorld();

      let repel = false;
      if (pointerActive) {
        raycaster.setFromCamera(pointer, camera);
        plane.set(baseNormal, 0).applyMatrix4(points.matrixWorld);
        if (raycaster.ray.intersectPlane(plane, hit)) {
          localPointer.copy(hit);
          points.worldToLocal(localPointer);
          repel = true;
        }
      }

      const damping = Math.exp(-DAMPING * dt);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        const float = Math.sin(elapsed * 1.2 + i * 0.37) * FLOAT_AMP * motionScale;
        const wave =
          Math.sin(elapsed * WAVE_SPEED - (targets[i3] + targets[i3 + 1]) * WAVE_FREQ) * WAVE_AMP * motionScale * ease;
        for (let axis = 0; axis < 3; axis++) {
          const offset = axis === 1 ? float : axis === 2 ? wave : 0;
          const from = origins[i3 + axis] + (starts[i3 + axis] - origins[i3 + axis]) * burstEase;
          const home = from + (targets[i3 + axis] - from) * ease + offset;
          velocities[i3 + axis] += (home - positions[i3 + axis]) * SPRING * dt;
        }
        if (repel) {
          const dx = positions[i3] - localPointer.x;
          const dy = positions[i3 + 1] - localPointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < REPEL_RADIUS && dist > 1e-5) {
            const force = ((1 - dist / REPEL_RADIUS) * REPEL_FORCE * dt) / dist;
            velocities[i3] += dx * force;
            velocities[i3 + 1] += dy * force;
          }
        }
        for (let axis = 0; axis < 3; axis++) {
          velocities[i3 + axis] *= damping;
          positions[i3 + axis] += velocities[i3 + axis] * dt;
        }
      }
      positionAttr.needsUpdate = true;
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerout", onPointerOut);
      observer.disconnect();
      timer.dispose();
      geometry.dispose();
      material.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [intro]);

  return <div ref={container} className="h-full w-full" />;
}
