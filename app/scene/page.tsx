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
  useGLTF,
  useAnimations,
  PerformanceMonitor,
  Loader,
} from "@react-three/drei";
import {
  EffectComposer,
  Bloom,
  Vignette,
  DepthOfField,
  GodRays,
  ChromaticAberration,
  Noise,
  HueSaturation,
  BrightnessContrast,
} from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import {
  Suspense,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";

/* honor the OS "reduce motion" setting across the whole scene */
const ReducedMotion = createContext(false);

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

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

/* ---------------- Expansive island terrain ----------------
   A broad grassy plateau with cliff sides tapering to a rocky point underneath.
   A shallow river channel is carved across the top toward +X, ending in a notch
   in the rim — that notch is where the waterfall pours over the cliff.        */
const ISLE = {
  topR: 3.4, // plateau radius — wide, so it reads as land, not a pebble
  plateauH: 0.5, // gentle top relief
  depth: 5.4, // how far the underside points down
  hillAmp: 0.85,
  lipY: -0.62, // height of the carved spout where water leaves the island
};

// where the figure sits; grass leaves a clearing here
const CODER_POS: [number, number, number] = [2.35, 0.14, 1.42];

// shared noise so the grass scatters onto the exact terrain the geometry builds
const ihash3 = (x: number, y: number, z: number) =>
  ((Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1 + 1) % 1;
const ifbm3 = (x: number, y: number, z: number) => {
  let v = 0, a = 0.5, f = 1;
  for (let o = 0; o < 4; o++) {
    v += a * (ihash3(Math.floor(x * f), Math.floor(y * f), Math.floor(z * f)) - 0.5);
    f *= 2; a *= 0.5;
  }
  return v;
};
const ihash2 = (x: number, z: number) =>
  ((Math.sin(x * 127.1 + z * 311.7) * 43758.5453) % 1 + 1) % 1;
const inoise2 = (x: number, z: number) => {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), w = zf * zf * (3 - 2 * zf);
  const a = ihash2(xi, zi), b = ihash2(xi + 1, zi), c = ihash2(xi, zi + 1), d = ihash2(xi + 1, zi + 1);
  return a * (1 - u) * (1 - w) + b * u * (1 - w) + c * (1 - u) * w + d * u * w;
};
const ifbm2 = (x: number, z: number) => {
  let v = 0, a = 0.5;
  for (let o = 0; o < 4; o++) { v += a * inoise2(x, z); x *= 2; z *= 2; a *= 0.5; }
  return v;
};

// height of the plateau surface at local (X,Z); null outside the rim
function islandTopHeight(X: number, Z: number): number | null {
  const { topR, plateauH, hillAmp } = ISLE;
  const nx = X / topR, nz = Z / topR;
  const rr = Math.hypot(nx, nz);
  if (rr > 1) return null;
  const ny = Math.sqrt(Math.max(0, 1 - rr * rr));
  const rim = THREE.MathUtils.smoothstep(rr, 0.8, 1.0);
  const hills = ifbm2(X * 0.38 + 10, Z * 0.38 + 10) * hillAmp * (1 - rim) * THREE.MathUtils.smoothstep(rr, 0.08, 0.42);
  let Y = ny * plateauH + hills;
  const horiz = Math.max(1e-5, Math.hypot(nx, nz));
  const dx = nx / horiz, dz = nz / horiz;
  const channel = Math.max(0, dx) * Math.exp(-(dz * dz) / 0.05);
  Y -= channel * 0.62 * THREE.MathUtils.smoothstep(rr, 0.1, 1.0);
  return Y;
}

function useIslandGeometry(detail: number) {
  return useMemo(() => {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const pos = geo.attributes.position;
    const p = new THREE.Vector3();
    const { topR, depth } = ISLE;

    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const nx = p.x, ny = p.y, nz = p.z; // point on the unit sphere
      let X: number, Y: number, Z: number;

      if (ny >= 0) {
        // TOP: flatten the upper hemisphere into a wide plateau (shared height fn)
        X = nx * topR;
        Z = nz * topR;
        Y = islandTopHeight(X, Z) ?? 0;
      } else {
        // UNDERSIDE: converge the lower hemisphere to a craggy point
        const t = -ny; // 0 at rim, 1 at the bottom point
        const conv = Math.pow(1 - t, 0.6);
        const crag = ifbm3(nx * 2.0, ny * 2.0, nz * 2.0);
        X = nx * topR * conv + nx * crag * t;
        Z = nz * topR * conv + nz * crag * t;
        Y = -t * depth - crag * 0.6 * t;
      }
      pos.setXYZ(i, X, Y, Z);
    }
    geo.computeVertexNormals();
    return geo;
  }, [detail]);
}

/* ---------------- Triplanar PBR rock material (no UVs needed) ----------------
   World-space triplanar sampling: project the texture down all three axes and
   blend by the surface normal, so a procedural blob gets real rock detail with
   zero stretching. Vertex colors stay as a tint so the grassy top survives.   */
