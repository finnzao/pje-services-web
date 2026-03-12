import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PJE Download",
  description: "Download de processos do PJE/TJBA",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
