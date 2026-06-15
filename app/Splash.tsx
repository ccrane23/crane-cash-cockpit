"use client";

import { useEffect, useState } from "react";

// Branded splash: the full screen becomes the gold app-icon tile (its
// dimensional gold gradient with the black crane centered), then fades out into
// the app. Rendered once on initial load (it lives in the root layout, so client
// navigations don't re-trigger it). It's in the server HTML immediately, then
// fades shortly after mount — returning users see it for well under ~1.5s.
export default function Splash() {
  const [phase, setPhase] = useState<"show" | "fading" | "done">("show");

  useEffect(() => {
    const fade = setTimeout(() => setPhase("fading"), 900);
    const done = setTimeout(() => setPhase("done"), 1500);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, []);

  if (phase === "done") return null;

  return (
    <div
      aria-hidden
      // Solid brand gold is the instant fallback before the icon paints; the icon
      // (gold gradient + black crane) covers the whole viewport edge-to-edge.
      className="fixed inset-0 z-[100] bg-[var(--color-gold)] bg-cover bg-center bg-no-repeat transition-opacity duration-500 ease-out motion-reduce:transition-none"
      style={{
        backgroundImage: "url(/icon-512.png)",
        opacity: phase === "fading" ? 0 : 1,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    />
  );
}