function useRockMaterial(grassy = true) {
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
    const uNormStr = { value: 0.95 };

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
           // break the rock up with damp/dry tonal variation so it reads less uniform
           float macro = triSample(tDiff, triP * 0.18, triW).r;
           rockAlb *= 0.78 + 0.5 * macro;
           // moss creeps into upward crevices (where AO is low but the face tilts up)
           float upTilt = smoothstep(0.05, 0.6, vWNor.y);
           float mossN = triSample(tDiff, triP * 0.6, triW).g;
           vec3 mossCol = vec3(0.10, 0.20, 0.06);
           vec3 albedo = mix(rockAlb, mossCol, upTilt * smoothstep(0.45, 0.75, mossN) * 0.6);
           ${grassy
             ? `// grass cap clings to the near-flat top
                float upFace = smoothstep(0.42, 0.78, vWNor.y);
                vec3 grassCol = vec3(0.16, 0.30, 0.08) * (0.7 + 0.6 * rockAlb.g);
                albedo = mix(albedo, grassCol, upFace);`
             : ``}
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
    mat.customProgramCacheKey = () => (grassy ? "triplanar-rock-grass-v2" : "triplanar-rock-bare-v2");
    return mat;
  }, [maps, grassy]);
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
  const reduced = useContext(ReducedMotion);
  return (
    <Float
      speed={reduced ? 0 : floatSpeed}
      rotationIntensity={reduced ? 0 : 0.1}
      floatIntensity={reduced ? 0 : 0.8}
      floatingRange={[-0.3, 0.3]}
    >
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
    vec2 uv = vUv;            // uv.y: 1 = top/lip, 0 = bottom
    float t = uTime;
    float fall = uv.y - t * 0.95;   // scroll the pattern downward over time

    // domain-warp the columns so they curve and churn instead of being straight lines
    float warp = fbm(vec2(uv.x * 4.0, fall * 1.6)) - 0.5;
    float sx = uv.x + warp * 0.28;

    float streaks = fbm(vec2(sx * 25.0, fall * 2.2));
    float body    = fbm(vec2(sx * 7.0,  fall * 3.4));
    float foamN   = fbm(vec2(uv.x * 11.0 + 3.0, fall * 5.0));
    float water   = body * 0.45 + streaks * 0.55;

    vec3 deep = vec3(0.45, 0.69, 0.89);
    vec3 foam = vec3(1.0);
    vec3 col = mix(deep, foam, clamp(water, 0.0, 1.0));

    // turbulent foam patches + bright lip and impact base
    col = mix(col, foam, smoothstep(0.55, 0.9, foamN) * 0.5);
    float lip  = smoothstep(0.85, 1.0, uv.y);
    float base = smoothstep(0.18, 0.0, uv.y);
    col = mix(col, foam, max(lip, base) * 0.85);

    // soft feathered edges; broken alpha (streaks + foam) reads as volume, not paper
    float edge = smoothstep(0.0, 0.18, uv.x) * smoothstep(1.0, 0.82, uv.x);
    float bands = smoothstep(0.24, 0.70, streaks);
    float alpha = edge * (0.30 + 0.5 * water);
    alpha = mix(alpha * 0.4, alpha, bands);
    alpha = max(alpha, base * edge * 0.7);
    alpha = max(alpha, smoothstep(0.6, 0.95, foamN) * edge * 0.55);
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.9));
  }
