"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import type { Points } from "three";

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

function Particles(): React.JSX.Element {
  const ref = useRef<Points>(null);

  useFrame((state, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.08;
    ref.current.rotation.x = state.pointer.y * 0.2;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[POSITIONS, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.02} color="#60a5fa" transparent opacity={0.8} />
    </points>
  );
}

export default function HeroScene(): React.JSX.Element {
  return (
    <Canvas camera={{ position: [0, 0, 5], fov: 60 }} dpr={[1, 2]}>
      <Particles />
    </Canvas>
  );
}
