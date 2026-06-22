"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import {
  Clouds,
  Cloud,
  Float,
  OrbitControls,
  Sky,
  Sparkles,
  Environment,
  useTexture,
} from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  DepthOfField,
  GodRays,
  ChromaticAberration,
  Noise,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";

/* ---------------- Rock geometry: FBM-displaced icosahedron, grass on top ---------------- */
function useRockGeometry(radius: number, detail: number, amp: number) {
  return useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(radius, detail);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();
    const colors: number[] = [];
    const brown = new THREE.Color("#6d4f35");
    const brownDark = new THREE.Color("#4a3623");
    const grass = new THREE.Color("#6f8a3f");

    const hash = (x: number, y: number, z: number) =>
      ((Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1 + 1) % 1;
    const fbm = (x: number, y: number, z: number) => {
      let val = 0;
      let a = 0.5;
      let f = 1;
      for (let o = 0; o < 4; o++) {
        val += a * (hash(Math.floor(x * f), Math.floor(y * f), Math.floor(z * f)) - 0.5);
        f *= 2;
        a *= 0.5;
      }
      return val;
    };

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n = v.clone().normalize();
      const noise =
        Math.sin(v.x * 3.1 + v.y * 2.3) * Math.cos(v.z * 2.7 + v.x * 1.7) * 0.5 +
        fbm(v.x * 2.0, v.y * 2.0, v.z * 2.0) * 1.4;
      v.addScaledVector(n, noise * amp);
      pos.setXYZ(i, v.x, v.y, v.z);

      // grass on the upper, near-flat top; rock on the sides/underside
      const up = THREE.MathUtils.clamp((v.y / radius + 0.15) * 1.4, 0, 1);
      const grassMask = THREE.MathUtils.smoothstep(up, 0.55, 0.85);
      const c = brown.clone().lerp(brownDark, 0.5 - v.y / (radius * 2));
      c.lerp(grass, grassMask);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
  }, [radius, detail, amp]);
}

/* ---------------- Triplanar PBR rock material (no UVs needed) ----------------
   World-space triplanar sampling: project the texture down all three axes and
   blend by the surface normal, so a procedural blob gets real rock detail with
   zero stretching. Vertex colors stay as a tint so the grassy top survives.   */
