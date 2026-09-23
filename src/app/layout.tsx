import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaSetup from "@/components/PwaSetup";
import BottomNav from "@/components/BottomNav";
import TopNav from "@/components/TopNav";
import InstallPrompt from "@/components/InstallPrompt";

export const metadata: Metadata = {
  title: "MinTech Ethiopia",
  description: "Six-module internal operating system for MinTech Ethiopia",
  manifest: "/manifest.json",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MinTech" },
};

export const viewport: Viewport = {
  themeColor: "#8a3622",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* pb-24 clears the phone's fixed tab bar. On a desktop that bar is gone,
          so the padding goes with it. */}
      <body className="font-sans min-h-screen pb-24 lg:pb-10">
        <PwaSetup />
        <TopNav />
        {children}
        <InstallPrompt />
        <BottomNav />
      </body>
    </html>
  );
}
