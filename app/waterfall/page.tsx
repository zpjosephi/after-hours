import type { CSSProperties } from "react";

// Jagged floating-rock silhouette: flattish grassy top, broken pointed underside.
const ISLAND_CLIP =
  "polygon(8% 0, 92% 0, 100% 24%, 86% 52%, 94% 74%, 72% 100%, 54% 84%, 38% 100%, 18% 72%, 4% 38%)";

type IslandProps = {
  style: CSSProperties;
  floatDelay?: string;
};

function Island({ style, floatDelay = "0s" }: IslandProps) {
  return (
    <div className="float absolute" style={{ ...style, animationDelay: floatDelay }}>
      <div className="relative h-full w-full">
        {/* rock body */}
        <div
          className="rock absolute inset-0"
          style={{ clipPath: ISLAND_CLIP, WebkitClipPath: ISLAND_CLIP }}
        />
        {/* grass cap hugging the flat top */}
        <div
          className="grass absolute left-0 top-0 w-full"
          style={{ height: "34%", clipPath: ISLAND_CLIP, WebkitClipPath: ISLAND_CLIP }}
        />
        {/* grain texture on the rock */}
        <div
          className="noise-overlay pointer-events-none absolute inset-0 opacity-30 mix-blend-overlay"
          style={{ clipPath: ISLAND_CLIP, WebkitClipPath: ISLAND_CLIP }}
        />
      </div>
    </div>
  );
}

type FallProps = { style: CSSProperties };

function Waterfall({ style }: FallProps) {
  return (
    <>
      <div className="waterfall absolute" style={style} />
      {/* glow + spray where the column reads brightest */}
      <div
        className="pointer-events-none absolute"
        style={{
          ...style,
          filter: "blur(6px)",
          background:
            "linear-gradient(to bottom, rgba(255,255,255,0), rgba(255,255,255,0.35), rgba(255,255,255,0))",
        }}
      />
    </>
  );
}

export default function WaterfallSketch() {
  return (
    <main className="scene-sky relative h-screen w-full overflow-hidden">
      {/* upper mist — swallows the top of the highest island so it reads as endless */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30"
        style={{
          height: "30%",
          background: "linear-gradient(to bottom, #14213a 8%, rgba(20,33,58,0))",
        }}
      />

      {/* islands, stacked back-to-front and rising out of the top */}
      {/* highest: mostly above frame, fading into the upper mist */}
      <Island style={{ top: "-12%", left: "40%", width: "360px", height: "210px", opacity: 0.92 }} floatDelay="0s" />
      {/* mid */}
      <Island style={{ top: "26%", left: "26%", width: "300px", height: "176px" }} floatDelay="1.5s" />
      {/* lower / closest */}
      <Island style={{ top: "44%", left: "50%", width: "260px", height: "150px" }} floatDelay="3s" />

      {/* waterfalls dropping between tiers into the cloud sea */}
      <Waterfall style={{ top: "16%", left: "53%", width: "26px", height: "34%" }} />
      <Waterfall style={{ top: "50%", left: "60%", width: "20px", height: "30%" }} />
      <Waterfall style={{ top: "40%", left: "33%", width: "18px", height: "34%" }} />

      {/* sea of clouds — bottom layer that the waterfalls disappear into */}
      <div className="absolute inset-x-0 bottom-0 z-20" style={{ height: "42%" }}>
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to top, #efdcc2 30%, rgba(239,220,194,0))" }}
        />
        <div className="cloud absolute" style={{ left: "4%", bottom: "2%", width: "46%", height: "70%" }} />
        <div className="cloud absolute" style={{ left: "38%", bottom: "8%", width: "52%", height: "78%", animationDelay: "4s" }} />
        <div className="cloud absolute" style={{ left: "62%", bottom: "0%", width: "44%", height: "64%", animationDelay: "8s" }} />
        {/* mist puffs where water meets the cloud sea */}
        <div className="mist absolute" style={{ left: "55%", bottom: "44%", width: "160px", height: "90px" }} />
        <div className="mist absolute" style={{ left: "30%", bottom: "40%", width: "130px", height: "80px", animationDelay: "2s" }} />
      </div>

      {/* cinematic finish: vignette + film grain + letterbox */}
      <div className="vignette pointer-events-none absolute inset-0 z-40" />
      <div className="noise-overlay pointer-events-none absolute inset-0 z-40 opacity-[0.5] mix-blend-overlay" />
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 bg-black" style={{ height: "5%" }} />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 bg-black" style={{ height: "5%" }} />

      {/* framing copy so you can judge where a headline would sit */}
      <div className="absolute bottom-[10%] left-6 z-50 md:left-12">
        <p className="mb-2 text-[10px] uppercase tracking-[0.35em] text-primary/60">Concept sketch</p>
        <h1
          className="font-medium leading-[0.9] tracking-[-0.04em] text-primary text-5xl sm:text-6xl md:text-7xl"
          style={{ textShadow: "0 2px 30px rgba(0,0,0,0.5)" }}
        >
          Above the
          <br />
          clouds
        </h1>
      </div>
    </main>
  );
}