`;

function ShaderWaterfall({
  position,
  width = 1.2,
  height = 6,
  faceAxis,
}: {
  position: [number, number, number];
  width?: number;
  height?: number;
  faceAxis?: "x" | "z";
}) {
  const reduced = useContext(ReducedMotion);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((state) => {
    if (!reduced) uniforms.uTime.value = state.clock.elapsedTime;
  });
  // a shallow fan facing outward off the cliff, or a perpendicular cross for free-standing falls
  const angles =
    faceAxis === "x" ? [Math.PI / 2 - 0.34, Math.PI / 2, Math.PI / 2 + 0.34] : [0, Math.PI / 2];
  return (
    <group position={position}>
      {angles.map((ry, i) => (
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

/* ---------------- Real photogrammetry tree (Poly Haven, simplified) ---------------- */
function RealTree({
  position,
  scale = 1,
  rotation = 0,
}: {
  position: [number, number, number];
  scale?: number;
  rotation?: number;
}) {
  const { scene } = useGLTF("/models/tree.glb");
  const tree = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const m = mesh.material as THREE.MeshStandardMaterial;
        if (m) m.envMapIntensity = 0.6;
      }
    });
    return c;
  }, [scene]);
  return <primitive object={tree} position={position} scale={scale} rotation={[0, rotation, 0]} />;
}
useGLTF.preload("/models/tree.glb");

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
        envMapIntensity: 0.4,
      }),
    []
  );
  return (
    <group position={position} scale={scale}>
      {/* trunk, short and sturdy, leaning a touch */}
      <mesh material={barkMat} position={[0, 0.52, 0]} rotation={[0, 0, 0.06]} castShadow>
        <cylinderGeometry args={[0.1, 0.22, 1.1, 12]} />
      </mesh>
      {/* two branches reaching into the canopy */}
      <mesh material={barkMat} position={[0.18, 0.95, 0.02]} rotation={[0, 0, -0.8]} castShadow>
        <cylinderGeometry args={[0.03, 0.08, 0.6, 8]} />
      </mesh>
      <mesh material={barkMat} position={[-0.15, 0.85, -0.05]} rotation={[0.2, 0, 0.7]} castShadow>
        <cylinderGeometry args={[0.03, 0.07, 0.5, 8]} />
      </mesh>
      {/* canopy: overlapping smooth blobs, full and low over the trunk */}
      <mesh material={leafMat} position={[0, 1.32, 0]} castShadow>
        <icosahedronGeometry args={[0.82, 3]} />
      </mesh>
      <mesh material={leafMat} position={[0.55, 1.05, 0.18]} castShadow>
        <icosahedronGeometry args={[0.52, 3]} />
      </mesh>
      <mesh material={leafMat} position={[-0.5, 1.12, -0.14]} castShadow>
        <icosahedronGeometry args={[0.56, 3]} />
      </mesh>
      <mesh material={leafMat} position={[0.1, 1.78, -0.05]} castShadow>
        <icosahedronGeometry args={[0.46, 3]} />
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
    <group position={[0, -2.9, 0]} scale={1.7}>
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

/* ---------------- Reflective water pool with animated ripples ---------------- */
function WaterPool({
  position,
  radius,
}: {
  position: [number, number, number];
  radius: number;
}) {
  const reduced = useContext(ReducedMotion);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: "#2f6b7e",
      transparent: true,
      opacity: 0.86,
      roughness: 0.05,
      metalness: 0,
      envMapIntensity: 1.25,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vPXZ;")
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\nvPXZ = (modelMatrix * vec4(position, 1.0)).xz;"
        );
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying vec2 vPXZ;")
        .replace(
          "#include <normal_fragment_maps>",
          `vec2 p = vPXZ * 6.0;
           float t = uTime * 1.1;
           float e = 0.08;
           #define WAVE(q) (sin((q).x * 1.3 + t) * 0.5 + sin((q).y * 1.7 - t * 1.1) * 0.5 + sin(((q).x + (q).y) * 2.3 + t * 0.7) * 0.3)
           float h  = WAVE(p);
           float hx = WAVE(p + vec2(e, 0.0));
           float hy = WAVE(p + vec2(0.0, e));
           vec3 ripple = normalize(vec3((h - hx) / e * 0.15, 1.0, (h - hy) / e * 0.15));
           normal = normalize(normal + ripple * 0.4);`
        );
    };
    m.customProgramCacheKey = () => "water-ripple-v1";
    return m;
  }, [uniforms]);
  useFrame((s) => {
    if (!reduced) uniforms.uTime.value = s.clock.elapsedTime;
  });
  return (
    <mesh material={mat} position={position} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[radius, 36]} />
    </mesh>
  );
}

/* ---------------- Stream: a ribbon of flowing water hugging the channel ---------------- */
const STREAM_X0 = -0.65; // starts at the upper fall's landing pool
const STREAM_X1 = 3.32;
const STREAM_HALFW = 0.46; // half-width, matched to the waterfalls
function buildStreamGeometry() {
  const N = 48;
  const g = new THREE.PlaneGeometry(1, 1, N, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5; // 0..1 along the flow
    const v = pos.getY(i) + 0.5; // 0..1 across
    const x = STREAM_X0 + (STREAM_X1 - STREAM_X0) * u;
    const halfW = STREAM_HALFW - 0.04 * u; // roughly the waterfall width
    const z = (v - 0.5) * 2 * halfW;
    const h = islandTopHeight(x, z);
    const Y = (h === null ? ISLE.lipY : h) + 0.05;
    pos.setXYZ(i, x, Y, z);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function Stream() {
  const reduced = useContext(ReducedMotion);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  const geo = useMemo(() => buildStreamGeometry(), []);
  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.92,
      roughness: 0.1,
      metalness: 0,
      envMapIntensity: 1.0,
      side: THREE.DoubleSide,
    });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vSX;\nvarying float vSZ;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSX = position.x;\nvSZ = position.z;");
      sh.fragmentShader = sh.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           uniform float uTime;
           varying float vSX;
           varying float vSZ;
           float sh21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
           float svn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
             float a=sh21(i), b=sh21(i+vec2(1,0)), c=sh21(i+vec2(0,1)), d=sh21(i+vec2(1,1));
             return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }`
        )
        .replace(
          "#include <normal_fragment_maps>",
          `float u = clamp((vSX - ${STREAM_X0.toFixed(2)}) / (${(STREAM_X1 - STREAM_X0).toFixed(2)}), 0.0, 1.0);
           float t = uTime;
           float e = 0.03;
           float fl  = svn(vec2(u * 14.0 - t * 1.8, vSZ * 18.0));
           float flx = svn(vec2((u + e) * 14.0 - t * 1.8, vSZ * 18.0));
           normal = normalize(normal + vec3((fl - flx) / e * 0.12, 0.0, 0.0));`
        )
        .replace(
          "#include <map_fragment>",
          `float uu = clamp((vSX - ${STREAM_X0.toFixed(2)}) / (${(STREAM_X1 - STREAM_X0).toFixed(2)}), 0.0, 1.0);
           float foam = svn(vec2(uu * 26.0 - uTime * 2.6, vSZ * 22.0));
           vec3 water = vec3(0.22, 0.45, 0.5);
           // foam streaks + brighter as it nears the lip
           water = mix(water, vec3(1.0), smoothstep(0.62, 0.96, foam) * 0.55 + smoothstep(0.72, 1.0, uu) * 0.35);
           diffuseColor.rgb *= water;`
        );
    };
    m.customProgramCacheKey = () => "stream-flow-v1";
    return m;
  }, [uniforms]);
  useFrame((s) => {
    if (!reduced) uniforms.uTime.value = s.clock.elapsedTime;
  });
  return <mesh geometry={geo} material={mat} renderOrder={1} />;
}

