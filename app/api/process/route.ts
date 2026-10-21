import { procesarFlujo } from "@/lib/procesar-flujo";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const enviar = (evento: unknown) => {
        try { controller.enqueue(encoder.encode(JSON.stringify(evento) + "\n")); }
        catch { /* El cliente se desconectó; se sigue intentando guardar el resultado. */ }
      };
      try { await procesarFlujo(request, enviar); }
      catch { enviar({ fase: "error", final: true, detalle: "No se pudo finalizar ni confirmar el almacenamiento del proceso." }); }
      finally { try { controller.close(); } catch { /* Stream cerrado. */ } }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
