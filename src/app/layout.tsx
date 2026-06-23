import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaSetup from "@/components/PwaSetup";
import BottomNav from "@/components/BottomNav";

export const metadata: Metadata = {
  title: "MinTech Ethiopia",
  description: "Six-module internal operating system for MinTech Ethiopia",
  manifest: "/manifest.json",
  icons: { apple: "/icons/apple-touch-icon.png" },
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
      <body className="font-sans min-h-screen pb-24">
        <PwaSetup />
        {children}
        <BottomNav />
      </body>
    </html>
  );
}
