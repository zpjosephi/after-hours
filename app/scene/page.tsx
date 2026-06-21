"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Clouds, Cloud, Float, OrbitControls, Sky, Sparkles } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, DepthOfField } from "@react-three/postprocessing";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";

/* Jagged rock geometry: displace an icosahedron's vertices with cheap noise. */
function useRockGeometry(radius: number, detail: number, amp: number) {
  return useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      const noise =
        Math.sin(v.x * 3.1 + v.y * 2.3) * Math.cos(v.z * 2.7 + v.x * 1.7) * 0.6 +
        Math.sin(v.y * 5.3 + v.z * 1.9) * 0.3;
      v.addScaledVector(n, noise * amp);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return geo;
  }, [radius, detail, amp]);
}

/* ---------------- Floating island ---------------- */
function Island({
  position,
  scale = 1,
  floatSpeed = 1,
}: {
  position: [number, number, number];
  scale?: number;
  floatSpeed?: number;
}) {
  const rock = useRockGeometry(1.1, 3, 0.16);
  const cap = useRockGeometry(1.04, 3, 0.06);

  return (
    <Float speed={floatSpeed} rotationIntensity={0.12} floatIntensity={0.8} floatingRange={[-0.3, 0.3]}>
      <group position={position} scale={scale}>
        {/* rock body, stretched downward into a chunk */}
        <mesh castShadow geometry={rock} position={[0, -0.25, 0]} scale={[1, 1.55, 1]}>
          <meshStandardMaterial color="#6b4f37" roughness={1} metalness={0} flatShading />
        </mesh>
        {/* grassy crown */}
        <mesh geometry={cap} position={[0, 0.5, 0]} scale={[1, 0.5, 1]}>
          <meshStandardMaterial color="#6f8a40" roughness={1} flatShading />
        </mesh>
      </group>
    </Float>
  );
}

/* ---------------- Particle waterfall ---------------- */
function Waterfall({
  position,
  height = 6,
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
      positions[i * 3 + 1] = -Math.random() * height;
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
      arr[i * 3 + 1] -= speeds[i] * Math.min(dt, 0.05);
      arr[i * 3] *= 1.0015;
      if (arr[i * 3 + 1] < -height) {
        arr[i * 3 + 1] = 0;
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
      <fog attach="fog" args={["#cdac8a", 13, 40]} />
      <Sky sunPosition={[12, 1.2, -8]} turbidity={12} rayleigh={1.1} mieCoefficient={0.02} mieDirectionalG={0.96} />

      {/* glowing sun disc to anchor the bloom */}
      <mesh position={[34, 3.4, -22]}>
        <sphereGeometry args={[3, 24, 24]} />
        <meshBasicMaterial color="#fff1cf" toneMapped={false} />
      </mesh>

      <ambientLight intensity={0.3} />
      <hemisphereLight args={["#ffe6c2", "#3a4763", 0.5]} />
      <directionalLight position={[10, 3, -6]} intensity={3.4} color="#ffc98a" castShadow />

      {/* floating islands */}
      <Island position={[0, 0.5, 0]} scale={1.2} floatSpeed={1.1} />
      <Island position={[-4.5, 2.6, -3]} scale={0.85} floatSpeed={0.8} />
      <Island position={[4.2, -1.4, -2]} scale={0.95} floatSpeed={1.3} />
      <Island position={[-2, -2.6, 1.5]} scale={0.7} floatSpeed={1.5} />
      <Island position={[2.5, 4.2, -6]} scale={0.6} floatSpeed={0.7} />
      <Island position={[-6.5, -0.5, -7]} scale={0.5} floatSpeed={0.9} />

      {/* waterfalls into the cloud sea */}
      <Waterfall position={[0.2, -0.9, 0.4]} height={6} />
      <Waterfall position={[4.2, -2.7, -1.8]} height={4.5} count={450} />

      {/* drifting dust motes catching the light */}
      <Sparkles count={120} scale={[22, 12, 22]} size={3} speed={0.3} opacity={0.5} color="#ffe9c8" />

      {/* volumetric cloud sea + mist at the waterfall bases */}
      <Clouds material={THREE.MeshBasicMaterial} limit={500}>
        <Cloud seed={1} bounds={[28, 3, 18]} volume={10} segments={60} color="#fff4e2" opacity={0.85} fade={32} speed={0.15} position={[0, -6.5, -2]} />
        <Cloud seed={7} bounds={[24, 2, 14]} volume={8} segments={48} color="#e7d3b6" opacity={0.7} fade={32} speed={0.1} position={[2, -8, -6]} />
        <Cloud seed={3} bounds={[4, 1.5, 4]} volume={4} segments={24} color="#ffffff" opacity={0.95} fade={10} speed={0.25} position={[0.4, -7, 0.2]} />
        <Cloud seed={9} bounds={[3, 1.2, 3]} volume={3} segments={20} color="#ffffff" opacity={0.9} fade={10} speed={0.3} position={[4.2, -7.2, -1.8]} />
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
        <DepthOfField target={[0, 0.5, 0]} focalLength={0.018} bokehScale={2.5} height={480} />
        <Bloom intensity={0.85} luminanceThreshold={0.75} luminanceSmoothing={0.25} mipmapBlur />
        <Vignette eskil={false} offset={0.3} darkness={0.85} />
      </EffectComposer>
    </>
  );
}

export default function ScenePage() {
  return (
    <main className="relative h-screen w-full bg-[#14213a]">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [7, 2.5, 11], fov: 42 }} gl={{ antialias: true, toneMappingExposure: 0.52 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>

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