/* ---------------- Hero island: rock + tree + roots, bobbing as one ---------------- */
function HeroIsland({ material }: { material: THREE.Material }) {
  // wide terrain island, smooth and expansive
  const geo = useIslandGeometry(6);
  const boulderGeo = useRockGeometry(1.1, 5, 0.42);
  const boulderMat = useRockMaterial(false); // bare rock, no grass cap
  const barkMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#4a3623", roughness: 1, metalness: 0 }),
    []
  );
  const reduced = useContext(ReducedMotion);
  return (
    <Float
      speed={reduced ? 0 : 0.7}
      rotationIntensity={reduced ? 0 : 0.04}
      floatIntensity={reduced ? 0 : 0.45}
      floatingRange={[-0.2, 0.2]}
    >
      <group position={[0, 1.2, 0]}>
        <mesh geometry={geo} material={material} castShadow receiveShadow />
        <Grass />
        {/* real tree, off to the back away from the water */}
        <RealTree position={[-0.2, 0.42, -1.7]} scale={1.0} />
        {/* a real person working at the rim; the laptop is parented to their spine bone */}
        <Person position={CODER_POS} scale={1.0} rotation={1.0} />
        <Roots material={barkMat} />

        {/* CASCADE, tier 1: a tall rock outcrop the upper fall pours from */}
        <mesh
          geometry={boulderGeo}
          material={boulderMat}
          position={[-1.75, 1.5, 0]}
          scale={[1.0, 2.15, 0.85]}
          castShadow
          receiveShadow
        />
        {/* spring on top, the upper fall down its face, and the pool it lands in */}
        <WaterPool position={[-1.6, 3.1, 0]} radius={0.42} />
        <ShaderWaterfall position={[-0.66, 1.85, 0]} width={0.92} height={2.6} faceAxis="x" />
        <WaterPool position={[-0.5, 0.5, 0]} radius={0.55} />

        {/* the stream carries the water across the plateau to the rim */}
        <Stream />

        {/* CASCADE, tier 2: over the cliff and down into the cloud sea */}
        <ShaderWaterfall position={[3.45, -4.1, 0]} width={0.95} height={7} faceAxis="x" />

        {/* misty spray columns running the length of each fall, plus heavier mist at the feet */}
        <Sparkles count={70} scale={[0.7, 2.6, 0.55]} position={[-0.66, 1.85, 0]} size={4} speed={reduced ? 0 : 0.7} opacity={0.6} color="#ffffff" />
        <Sparkles count={42} scale={[1.1, 0.8, 1.0]} position={[-0.5, 0.7, 0]} size={6} speed={reduced ? 0 : 0.8} opacity={0.6} color="#ffffff" />
        <Sparkles count={150} scale={[0.85, 7, 0.55]} position={[3.45, -4.1, 0]} size={5} speed={reduced ? 0 : 0.9} opacity={0.55} color="#ffffff" />
        <Sparkles count={80} scale={[2.0, 1.8, 1.5]} position={[3.5, -6.7, 0]} size={8} speed={reduced ? 0 : 1.1} opacity={0.5} color="#ffffff" />
      </group>
    </Float>
  );
}

/* ---------------- Distant islands: same terrain, small and hazy ---------------- */
function DistantIsland({
  geometry,
  material,
  position,
  scale,
  floatSpeed,
}: {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  position: [number, number, number];
  scale: number;
  floatSpeed: number;
}) {
  const reduced = useContext(ReducedMotion);
  return (
    <Float
      speed={reduced ? 0 : floatSpeed}
      rotationIntensity={reduced ? 0 : 0.05}
      floatIntensity={reduced ? 0 : 0.7}
      floatingRange={[-0.3, 0.3]}
    >
      <mesh geometry={geometry} material={material} position={position} scale={scale} castShadow />
    </Float>
  );
}

/* ---------------- A seated figure: the scene's quiet focal point ---------------- */
function SeatedFigure({
  position,
  scale = 1,
}: {
  position: [number, number, number];
  scale?: number;
}) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#26252b", roughness: 0.95, metalness: 0 }),
    []
  );
  return (
    <group position={position} scale={scale} rotation={[0, -0.7, 0]}>
      <mesh material={mat} position={[0, 0.18, 0]} castShadow>
        <boxGeometry args={[0.26, 0.18, 0.22]} />
      </mesh>
      <mesh material={mat} position={[0, 0.44, -0.04]} rotation={[-0.18, 0, 0]} castShadow>
        <capsuleGeometry args={[0.12, 0.26, 4, 8]} />
      </mesh>
      <mesh material={mat} position={[0, 0.74, 0.02]} castShadow>
        <sphereGeometry args={[0.1, 16, 16]} />
      </mesh>
      {/* thighs forward, shins down — a sitting pose */}
      <mesh material={mat} position={[0, 0.13, 0.24]} rotation={[1.25, 0, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.3, 4, 8]} />
      </mesh>
      {/* an arm resting on the knee */}
      <mesh material={mat} position={[0.13, 0.3, 0.18]} rotation={[0.9, 0, -0.2]} castShadow>
        <capsuleGeometry args={[0.05, 0.24, 4, 8]} />
      </mesh>
    </group>
  );
}

