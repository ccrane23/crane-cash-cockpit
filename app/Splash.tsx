"use client";

import { useEffect, useState } from "react";

// Minimal branded splash: the gold crane centered on the dark background, with a
// quick smooth fade-out into the app. Rendered once on initial load (it lives in
// the root layout, so client navigations don't re-trigger it). It's visible in
// the server HTML immediately, then fades shortly after mount — so returning
// users see it for well under ~1.5s.
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--color-bg)] transition-opacity duration-500 ease-out motion-reduce:transition-none"
      style={{
        opacity: phase === "fading" ? 0 : 1,
        pointerEvents: phase === "fading" ? "none" : "auto",
      }}
    >
      <div
        className="h-32 w-32 bg-center bg-no-repeat"
        style={{
          backgroundImage: "url(/icon-512.png)",
          backgroundSize: "contain",
        }}
      />
    </div>
  );
}
