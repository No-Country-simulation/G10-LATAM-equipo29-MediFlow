import { z } from "zod";

import type { CanalOrigen } from "./types";
import { CATEGORIAS_DOCUMENTO, type CategoriaDocumento } from "./clasificacion";

export const DESTINOS_ENRUTAMIENTO = {
  FARMACIA: "cola_farmacia",
  LABORATORIO: "cola_laboratorio",
  IMAGENOLOGIA: "cola_imagenologia",
  HISTORIA_CLINICA: "cola_historia_clinica",
  ALTAS: "cola_resumen_alta",
  ORDENES: "cola_ordenes_medicas",
  CERTIFICADOS: "cola_certificados",
  CONSENTIMIENTOS: "cola_consentimientos",
  ADMINISTRACION: "cola_administrativa",
  REVISION_MANUAL: "cola_revision_manual",
} as const;

export type DestinoEnrutamiento =
  (typeof DESTINOS_ENRUTAMIENTO)[keyof typeof DESTINOS_ENRUTAMIENTO];

export const REGLAS_ENRUTAMIENTO: Record<
  CategoriaDocumento,
  DestinoEnrutamiento
> = {
  RECETA_MEDICA: DESTINOS_ENRUTAMIENTO.FARMACIA,
  RESULTADO_LABORATORIO: DESTINOS_ENRUTAMIENTO.LABORATORIO,
  INFORME_IMAGENOLOGIA: DESTINOS_ENRUTAMIENTO.IMAGENOLOGIA,
  HISTORIA_CLINICA: DESTINOS_ENRUTAMIENTO.HISTORIA_CLINICA,
  RESUMEN_ALTA: DESTINOS_ENRUTAMIENTO.ALTAS,
  ORDEN_MEDICA: DESTINOS_ENRUTAMIENTO.ORDENES,
  CERTIFICADO_MEDICO: DESTINOS_ENRUTAMIENTO.CERTIFICADOS,
  CONSENTIMIENTO_INFORMADO: DESTINOS_ENRUTAMIENTO.CONSENTIMIENTOS,
  DOCUMENTO_ADMINISTRATIVO: DESTINOS_ENRUTAMIENTO.ADMINISTRACION,
  OTRO: DESTINOS_ENRUTAMIENTO.REVISION_MANUAL,
};

export type NodoDecision =
  | "INICIO"
  | "REVISION_HUMANA"
  | "RUTA_PRIMARIA"
  | "FALLBACK_CONTINGENCIA"
  | "FIN";

export const EnrutarEntradaSchema = z.object({
  documento_id: z
    .string()
    .regex(
      /^DOC-CLIN-\d{4}-[A-Z0-9]{6}$/,
      "documento_id debe seguir el formato DOC-CLIN-YYYY-XXXXXX",
    ),
  categoria: z.enum(CATEGORIAS_DOCUMENTO),
  confianza: z.number().min(0).max(1),
  requiere_revision_humana: z.boolean(),
  canal_origen: z
    .enum([
      "Guardia_Emergencias",
      "Consultorio_Externo",
      "Laboratorio",
      "Farmacia",
      "Portal_Paciente",
      "Otro",
    ])
    .optional(),
  destinos_no_disponibles: z.array(z.string()).default([]),
});

export type EnrutarEntrada = z.infer<typeof EnrutarEntradaSchema>;

export interface ResultadoEnrutamiento {
  status: "enrutado";
  documento_id: string;
  categoria: CategoriaDocumento;
  confianza: number;
  canal_origen?: CanalOrigen;
  destino: DestinoEnrutamiento;
  fallback_activado: boolean;
  motivo_fallback: string | null;
  ruta_decision: NodoDecision[];
  enrutado_en: string;
}

function disponible(
  destino: DestinoEnrutamiento,
  noDisponibles: Set<string>,
): boolean {
  return !noDisponibles.has(destino);
}

export function enrutarDocumento(
  entrada: EnrutarEntrada,
): ResultadoEnrutamiento {
  const rutaDecision: NodoDecision[] = ["INICIO"];
  const noDisponibles = new Set(entrada.destinos_no_disponibles);

  if (entrada.requiere_revision_humana) {
    rutaDecision.push("REVISION_HUMANA");
    const destino = DESTINOS_ENRUTAMIENTO.REVISION_MANUAL;
    const usaFallback = !disponible(destino, noDisponibles);

    rutaDecision.push(usaFallback ? "FALLBACK_CONTINGENCIA" : "FIN");
    if (usaFallback) rutaDecision.push("FIN");

    return {
      status: "enrutado",
      documento_id: entrada.documento_id,
      categoria: entrada.categoria,
      confianza: entrada.confianza,
      canal_origen: entrada.canal_origen,
      destino,
      fallback_activado: usaFallback,
      motivo_fallback: usaFallback
        ? "Destino de revisión manual no disponible; se activa contingencia operativa."
        : null,
      ruta_decision: rutaDecision,
      enrutado_en: new Date().toISOString(),
    };
  }

  rutaDecision.push("RUTA_PRIMARIA");
  const destinoPrimario = REGLAS_ENRUTAMIENTO[entrada.categoria];

  if (disponible(destinoPrimario, noDisponibles)) {
    rutaDecision.push("FIN");
    return {
      status: "enrutado",
      documento_id: entrada.documento_id,
      categoria: entrada.categoria,
      confianza: entrada.confianza,
      canal_origen: entrada.canal_origen,
      destino: destinoPrimario,
      fallback_activado: false,
      motivo_fallback: null,
      ruta_decision: rutaDecision,
      enrutado_en: new Date().toISOString(),
    };
  }

  rutaDecision.push("FALLBACK_CONTINGENCIA", "FIN");

  return {
    status: "enrutado",
    documento_id: entrada.documento_id,
    categoria: entrada.categoria,
    confianza: entrada.confianza,
    canal_origen: entrada.canal_origen,
    destino: DESTINOS_ENRUTAMIENTO.REVISION_MANUAL,
    fallback_activado: true,
    motivo_fallback: `Destino primario no disponible: ${destinoPrimario}.`,
    ruta_decision: rutaDecision,
    enrutado_en: new Date().toISOString(),
  };
}
