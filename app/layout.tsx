import type { Metadata } from "next";
import "./globals.css";
import Splash from "./Splash";

export const metadata: Metadata = {
  title: "Crane Cash",
  description: "Personal finance cockpit",
  // app/favicon.ico is auto-detected by Next (emits <link rel="icon" sizes="any">).
  // These explicit PNG sizes round out coverage for browsers that prefer them,
  // and iOS gets the apple-touch-icon (it ignores the web manifest).
  icons: {
    icon: [
      { url: "/fav32.png", sizes: "32x32", type: "image/png" },
      { url: "/fav16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Splash />
        {children}
      </body>
    </html>
  );
}
