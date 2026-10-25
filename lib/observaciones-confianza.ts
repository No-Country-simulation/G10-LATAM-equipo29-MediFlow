import type { ConfianzaDocumento } from "./confianza-extraccion";

export function nombreCampo(ruta: string): string {
  return ruta.split("/").filter(Boolean).map(p => p === "*" ? "entrada de lista" : /^\d+$/.test(p) ? `entrada ${Number(p) + 1}` : p.replaceAll("_", " ")).join(" → ");
}
const CAUSAS: Record<string, string> = {
  sin_respaldo_en_original: "No se encontró respaldo en el original",
  valor_diferente: "El valor difiere del original", atribucion_incorrecta: "El dato se atribuyó incorrectamente",
  ilegible: "No se pudo leer el dato", ambiguo: "El original es ambiguo", no_especificada: "Sin causa adicional especificada",
};
const ESTADOS: Record<string, string> = {
  no_respaldado: "Dato sin respaldo en el original", contradictorio: "Dato contradictorio con el original",
  no_verificable: "No se pudo verificar el dato", respaldado: "Dato respaldado",
};
export function observacionesConfianza(resultado: ConfianzaDocumento): string[] {
  const detalles: string[] = [];
  for (const omision of resultado.omisiones ?? []) {
    if (omision.detalles?.length) for (const d of omision.detalles) {
      detalles.push(`Posible omisión: ${nombreCampo(d.campo)}. Cantidad: ${d.cantidad}. ${d.pagina ? `Página ${d.pagina}.` : "Página no identificada."}`);
    } else detalles.push(`Posible omisión en ${omision.seccion.replaceAll("_", " ")}: ${omision.cantidad} dato(s). El evaluador no identificó los campos concretos.`);
  }
  if (resultado.motivos.includes("INFORMACION_OMITIDA") && !resultado.omisiones?.length) detalles.push("Se reportó información omitida, pero este resultado no conserva las secciones ni los campos afectados.");
  for (const campo of resultado.campos_observados) detalles.push(`${nombreCampo(campo.ruta)}: ${ESTADOS[campo.estado] ?? campo.estado}.${campo.causa && campo.causa !== "no_especificada" ? ` ${CAUSAS[campo.causa]}.` : ""} ${campo.pagina ? `Página ${campo.pagina}.` : "Página no identificada."}`);
  if (resultado.motivos.includes("CONTENIDO_ILEGIBLE")) detalles.push(`El evaluador reportó ${resultado.unidades_ilegibles ?? "una cantidad no registrada de"} unidades de información ilegibles. Consulte los campos no verificables; no se registró una ubicación para cada unidad.`);
  if (resultado.conflicto_documental) detalles.push("El evaluador reportó conflicto entre datos del documento o atribución a varios pacientes. No identificó el par concreto de datos en conflicto.");
  if (resultado.motivos.includes("PUNTAJE_INSUFICIENTE")) detalles.push(`Score de extracción: ${resultado.score === null ? "no disponible" : (resultado.score * 100).toFixed(2) + " / 100"}; no alcanza el umbral requerido.`);
  if (resultado.motivos.includes("CONTRADICCIONES") && !resultado.conflicto_documental && !resultado.campos_observados.some(c => c.estado === "contradictorio")) detalles.push("Se reportaron contradicciones sin detalle de los campos afectados en este resultado.");
  return detalles;
}
