import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Autopilot service status",
  description:
    "Current service availability and response-time history for Autopilot.",
  icons: { icon: "/favicon.svg" },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
