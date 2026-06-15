"use client";

import { useEffect, useState } from "react";

// Branded splash: the brand gold fills the whole viewport with the crane mark
// centered at a contained size (no stretching or cropping). Rendered once on
// initial load (it lives in the root layout, so client navigations don't
// re-trigger it). It's in the server HTML immediately, holds ~3s, then fades.
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
      // Flat brand gold fills the screen; the crane (from the gold app-icon tile)
      // is centered, contained to ~48vmin so it keeps its aspect ratio and never
      // over-crops on tall phones. The tile's center gold is the brand gold, so it
      // reads as one gold field with a centered mark rather than a square-on-square.
      className="fixed inset-0 z-[100] bg-[var(--color-gold)] bg-center bg-no-repeat transition-opacity duration-500 ease-out motion-reduce:transition-none"
      style={{
        backgroundImage: "url(/icon-512.png)",
        backgroundSize: "48vmin",
        opacity: phase === "fading" ? 0 : 1,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    />
  );
}
