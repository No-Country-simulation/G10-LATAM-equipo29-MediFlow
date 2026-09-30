/**
 * types.ts — Tipos y esquemas de la etapa de INGESTA de MediFlow.
 * Equivalente TypeScript de models.py (versión FastAPI).
 */
import { z } from "zod";

export const TipoArchivo = {
  PDF: "PDF",
  IMAGEN: "IMAGEN",
  JSON: "JSON",
  TEXTO: "TEXTO",
} as const;
export type TipoArchivo = (typeof TipoArchivo)[keyof typeof TipoArchivo];

export const CanalOrigen = {
  GUARDIA_EMERGENCIAS: "Guardia_Emergencias",
  CONSULTORIO_EXTERNO: "Consultorio_Externo",
  LABORATORIO: "Laboratorio",
  FARMACIA: "Farmacia",
  PORTAL_PACIENTE: "Portal_Paciente",
  OTRO: "Otro",
} as const;
export type CanalOrigen = (typeof CanalOrigen)[keyof typeof CanalOrigen];

const CANALES_VALIDOS = new Set<string>(Object.values(CanalOrigen));

/** Valida un canal_origen recibido como texto plano (ej. desde form-data,
 * que no pasa por un schema Zod como el JSON). Retorna el valor tipado o
 * null si no coincide con ninguno de los canales soportados. */
export function validarCanalOrigen(valor: string | null): CanalOrigen | null {
  if (valor === null) return CanalOrigen.OTRO;
  return CANALES_VALIDOS.has(valor) ? (valor as CanalOrigen) : null;
}

const DOC_ID_PATTERN = /^DOC-CLIN-\d{4}-[A-Za-z0-9]{4,}$/;

export function generarDocumentoId(): string {
  const anio = new Date().getUTCFullYear();
  const sufijo = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `DOC-CLIN-${anio}-${sufijo}`;
}

/** Payload aceptado en POST /api/ingest/json — 1:1 con el ejemplo del brief. */
export const DocumentoClinicoEntradaSchema = z.object({
  documento_id: z
    .string()
    .regex(DOC_ID_PATTERN, "documento_id debe seguir el formato DOC-CLIN-YYYY-XXXX")
    .optional(),
  tipo_archivo: z.enum(["JSON", "TEXTO"]),
  documento_texto: z
    .string()
    .trim()
    .min(1, "documento_texto no puede estar vacío")
    .max(50_000, "documento_texto excede el máximo de 50,000 caracteres"),
  canal_origen: z
    .enum([
      "Guardia_Emergencias",
      "Consultorio_Externo",
      "Laboratorio",
      "Farmacia",
      "Portal_Paciente",
      "Otro",
    ])
    .default("Otro"),
});
export type DocumentoClinicoEntrada = z.infer<typeof DocumentoClinicoEntradaSchema>;

export interface ResultadoIngesta {
  status: "recibido" | "rechazado";
  documento_id: string;
  tipo_archivo_detectado: TipoArchivo;
  tamano_bytes: number;
  canal_origen: CanalOrigen;
  recibido_en: string;
  ruta_objeto_temporal: string;
}

/** Metadatos básicos de entrada persistidos junto al documento (sidecar
 * *.metadata.json) — permite que cualquier etapa posterior (clasificación,
 * auditoría humana) sepa documento_id/canal_origen/recibido_en leyendo
 * directamente el storage, sin depender de la respuesta HTTP original. */
export interface MetadatoDocumento {
  documento_id: string;
  canal_origen: CanalOrigen;
  tipo_archivo_detectado: TipoArchivo;
  tamano_bytes: number;
  recibido_en: string;
  nombre_original: string;
}

export interface ErrorIngesta {
  status: "rechazado";
  detalle: string;
  formatos_soportados: string[];
}
