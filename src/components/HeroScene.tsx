"use client";

import { useEffect, useRef } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  Timer,
  WebGLRenderer,
} from "three";

const PARTICLE_COUNT = 1500;

function createPositions(): Float32Array {
  const arr = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const r = 2 + Math.random() * 0.6;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    arr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    arr[i * 3 + 2] = r * Math.cos(phi);
  }
  return arr;
}

const POSITIONS = createPositions();

export default function HeroScene(): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = container.current;
    if (!el) return;

    const renderer = new WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 5);

    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(POSITIONS, 3));
    const material = new PointsMaterial({ size: 0.02, color: "#60a5fa", transparent: true, opacity: 0.8 });
    const points = new Points(geometry, material);
    scene.add(points);

    const resize = (): void => {
      const { clientWidth: width, clientHeight: height } = el;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);

    let pointerY = 0;
    const onPointerMove = (e: PointerEvent): void => {
      const rect = el.getBoundingClientRect();
      pointerY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    };
    window.addEventListener("pointermove", onPointerMove);

    const timer = new Timer();
    timer.connect(document);
    renderer.setAnimationLoop((timestamp) => {
      timer.update(timestamp);
      points.rotation.y += timer.getDelta() * 0.08;
      points.rotation.x = pointerY * 0.2;
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      window.removeEventListener("pointermove", onPointerMove);
      observer.disconnect();
      timer.dispose();
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={container} className="h-full w-full" />;
}
