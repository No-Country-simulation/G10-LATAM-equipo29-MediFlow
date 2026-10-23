import { CATEGORIAS_DOCUMENTO } from "./clasificacion";

/** Independiente del umbral de confianza de los datos extraídos. */
export function evaluarClasificacion(datos: Record<string, unknown>, configurado = process.env.UMBRAL_CLASIFICACION) {
  const umbral = configurado?.trim() ? Number(configurado) : 0.85;
  if (!Number.isFinite(umbral) || umbral < 0 || umbral > 1) throw new Error("Umbral de clasificación inválido");
  if (!CATEGORIAS_DOCUMENTO.some(c => c === datos.categoria) || typeof datos.confianza !== "number" ||
      !Number.isFinite(datos.confianza) || datos.confianza < 0 || datos.confianza > 1) {
    throw new Error("Clasificación inválida");
  }
  const motivos = [
    ...(datos.confianza < umbral ? ["CONFIANZA_CLASIFICACION_INSUFICIENTE"] : []),
    ...(datos.categoria === "OTRO" ? ["CATEGORIA_NO_ESPECIFICA"] : []),
  ];
  return { umbral, estado: motivos.length ? "ambigua" as const : "aceptada" as const, motivos };
}

export function revisionPorClasificacion() {
  return {
    prioridad_urgencia: { estado: "no_evaluada" as const, nivel: "NO_DETERMINADA" as const, urgente: null },
    decision_enrutamiento: {
      destino_principal: "Cola_Auditoria_Humana", requiere_auditoria_humana: true,
      justificacion_enrutamiento: "Clasificación ambigua; revisar el tipo de documento y su posible urgencia antes de continuar.",
      notificacion_generada: null, estado: "pendiente_entrega" as const,
    },
  };
}
