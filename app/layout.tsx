import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediFlow — Ingesta",
  description: "Recepción de documentos clínicos (PDF, imagen o JSON/texto)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
