import type { Resultado } from "../components/tipos";
import type { JsonFlujo } from "./resultado-flujo";
import type { EventoFlujo } from "./procesar-flujo";

export function resultadoInterfaz(json: JsonFlujo): Resultado {
  const etapa = (body: Record<string, unknown>): Resultado => ({
    ok: body.status !== "error" && body.status !== "rechazado", body,
  });
  return { ...etapa(json.ingesta),
    ...(json.clasificacion ? { clasificacion: etapa(json.clasificacion) } : {}),
    ...(json.extraccion ? { extraccion: etapa(json.extraccion) } : {}),
    ...(json.enrutamiento ? { enrutamiento: etapa(json.enrutamiento) } : {}),
    almacenamiento_oci: json.almacenamiento_oci, json_final: json };
}

export async function recibirEventos(response: Response, actualizar: (evento: EventoFlujo) => void) {
  if (!response.ok || !response.body) throw new Error("No se pudo iniciar el procesamiento.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pendiente = "";
  let final = false;
  const leer = (linea: string) => {
    if (!linea.trim()) return;
    const evento = JSON.parse(linea);
    if (!evento.resultado) throw new Error(evento.detalle ?? "Respuesta de procesamiento inválida.");
    actualizar(evento);
    if (evento.final) final = true;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pendiente += decoder.decode(value, { stream: !done });
      const lineas = pendiente.split("\n");
      pendiente = lineas.pop() ?? "";
      lineas.forEach(leer);
      if (done) break;
    }
    leer(pendiente);
    if (!final) throw new Error("La conexión terminó sin confirmar el almacenamiento final. Verifique OCI antes de reenviar.");
  } finally { reader.releaseLock(); }
}
