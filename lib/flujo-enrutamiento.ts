import { leer, type Resultado } from "../components/tipos";
import type { DecisionDocumento } from "./decision-enrutamiento";
import type { ResultadoEnrutamiento } from "./enrutamiento";

export function esRutaNormal(extraccion: Resultado): boolean {
  const datos = leer<DecisionDocumento>(extraccion.body);
  return extraccion.ok && datos.prioridad_urgencia?.estado === "evaluada" &&
    datos.prioridad_urgencia.nivel === "NORMAL" &&
    datos.decision_enrutamiento?.destino_principal === "Ruta_Normal";
}

/** Usa la decisión previa; no recalcula confianza, urgencia ni clasificación. */
export async function completarRutaNormal(extraccion: Resultado, clasificacion: Resultado,
  documentoId: string, solicitar: typeof fetch = fetch): Promise<Resultado> {
  if (!esRutaNormal(extraccion)) return extraccion;
  const datos = leer<DecisionDocumento>(extraccion.body);
  try {
    const respuesta = await solicitar("/api/ingest/route", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ documento_id: documentoId,
        categoria: leer<{ categoria: string }>(clasificacion.body).categoria }) });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) return { ...extraccion, ok: false, body: { ...datos,
      detalle: leer<{ detalle: string }>(cuerpo).detalle ?? "No se pudo asignar la cola normal." } };
    const ruta = cuerpo as ResultadoEnrutamiento;
    if (ruta.status !== "enrutado" || ruta.documento_id !== documentoId || !ruta.destino) {
      throw new Error("Respuesta de enrutamiento inválida");
    }
    return { ...extraccion, enrutamiento: { ok: true, body: ruta }, body: { ...datos,
      decision_enrutamiento: { ...datos.decision_enrutamiento,
        destino_principal: ruta.destino, justificacion_enrutamiento: ruta.justificacion } } };
  } catch {
    return { ...extraccion, ok: false, body: { ...datos,
      detalle: "No se pudo completar el enrutamiento normal. La extracción se conserva." } };
  }
}