/* ---------------- Angler: a seated figure fishing over the edge ---------------- */
function Angler({
  position,
  scale = 1,
  rotation = 0,
}: {
  position: [number, number, number];
  scale?: number;
  rotation?: number;
}) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#262530", roughness: 0.95, metalness: 0 }),
    []
  );
  const rodMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a2c1c", roughness: 0.8, metalness: 0 }),
    []
  );
  return (
    <group position={position} scale={scale} rotation={[0, rotation, 0]}>
      {/* hips */}
      <mesh material={mat} position={[0, 0.16, 0]} castShadow>
        <boxGeometry args={[0.22, 0.16, 0.26]} />
      </mesh>
      {/* torso leaning forward over the edge */}
      <mesh material={mat} position={[0.03, 0.4, 0]} rotation={[0, 0, -0.28]} castShadow>
        <capsuleGeometry args={[0.11, 0.24, 4, 8]} />
      </mesh>
      {/* head */}
      <mesh material={mat} position={[0.14, 0.63, 0]} castShadow>
        <sphereGeometry args={[0.095, 16, 16]} />
      </mesh>
      {/* legs dangling forward over the edge */}
      <mesh material={mat} position={[0.24, 0.0, 0.09]} rotation={[0, 0, -1.2]} castShadow>
        <capsuleGeometry args={[0.06, 0.34, 4, 8]} />
      </mesh>
      <mesh material={mat} position={[0.24, 0.0, -0.09]} rotation={[0, 0, -1.2]} castShadow>
        <capsuleGeometry args={[0.06, 0.34, 4, 8]} />
      </mesh>
      {/* arm reaching to the rod */}
      <mesh material={mat} position={[0.22, 0.42, 0.1]} rotation={[0, 0, -1.05]} castShadow>
        <capsuleGeometry args={[0.045, 0.26, 4, 8]} />
      </mesh>
      {/* the rod, angled up and out */}
      <mesh material={rodMat} position={[0.55, 0.64, 0.1]} rotation={[0, 0, -0.5]} castShadow>
        <cylinderGeometry args={[0.012, 0.022, 1.35, 6]} />
      </mesh>
      {/* line dropping from the tip down over the edge */}
      <mesh material={mat} position={[0.92, -0.2, 0.1]}>
        <cylinderGeometry args={[0.004, 0.004, 2.7, 4]} />
      </mesh>
    </group>
  );
}

/* a laptop as a plain THREE group so it can be parented to a hand/spine bone */
function buildLaptop() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: "#9aa0aa", roughness: 0.35, metalness: 0.7 });
  const screenMat = new THREE.MeshStandardMaterial({
    color: "#0a0e16",
    emissive: new THREE.Color("#d4e6ff"),
    emissiveIntensity: 3.6,
    roughness: 0.35,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.025, 0.26), metal);
  base.castShadow = true;
  g.add(base);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.23, 0.022), metal);
  lid.position.set(0, 0.115, -0.12);
  lid.rotation.x = -0.4;
  lid.castShadow = true;
  g.add(lid);
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), screenMat);
  scr.position.set(0, 0.115, -0.106);
  scr.rotation.x = -0.4;
  g.add(scr);
  const pl = new THREE.PointLight(new THREE.Color("#bcd2f5"), 3.2, 2.2, 2);
  pl.position.set(0, 0.18, 0.06);
  g.add(pl);
  return g;
}

/* ---------------- Real rigged person (Mixamo FBX), ping-pong looped ---------------- */
function Person({
  position,
  scale = 0.011,
  rotation = 0,
}: {
  position: [number, number, number];
  scale?: number;
  rotation?: number;
}) {
  const reduced = useContext(ReducedMotion);
  const { scene, animations } = useGLTF("/models/person.glb");
  const { actions } = useAnimations(animations, scene);
  const lapRef = useRef<THREE.Group>(null);
  const bones = useRef<{ hips?: THREE.Object3D | null }>({});
  const lapObj = useMemo(() => buildLaptop(), []);
  const tmpA = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.frustumCulled = false;
      }
    });
    // GLTFLoader sanitizes ':' to '_', so match the Hips bone by substring
    let hips: THREE.Object3D | null = null;
    scene.traverse((o) => {
      if (!hips && /hips/i.test(o.name)) hips = o;
    });
    bones.current.hips = hips;
  }, [scene]);

  useEffect(() => {
    const a = Object.values(actions)[0];
    if (!a) return;
    a.reset();
    a.setLoop(THREE.LoopPingPong, Infinity); // forward then reverse, no jump on loop
    a.play();
    a.paused = reduced; // freeze for reduced-motion
    return () => {
      a.stop();
    };
  }, [actions, reduced]);

  // each frame, rest the laptop on the thighs (anchored to the hips, nudged forward)
  useFrame(() => {
    const g = lapRef.current;
    const hips = bones.current.hips;
    if (!g || !hips) return;
    hips.getWorldPosition(tmpA);
    tmpA.x += Math.sin(rotation) * 0.16; // forward onto the lap
    tmpA.z += Math.cos(rotation) * 0.16;
    tmpA.y += 0.05; // rest on top of the thighs, not clipping into them
    if (g.parent) g.parent.worldToLocal(tmpA);
    g.position.copy(tmpA);
    g.rotation.set(0.05, rotation + Math.PI, 0); // screen faces the person
  });

  return (
    <>
      <primitive object={scene} position={position} scale={scale} rotation={[0, rotation, 0]} />
      <group ref={lapRef} scale={1.0}>
        <primitive object={lapObj} />
      </group>
    </>
  );
}
useGLTF.preload("/models/person.glb");

