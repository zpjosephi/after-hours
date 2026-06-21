"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Clouds, Cloud, Float, OrbitControls, Sky } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

/* ---------------- Floating low-poly island ---------------- */
function Island({
  position,
  scale = 1,
  floatSpeed = 1,
}: {
  position: [number, number, number];
  scale?: number;
  floatSpeed?: number;
}) {
  return (
    <Float speed={floatSpeed} rotationIntensity={0.15} floatIntensity={0.8} floatingRange={[-0.3, 0.3]}>
      <group position={position} scale={scale}>
        {/* rock body (pointing down) */}
        <mesh castShadow position={[0, -0.2, 0]} scale={[1, 1.5, 1]}>
          <dodecahedronGeometry args={[1.1, 0]} />
          <meshStandardMaterial color="#6b4f37" roughness={1} flatShading />
        </mesh>
        {/* grassy cap */}
        <mesh position={[0, 0.55, 0]}>
          <sphereGeometry args={[1.06, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2.1]} />
          <meshStandardMaterial color="#69853e" roughness={1} flatShading />
        </mesh>
      </group>
    </Float>
  );
}

/* ---------------- Particle waterfall ---------------- */
function Waterfall({
  position,
  height = 7,
  count = 700,
}: {
  position: [number, number, number];
  height?: number;
  count?: number;
}) {
  const ref = useRef<THREE.Points>(null);
  const { positions, speeds } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 0.6;
      positions[i * 3 + 1] = -Math.random() * height; // below the emitter
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
      speeds[i] = 3 + Math.random() * 4;
    }
    return { positions, speeds };
  }, [count, height]);

  useFrame((_, dt) => {
    const p = ref.current;
    if (!p) return;
    const arr = p.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] -= speeds[i] * Math.min(dt, 0.05); // fall downward
      arr[i * 3] *= 1.0015; // spread out as it falls
      if (arr[i * 3 + 1] < -height) {
        arr[i * 3 + 1] = 0; // respawn at the lip
        arr[i * 3] = (Math.random() - 0.5) * 0.6;
      }
    }
    p.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref} position={position}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.1}
        color="#dff1ff"
        transparent
        opacity={1}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}

/* ---------------- Scene ---------------- */
function Scene() {
  return (
    <>
      <fog attach="fog" args={["#caa987", 12, 38]} />
      <Sky sunPosition={[12, 1.2, -8]} turbidity={12} rayleigh={1.1} mieCoefficient={0.02} mieDirectionalG={0.96} />

      <ambientLight intensity={0.3} />
      <hemisphereLight args={["#ffe6c2", "#3a4763", 0.45]} />
      <directionalLight position={[10, 3, -6]} intensity={3.2} color="#ffc98a" castShadow />

      {/* floating islands rising toward the camera */}
      <Island position={[0, 0.5, 0]} scale={1.2} floatSpeed={1.1} />
      <Island position={[-4.5, 2.6, -3]} scale={0.85} floatSpeed={0.8} />
      <Island position={[4.2, -1.4, -2]} scale={0.95} floatSpeed={1.3} />
      <Island position={[-2, -2.6, 1.5]} scale={0.7} floatSpeed={1.5} />
      <Island position={[2.5, 4.2, -6]} scale={0.6} floatSpeed={0.7} />

      {/* waterfalls dropping from the main islands into the cloud sea */}
      <Waterfall position={[0.2, -0.9, 0.4]} height={6} />
      <Waterfall position={[4.2, -2.7, -1.8]} height={4.5} count={450} />

      {/* volumetric sea of clouds below */}
      <Clouds material={THREE.MeshBasicMaterial} limit={400}>
        <Cloud seed={1} bounds={[26, 3, 16]} volume={9} segments={50} color="#fff4e2" opacity={0.85} fade={30} speed={0.15} position={[0, -6, -2]} />
        <Cloud seed={7} bounds={[22, 2, 12]} volume={7} segments={40} color="#e9d6ba" opacity={0.7} fade={30} speed={0.1} position={[2, -7.5, -6]} />
      </Clouds>

      <OrbitControls
        autoRotate
        autoRotateSpeed={0.35}
        enablePan={false}
        enableZoom
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 1.9}
        minDistance={8}
        maxDistance={20}
        target={[0, 0, 0]}
      />

      <EffectComposer>
        <Bloom intensity={0.65} luminanceThreshold={0.85} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.85} />
      </EffectComposer>
    </>
  );
}

export default function ScenePage() {
  return (
    <main className="relative h-screen w-full bg-[#14213a]">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [7, 2.5, 11], fov: 42 }} gl={{ antialias: true, toneMappingExposure: 0.5 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

      {/* overlay copy */}
      <div className="pointer-events-none absolute bottom-[9%] left-6 z-10 md:left-12">
        <p className="mb-2 text-[10px] uppercase tracking-[0.35em] text-primary/60">Three.js · real-time 3D</p>
        <h1
          className="font-medium leading-[0.9] tracking-[-0.04em] text-primary text-5xl sm:text-6xl md:text-7xl"
          style={{ textShadow: "0 2px 30px rgba(0,0,0,0.55)" }}
        >
          Above the
          <br />
          clouds
        </h1>
      </div>

      <p className="pointer-events-none absolute right-6 top-6 z-10 text-[11px] text-primary/50 md:right-10">
        drag to look around · scroll to zoom
      </p>
    </main>
  );
}
