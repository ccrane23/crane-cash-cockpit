"use client";

import { useEffect, useState } from "react";

// Branded splash: the full-screen dimensional gold sheen (splash-bg.png) fills
// the viewport edge-to-edge, with the transparent black crane (splash-crane.png)
// floating centered on top — one continuous gold surface, no box around the
// crane. Rendered once on initial load (it lives in the root layout, so client
// navigations don't re-trigger it); it's in the server HTML immediately, holds
// ~3s, then fades.
export default function Splash() {
  const [phase, setPhase] = useState<"show" | "fading" | "done">("show");

  useEffect(() => {
    const fade = setTimeout(() => setPhase("fading"), 3000);
    const done = setTimeout(() => setPhase("done"), 3500);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-gold)] bg-cover bg-center bg-no-repeat transition-opacity duration-500 ease-out motion-reduce:transition-none"
      style={{
        // Full-screen gold sheen (cover). Brand gold underneath is the instant
        // fallback before the image paints.
        backgroundImage: "url(/splash-bg.png)",
        opacity: phase === "fading" ? 0 : 1,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    >
      {/* Centered crane, ~52% of viewport width, aspect preserved (contain). */}
      <div
        className="w-[52vw] max-w-[420px] bg-center bg-no-repeat"
        style={{
          aspectRatio: "1 / 1",
          backgroundImage: "url(/splash-crane.png)",
          backgroundSize: "contain",
        }}
      />
    </div>
  );
}