/* ---------------- Laptop prop with a glowing screen ---------------- */
function Laptop({
  position,
  scale = 1,
  rotation = 0,
}: {
  position: [number, number, number];
  scale?: number;
  rotation?: number;
}) {
  const metal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a3d44", roughness: 0.45, metalness: 0.6 }),
    []
  );
  const screen = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#0a0e16",
        emissive: new THREE.Color("#cfe0ff"),
        emissiveIntensity: 2.2,
        roughness: 0.4,
      }),
    []
  );
  return (
    <group position={position} scale={scale} rotation={[0, rotation, 0]}>
      {/* keyboard base */}
      <mesh material={metal} castShadow>
        <boxGeometry args={[0.26, 0.02, 0.2]} />
      </mesh>
      {/* screen lid, tilted up toward the user (+Z) */}
      <mesh material={metal} position={[0, 0.095, -0.095]} rotation={[-0.42, 0, 0]} castShadow>
        <boxGeometry args={[0.26, 0.18, 0.02]} />
      </mesh>
      {/* lit screen face toward the user */}
      <mesh material={screen} position={[0, 0.095, -0.083]} rotation={[-0.42, 0, 0]}>
        <planeGeometry args={[0.22, 0.15]} />
      </mesh>
      <pointLight position={[0, 0.14, 0.04]} color="#bcd2f5" intensity={1.8} distance={1.5} decay={2} />
    </group>
  );
}

/* ---------------- Coder: a figure working on a laptop, lit by its glow ---------------- */
function Coder({
  position,
  scale = 1,
  rotation = 0,
}: {
  position: [number, number, number];
  scale?: number;
  rotation?: number;
}) {
  const skin = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#c08f68", roughness: 0.7, metalness: 0 }),
    []
  );
  const hair = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#2c2018", roughness: 0.85, metalness: 0 }),
    []
  );
  const shirt = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#496077", roughness: 0.85, metalness: 0 }),
    []
  );
  const pants = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#33373f", roughness: 0.9, metalness: 0 }),
    []
  );
  const metal = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#3a3d44", roughness: 0.45, metalness: 0.6 }),
    []
  );
  const screen = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#0a0e16",
        emissive: new THREE.Color("#cfe0ff"),
        emissiveIntensity: 2.8,
        roughness: 0.4,
        toneMapped: true,
      }),
    []
  );
  return (
    <group position={position} scale={scale} rotation={[0, rotation, 0]}>
      {/* hips + cross-legged lap (trousers) */}
      <mesh material={pants} position={[0, 0.15, 0]} castShadow>
        <boxGeometry args={[0.24, 0.16, 0.3]} />
      </mesh>
      <mesh material={pants} position={[0.22, 0.1, 0.13]} rotation={[0, 0, -1.45]} castShadow>
        <capsuleGeometry args={[0.07, 0.28, 4, 8]} />
      </mesh>
      <mesh material={pants} position={[0.22, 0.1, -0.13]} rotation={[0, 0, -1.45]} castShadow>
        <capsuleGeometry args={[0.07, 0.28, 4, 8]} />
      </mesh>
      {/* torso hunched over the screen (shirt) */}
      <mesh material={shirt} position={[-0.02, 0.4, 0]} rotation={[0, 0, -0.38]} castShadow>
        <capsuleGeometry args={[0.115, 0.24, 4, 8]} />
      </mesh>
      {/* head + hair, tipped down toward the laptop */}
      <mesh material={skin} position={[0.13, 0.59, 0]} rotation={[0, 0, -0.5]} castShadow>
        <sphereGeometry args={[0.092, 16, 16]} />
      </mesh>
      <mesh material={hair} position={[0.115, 0.63, 0]} rotation={[0, 0, -0.5]} castShadow>
        <sphereGeometry args={[0.097, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
      </mesh>
      {/* arms reaching to the keyboard (sleeves + skin hands) */}
      <mesh material={shirt} position={[0.16, 0.38, 0.13]} rotation={[0, 0, -0.95]} castShadow>
        <capsuleGeometry args={[0.04, 0.2, 4, 8]} />
      </mesh>
      <mesh material={shirt} position={[0.16, 0.38, -0.13]} rotation={[0, 0, -0.95]} castShadow>
        <capsuleGeometry args={[0.04, 0.2, 4, 8]} />
      </mesh>
      <mesh material={skin} position={[0.27, 0.28, 0.12]} castShadow>
        <sphereGeometry args={[0.038, 10, 10]} />
      </mesh>
      <mesh material={skin} position={[0.27, 0.28, -0.12]} castShadow>
        <sphereGeometry args={[0.038, 10, 10]} />
      </mesh>
      {/* laptop: keyboard base + glowing screen */}
      <mesh material={metal} position={[0.3, 0.27, 0]} rotation={[0, 0, -0.05]} castShadow>
        <boxGeometry args={[0.26, 0.02, 0.24]} />
      </mesh>
      <mesh material={metal} position={[0.42, 0.37, 0]} rotation={[0, 0, 1.15]} castShadow>
        <boxGeometry args={[0.24, 0.02, 0.24]} />
      </mesh>
      {/* the lit screen face toward the coder */}
      <mesh material={screen} position={[0.405, 0.37, 0]} rotation={[0, 0, 1.15]}>
        <planeGeometry args={[0.2, 0.2]} />
      </mesh>
      {/* the glow it casts back onto the figure */}
      <pointLight position={[0.34, 0.45, 0]} color="#bcd2f5" intensity={2.6} distance={2.0} decay={2} />
    </group>
  );
}

/* ---------------- Birds: low-poly silhouettes wheeling in the sky ---------------- */
function Bird({
  radius,
  height,
  phase,
  speed,
  flap,
  material,
}: {
  radius: number;
  height: number;
  phase: number;
  speed: number;
  flap: number;
  material: THREE.Material;
}) {
  const reduced = useContext(ReducedMotion);
  const g = useRef<THREE.Group>(null);
  const lw = useRef<THREE.Group>(null);
  const rw = useRef<THREE.Group>(null);
  useFrame((state) => {
    const e = reduced ? 0 : state.clock.elapsedTime;
    const t = e * speed + phase;
    if (g.current) {
      g.current.position.set(Math.cos(t) * radius, height + Math.sin(t * 2) * 0.25, Math.sin(t) * radius - 2);
      g.current.rotation.y = -t;
    }
    const a = (reduced ? 0.25 : Math.sin(e * flap) * 0.5 + 0.25);
    if (lw.current) lw.current.rotation.z = a;
    if (rw.current) rw.current.rotation.z = -a;
  });
  return (
    <group ref={g}>
      <group ref={lw}>
        <mesh material={material} position={[-0.26, 0, 0]}>
          <boxGeometry args={[0.52, 0.018, 0.13]} />
        </mesh>
      </group>
      <group ref={rw}>
        <mesh material={material} position={[0.26, 0, 0]}>
          <boxGeometry args={[0.52, 0.018, 0.13]} />
        </mesh>
      </group>
    </group>
  );
}

function Birds() {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: "#2c2b33" }), []);
  const flock = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => ({
        radius: 7 + (i % 3) * 1.8,
        height: 4.2 + (i % 4) * 0.7,
        phase: (i / 7) * Math.PI * 2,
        speed: 0.1 + (i % 3) * 0.025,
        flap: 5 + (i % 4),
      })),
    []
  );
  return (
    <group scale={0.6}>
      {flock.map((b, i) => (
        <Bird key={i} material={mat} {...b} />
      ))}
    </group>
  );
}

