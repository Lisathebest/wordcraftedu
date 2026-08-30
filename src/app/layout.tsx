import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wordcraft Classroom",
  description: "Craft a world with the words you know.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
