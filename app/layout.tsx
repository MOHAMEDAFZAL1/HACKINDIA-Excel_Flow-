import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ExcelFlow",
  description: "Schema-driven AI spreadsheet UI powered by Claude."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