/* ---------------- Instanced grass: thousands of wind-swept blades ---------------- */
function Grass({ count = 16000 }: { count?: number }) {
  const reduced = useContext(ReducedMotion);
  const ref = useRef<THREE.InstancedMesh>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  const geo = useMemo(() => {
    const h = 0.32, w = 0.04, seg = 4;
    const g = new THREE.PlaneGeometry(w, h, 1, seg);
    g.translate(0, h / 2, 0); // pivot at the base
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / h;
      pos.setX(i, pos.getX(i) * (1 - t * 0.9)); // taper to a tip
    }
    g.computeVertexNormals();
    return g;
  }, []);

  const mat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vBladeH;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float bh = uv.y; vBladeH = bh;
           #ifdef USE_INSTANCING
             vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           #else
             vec3 ip = vec3(0.0);
           #endif
           float ph = ip.x * 0.8 + ip.z * 0.8;
           float sway = sin(uTime * 1.6 + ph) * 0.13 + sin(uTime * 3.3 + ph * 1.7) * 0.05;
           transformed.x += sway * bh * bh;
           transformed.z += sway * 0.4 * bh * bh;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vBladeH;")
        .replace(
          "#include <map_fragment>",
          `vec3 baseC = vec3(0.09, 0.19, 0.04);
           vec3 tipC  = vec3(0.43, 0.52, 0.17);
           diffuseColor.rgb *= mix(baseC, tipC, vBladeH);`
        );
    };
    m.customProgramCacheKey = () => "grass-wind-v1";
    return m;
  }, [uniforms]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    let n = 0, tries = 0;
    while (n < count && tries < count * 5) {
      tries++;
      const r = Math.sqrt(Math.random()) * ISLE.topR * 0.96;
      const a = Math.random() * Math.PI * 2;
      const X = Math.cos(a) * r, Z = Math.sin(a) * r;
      const Y = islandTopHeight(X, Z);
      if (Y === null) continue;
      // keep the whole watercourse clear: upper pool -> stream -> lip
      if (Math.abs(Z) < 0.56 && X > -0.95) continue;
      // leave a clearing where the figure sits
      if (Math.hypot(X - CODER_POS[0], Z - CODER_POS[2]) < 0.7) continue;
      dummy.position.set(X, Y - 0.02, Z);
      dummy.rotation.set((Math.random() - 0.5) * 0.2, Math.random() * Math.PI, (Math.random() - 0.5) * 0.2);
      dummy.scale.set(0.8 + Math.random() * 0.5, 0.7 + Math.random() * 0.7, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(n, dummy.matrix);
      const v = 0.8 + Math.random() * 0.4;
      col.setRGB(v, v, v * 0.95);
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [count]);

  useFrame((state) => {
    if (!reduced) uniforms.uTime.value = state.clock.elapsedTime;
  });

  return <instancedMesh ref={ref} args={[geo, mat, count]} frustumCulled={false} receiveShadow />;
}

