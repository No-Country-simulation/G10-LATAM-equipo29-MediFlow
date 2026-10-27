import { leerObjetoAdmin, errorAdmin } from "@/lib/admin-oci";
import { protegerApiAdmin } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denegado = await protegerApiAdmin();
  if (denegado) return denegado;
  const q = new URL(request.url).searchParams;
  const ruta = q.get("ruta") ?? "";
  try {
    const contenido = await leerObjetoAdmin(ruta);
    const extension = ruta.split(".").pop()?.toLowerCase() ?? "";
    const tipos: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", json: "application/json; charset=utf-8", txt: "text/plain; charset=utf-8" };
    const tipo = tipos[extension] ?? "application/octet-stream";
    const descargar = q.get("descargar") === "1" || !tipos[extension];
    const nombre = ruta.split("/").pop() ?? "documento";
    return new Response(new Uint8Array(contenido), { headers: {
      "Content-Type": tipo, "Content-Length": String(contenido.length), "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'",
      "Content-Disposition": `${descargar ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(nombre).replace(/'/g, "%27")}`,
    } });
  } catch (e) { return errorAdmin(e); }
}