function useRockMaterial() {
  const maps = useTexture({
    map: "/tex/rock/rock_06_diff_1k.jpg",
    normalMap: "/tex/rock/rock_06_nor_gl_1k.jpg",
    roughnessMap: "/tex/rock/rock_06_rough_1k.jpg",
    aoMap: "/tex/rock/rock_06_ao_1k.jpg",
  });

  return useMemo(() => {
    const { map, normalMap, roughnessMap, aoMap } = maps;
    [map, normalMap, roughnessMap, aoMap].forEach((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.colorSpace = THREE.NoColorSpace; // we linearize the albedo manually in-shader
    });

    const mat = new THREE.MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      envMapIntensity: 0.55,
    });

    const uScale = { value: 0.55 };
    const uNormStr = { value: 0.7 };

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uScale = uScale;
      shader.uniforms.uNormStr = uNormStr;
      shader.uniforms.tDiff = { value: map };
      shader.uniforms.tNor = { value: normalMap };
      shader.uniforms.tRough = { value: roughnessMap };
      shader.uniforms.tAO = { value: aoMap };

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           varying vec3 vWPos;
           varying vec3 vWNor;`
        )
        .replace(
          "#include <worldpos_vertex>",
          `#include <worldpos_vertex>
           vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vWNor = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           varying vec3 vWPos;
           varying vec3 vWNor;
           uniform float uScale;
           uniform float uNormStr;
           uniform sampler2D tDiff;
           uniform sampler2D tNor;
           uniform sampler2D tRough;
           uniform sampler2D tAO;
           vec3 triWeights(vec3 n){ vec3 b = pow(abs(n), vec3(4.0)); return b / (b.x + b.y + b.z + 1e-5); }
           vec4 triSample(sampler2D s, vec3 p, vec3 w){
             return texture2D(s, p.yz) * w.x + texture2D(s, p.zx) * w.y + texture2D(s, p.xy) * w.z;
           }`
        )
        .replace(
          "#include <map_fragment>",
          `vec3 triW = triWeights(vWNor);
           vec3 triP = vWPos * uScale;
           vec3 rockAlb = triSample(tDiff, triP, triW).rgb;
           rockAlb = pow(rockAlb, vec3(2.2)); // sRGB -> linear
           // grass clings to up-facing faces; rock everywhere else
           float upFace = smoothstep(0.30, 0.72, vWNor.y);
           vec3 grassCol = vec3(0.16, 0.30, 0.08) * (0.7 + 0.6 * rockAlb.g);
           vec3 albedo = mix(rockAlb, grassCol, upFace);
           diffuseColor.rgb *= albedo;`
        )
        .replace(
          "#include <roughnessmap_fragment>",
          `float roughnessFactor = roughness;
           { vec3 wR = triWeights(vWNor); float r = triSample(tRough, vWPos * uScale, wR).g; roughnessFactor *= r; }`
        )
        .replace(
          "#include <normal_fragment_maps>",
          `vec3 wN = triWeights(vWNor);
           vec3 nTex = triSample(tNor, vWPos * uScale, wN).xyz * 2.0 - 1.0;
           normal = normalize(vWNor + nTex * uNormStr);`
        )
        .replace(
          "#include <aomap_fragment>",
          `{ vec3 wA = triWeights(vWNor); float ao = triSample(tAO, vWPos * uScale, wA).r; reflectedLight.indirectDiffuse *= ao; }`
        );
    };
    mat.customProgramCacheKey = () => "triplanar-rock-v1";
    return mat;
  }, [maps]);
}

function Island({
  position,
  scale = 1,
  floatSpeed = 1,
  material,
}: {
  position: [number, number, number];
  scale?: number;
  floatSpeed?: number;
  material: THREE.Material;
}) {
  const geo = useRockGeometry(1.1, 4, 0.2);
  return (
    <Float speed={floatSpeed} rotationIntensity={0.1} floatIntensity={0.8} floatingRange={[-0.3, 0.3]}>
      <mesh
        geometry={geo}
        material={material}
        position={position}
        scale={[scale, scale * 1.45, scale]}
        castShadow
        receiveShadow
      />
    </Float>
  );
}

/* ---------------- GLSL water shader ---------------- */
const WATER_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const WATER_FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){
    vec2 i=floor(p); vec2 f=fract(p);
    f=f*f*(3.0-2.0*f);
    float a=hash(i), b=hash(i+vec2(1.0,0.0)), c=hash(i+vec2(0.0,1.0)), d=hash(i+vec2(1.0,1.0));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }
  float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v; }

  void main(){
    vec2 uv = vUv;
    float t = uTime;
    // streaks flowing downward (uv.y: 1 = top/lip, 0 = bottom)
    float flow    = fbm(vec2(uv.x*6.0,  uv.y*9.0  + t*2.4));
    float streaks = fbm(vec2(uv.x*22.0, uv.y*4.0  + t*3.6));
    float water = flow*0.55 + streaks*0.55;

    vec3 colA = vec3(0.74, 0.88, 1.0);
    vec3 colB = vec3(0.96, 0.99, 1.0);
    vec3 col = mix(colA, colB, water);

    // foam at the lip and a glow throughout
    float lipFoam = smoothstep(0.82, 1.0, uv.y);
    col = mix(col, vec3(1.0), lipFoam*0.85);

    // horizontal edge falloff + bottom fade into mist
    float edge = smoothstep(0.0,0.16,uv.x) * smoothstep(1.0,0.84,uv.x);
    float alpha = (0.32 + water*0.7) * edge * smoothstep(0.0,0.22,uv.y);

    gl_FragColor = vec4(col, alpha);
  }
`;

function ShaderWaterfall({
  position,
  width = 1.2,
  height = 6,
}: {
  position: [number, number, number];
  width?: number;
  height?: number;
}) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((state) => {
    uniforms.uTime.value = state.clock.elapsedTime;
  });
  return (
    <group position={position}>
      {[0, Math.PI / 2].map((ry, i) => (
        <mesh key={i} rotation={[0, ry, 0]}>
          <planeGeometry args={[width, height, 1, 1]} />
          <shaderMaterial
            uniforms={uniforms}
            vertexShader={WATER_VERT}
            fragmentShader={WATER_FRAG}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- Stylized tree (trunk + low-poly canopy) ---------------- */
function Tree({
  position = [0, 0, 0],
  scale = 1,
}: {
  position?: [number, number, number];
  scale?: number;
}) {
  const barkMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#5b4329", roughness: 0.92, metalness: 0 }),
    []
  );
  const leafMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#6f8f43",
        roughness: 0.82,
        metalness: 0,
        flatShading: true,
        envMapIntensity: 0.4,
      }),
    []
  );
  return (
    <group position={position} scale={scale}>
      {/* trunk, leaning a touch */}
      <mesh material={barkMat} position={[0, 0.7, 0]} rotation={[0, 0, 0.07]} castShadow>
        <cylinderGeometry args={[0.07, 0.17, 1.5, 8]} />
      </mesh>
      {/* two branches */}
      <mesh material={barkMat} position={[0.16, 1.2, 0.02]} rotation={[0, 0, -0.8]} castShadow>
        <cylinderGeometry args={[0.025, 0.07, 0.75, 6]} />
      </mesh>
      <mesh material={barkMat} position={[-0.14, 1.05, -0.05]} rotation={[0.2, 0, 0.7]} castShadow>
        <cylinderGeometry args={[0.025, 0.06, 0.6, 6]} />
      </mesh>
      {/* canopy: overlapping faceted blobs */}
      <mesh material={leafMat} position={[0, 1.75, 0]} castShadow>
        <icosahedronGeometry args={[0.66, 1]} />
      </mesh>
      <mesh material={leafMat} position={[0.42, 1.5, 0.16]} castShadow>
        <icosahedronGeometry args={[0.4, 1]} />
      </mesh>
      <mesh material={leafMat} position={[-0.38, 1.55, -0.12]} castShadow>
        <icosahedronGeometry args={[0.43, 1]} />
      </mesh>
      <mesh material={leafMat} position={[0.08, 2.12, -0.05]} castShadow>
        <icosahedronGeometry args={[0.34, 1]} />
      </mesh>
    </group>
  );
}

/* ---------------- Roots dangling from the island underside ---------------- */
function Roots({ material }: { material: THREE.Material }) {
  const roots: { x: number; z: number; len: number; tilt: [number, number, number] }[] = [
    { x: 0.05, z: 0.0, len: 1.6, tilt: [0.1, 0, 0.05] },
    { x: 0.32, z: 0.18, len: 1.1, tilt: [0.2, 0, -0.25] },
    { x: -0.28, z: -0.14, len: 1.25, tilt: [-0.18, 0, 0.3] },
    { x: 0.12, z: -0.3, len: 0.9, tilt: [0.35, 0, 0.1] },
    { x: -0.2, z: 0.26, len: 1.0, tilt: [-0.3, 0, -0.15] },
  ];
  return (
    <group position={[0, -1.5, 0]}>
      {roots.map((r, i) => (
        <mesh
          key={i}
          material={material}
          position={[r.x, -r.len / 2, r.z]}
          rotation={r.tilt}
          castShadow
        >
          {/* fat where it meets the rock, tapering to a thin tip */}
          <cylinderGeometry args={[0.11, 0.015, r.len, 6]} />
        </mesh>
      ))}
    </group>
  );
}

/* ---------------- Hero island: rock + tree + roots, bobbing as one ---------------- */
function HeroIsland({ material }: { material: THREE.Material }) {
  const geo = useRockGeometry(1.1, 4, 0.2);
  const barkMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#4a3623", roughness: 1, metalness: 0 }),
    []
  );
  return (
    <Float speed={0.8} rotationIntensity={0.05} floatIntensity={0.5} floatingRange={[-0.2, 0.2]}>
      <group position={[0, 0.3, 0]}>
        <mesh geometry={geo} material={material} scale={[1.7, 2.45, 1.7]} castShadow receiveShadow />
        <Tree position={[0, 1.95, 0]} scale={1.05} />
        <Roots material={barkMat} />
      </group>
    </Float>
  );
}