/* ---------------- Scene ---------------- */
function Scene({ reduced }: { reduced: boolean }) {
  const [sun, setSun] = useState<THREE.Mesh | null>(null);
  const rockMat = useRockMaterial();
  const distantGeo = useIslandGeometry(3); // shared low-poly terrain for background islands

  return (
    <ReducedMotion.Provider value={reduced}>
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

      {/* distant supporting islands — same terrain, small and set back into the haze */}
      <DistantIsland geometry={distantGeo} material={rockMat} position={[-7.5, 4.6, -11]} scale={0.22} floatSpeed={0.7} />
      <DistantIsland geometry={distantGeo} material={rockMat} position={[8, 3.7, -12]} scale={0.19} floatSpeed={0.95} />
      <DistantIsland geometry={distantGeo} material={rockMat} position={[6.5, -3.6, -9]} scale={0.26} floatSpeed={1.2} />

      {/* birds wheeling through the upper sky */}
      <Birds />

      {/* drifting dust motes */}
      <Sparkles count={140} scale={[24, 13, 24]} size={3} speed={reduced ? 0 : 0.3} opacity={0.5} color="#ffe9c8" />

      {/* volumetric cloud sea + mist at the waterfall bases */}
      <Clouds material={THREE.MeshBasicMaterial} limit={500}>
        <Cloud seed={1} bounds={[28, 3, 18]} volume={10} segments={60} color="#fff4e2" opacity={0.85} fade={32} speed={reduced ? 0 : 0.15} position={[0, -6.5, -2]} />
        <Cloud seed={7} bounds={[24, 2, 14]} volume={8} segments={48} color="#e7d3b6" opacity={0.7} fade={32} speed={reduced ? 0 : 0.1} position={[2, -8, -6]} />
        <Cloud seed={3} bounds={[4, 1.5, 4]} volume={4} segments={24} color="#ffffff" opacity={0.95} fade={10} speed={reduced ? 0 : 0.25} position={[0.4, -6.6, 0.2]} />
        <Cloud seed={9} bounds={[3, 1.2, 3]} volume={3} segments={20} color="#ffffff" opacity={0.9} fade={10} speed={reduced ? 0 : 0.3} position={[4.2, -7, -1.8]} />
        {/* mist where the waterfall hits the cloud sea */}
        <Cloud seed={5} bounds={[2.4, 1.4, 2.4]} volume={3} segments={18} color="#ffffff" opacity={0.95} fade={7} speed={reduced ? 0 : 0.35} position={[3.45, -5.6, 0]} />
      </Clouds>

      <OrbitControls
        autoRotate={!reduced}
        autoRotateSpeed={0.3}
        enablePan={false}
        enableZoom
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 1.95}
        minDistance={10}
        maxDistance={30}
        target={[0, -0.6, 0]}
      />

      {sun && (
        <EffectComposer>
          <GodRays sun={sun} samples={60} density={0.95} decay={0.93} weight={0.5} exposure={0.4} clampMax={1} blur />
          <Bloom intensity={0.8} luminanceThreshold={0.75} luminanceSmoothing={0.25} mipmapBlur />
          <DepthOfField target={[0, 0.5, 0]} focalLength={0.02} bokehScale={2.5} height={420} />
          {/* pull the cartoonish saturation down and add filmic contrast */}
          <HueSaturation saturation={-0.16} />
          <BrightnessContrast brightness={-0.01} contrast={0.09} />
          <ChromaticAberration blendFunction={BlendFunction.NORMAL} offset={[0.0008, 0.0008]} />
          <Noise premultiply blendFunction={BlendFunction.OVERLAY} opacity={0.22} />
          <Vignette eskil={false} offset={0.3} darkness={0.85} />
        </EffectComposer>
      )}
    </ReducedMotion.Provider>
  );
}

export default function ScenePage() {
  const reduced = usePrefersReducedMotion();
  // start mid-range; PerformanceMonitor nudges it up on fast GPUs, down when frames drop
  const [dpr, setDpr] = useState(1.5);

  return (
    <main className="relative h-screen w-full bg-[#14213a]">
      <Canvas
        shadows="percentage"
        dpr={dpr}
        camera={{ position: [10, 3.5, 15], fov: 42 }}
        gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.62 }}
      >
        <PerformanceMonitor
          onIncline={() => setDpr(2)}
          onDecline={() => setDpr(1)}
          flipflops={3}
          onFallback={() => setDpr(1)}
        />
        <Suspense fallback={null}>
          <Scene reduced={reduced} />
        </Suspense>
      </Canvas>
      <Loader />

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
