import { z } from "zod";
import { CATEGORIAS_DOCUMENTO, type CategoriaDocumento } from "./clasificacion";

export const REGLAS_ENRUTAMIENTO = {
  RECETA_MEDICA: "cola_farmacia",
  RESULTADO_LABORATORIO: "cola_laboratorio",
  INFORME_IMAGENOLOGIA: "cola_imagenologia",
  HISTORIA_CLINICA: "cola_historia_clinica",
  RESUMEN_ALTA: "cola_resumen_alta",
  ORDEN_MEDICA: "cola_ordenes_medicas",
  CERTIFICADO_MEDICO: "cola_certificados",
  CONSENTIMIENTO_INFORMADO: "cola_consentimientos",
  DOCUMENTO_ADMINISTRATIVO: "cola_administrativa",
  OTRO: "cola_area_correspondiente",
} as const satisfies Record<CategoriaDocumento, string>;
export const EnrutarEntradaSchema = z.object({
  documento_id: z.string().regex(/^DOC-CLIN-\d{4}-[A-Z0-9]{6}$/),
  categoria: z.enum(CATEGORIAS_DOCUMENTO),
}).strict();
export type EnrutarEntrada = z.infer<typeof EnrutarEntradaSchema>;

/** El flujo llamador ya determinó la ruta normal. Solo asigna la cola por categoría. */
export function enrutarDocumento(entrada: EnrutarEntrada) {
  return { status: "enrutado" as const, documento_id: entrada.documento_id,
    categoria: entrada.categoria, destino: REGLAS_ENRUTAMIENTO[entrada.categoria],
    estado: "pendiente_entrega" as const,
    justificacion: `Cola asignada según la categoría ${entrada.categoria}.`,
    ruta_decision: ["INICIO", "RUTA_NORMAL", "CATEGORIA_DOCUMENTAL", "FIN"],
    enrutado_en: new Date().toISOString() };
}
export type ResultadoEnrutamiento = ReturnType<typeof enrutarDocumento>;
