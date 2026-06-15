import type { MetadataRoute } from "next";

// Web app manifest for the installable PWA / home-screen experience. iOS
// ignores this (it reads the apple-touch-icon <link> in layout.tsx instead);
// Android and desktop Chrome use it for the install prompt and icon.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Crane Cash",
    short_name: "Crane Cash",
    start_url: "/",
    display: "standalone",
    // Dark so the native PWA splash matches the in-app crane splash (#0a0a0a).
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