/* ---------------- Scene ---------------- */
function Scene() {
  const [sun, setSun] = useState<THREE.Mesh | null>(null);
  const rockMat = useRockMaterial();

  return (
    <>
      <fog attach="fog" args={["#cdac8a", 13, 42]} />
      <Sky sunPosition={[12, 1.2, -8]} turbidity={11} rayleigh={1.0} mieCoefficient={0.02} mieDirectionalG={0.96} />

      {/* real captured HDRI (Poly Haven, golden hour) drives ambient + reflections; sky stays procedural */}
      <Environment files="/hdri/venice_sunset_1k.hdr" environmentIntensity={0.85} />

      {/* sun disc — both a visible light source and the god-ray origin */}
      <mesh ref={setSun} position={[34, 3.4, -22]}>
        <sphereGeometry args={[3, 24, 24]} />
        <meshBasicMaterial color="#fff1cf" toneMapped={false} />
      </mesh>

      {/* HDRI now carries the fill, so direct lights only add the warm key + crisp shadow */}
      <ambientLight intensity={0.12} />
      <hemisphereLight args={["#ffe6c2", "#3a4763", 0.22]} />
      <directionalLight
        position={[10, 3, -6]}
        intensity={2.6}
        color="#ffc98a"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-radius={5}
      />

      {/* the hero: one detailed island carrying the tree + roots */}
      <HeroIsland material={rockMat} />

      {/* distant supporting islands — small, set back so they read as hazy silhouettes */}
      <Island position={[-6, 4.3, -8]} scale={0.45} floatSpeed={0.7} material={rockMat} />
      <Island position={[6.6, 3.6, -9]} scale={0.4} floatSpeed={0.95} material={rockMat} />
      <Island position={[5.6, -3, -7]} scale={0.5} floatSpeed={1.2} material={rockMat} />

      {/* the waterfall pouring off the hero island into the cloud sea */}
      <ShaderWaterfall position={[0.2, -2.4, 0.35]} width={1.4} height={6.5} />

      {/* drifting dust motes */}
      <Sparkles count={140} scale={[24, 13, 24]} size={3} speed={0.3} opacity={0.5} color="#ffe9c8" />

      {/* volumetric cloud sea + mist at the waterfall bases */}
      <Clouds material={THREE.MeshBasicMaterial} limit={500}>
        <Cloud seed={1} bounds={[28, 3, 18]} volume={10} segments={60} color="#fff4e2" opacity={0.85} fade={32} speed={0.15} position={[0, -6.5, -2]} />
        <Cloud seed={7} bounds={[24, 2, 14]} volume={8} segments={48} color="#e7d3b6" opacity={0.7} fade={32} speed={0.1} position={[2, -8, -6]} />
        <Cloud seed={3} bounds={[4, 1.5, 4]} volume={4} segments={24} color="#ffffff" opacity={0.95} fade={10} speed={0.25} position={[0.4, -6.6, 0.2]} />
        <Cloud seed={9} bounds={[3, 1.2, 3]} volume={3} segments={20} color="#ffffff" opacity={0.9} fade={10} speed={0.3} position={[4.2, -7, -1.8]} />
      </Clouds>

      <OrbitControls
        autoRotate
        autoRotateSpeed={0.32}
        enablePan={false}
        enableZoom
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 1.9}
        minDistance={8}
        maxDistance={20}
        target={[0, 0, 0]}
      />

      {sun && (
        <EffectComposer>
          <GodRays sun={sun} samples={60} density={0.95} decay={0.93} weight={0.5} exposure={0.4} clampMax={1} blur />
          <Bloom intensity={0.8} luminanceThreshold={0.75} luminanceSmoothing={0.25} mipmapBlur />
          <DepthOfField target={[0, 0.5, 0]} focalLength={0.02} bokehScale={2.5} height={420} />
          <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={[0.0008, 0.0008]} />
          <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.22} />
          <Vignette eskil={false} offset={0.3} darkness={0.85} />
        </EffectComposer>
      )}
    </>
  );
}

export default function ScenePage() {
  return (
    <main className="relative h-screen w-full bg-[#14213a]">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: [7, 2.5, 11], fov: 42 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.62 }}
      >
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
