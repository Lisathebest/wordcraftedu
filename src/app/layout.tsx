import type { Metadata } from "next";
import { SiteFooter } from "./site-footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wordcraft Classroom",
  description: "Craft a world with the words you know.",
  metadataBase: new URL("https://wordcraft-classroom.pocketbay.app"),
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}<SiteFooter /></body></html>;
}
