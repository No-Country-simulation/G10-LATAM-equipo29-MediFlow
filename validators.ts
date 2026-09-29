/**
 * validators.ts — Validación ESTRICTA de formato para la etapa de ingesta.
 *
 * Defensa en profundidad (las señales disponibles deben ser consistentes):
 *   1) Extensión del nombre de archivo.
 *   2) Content-Type declarado por el cliente.
 *   3) Firma binaria real de los primeros bytes (magic numbers).
 *
 * Formatos estrictamente soportados: PDF, IMAGEN (jpg/png/tiff/webp),
 * JSON/TEXTO (validado aparte, ver validarTextoJson).
 */
import { TipoArchivo } from "./types";

export const TAMANO_MAXIMO_BYTES = 15 * 1024 * 1024; // 15 MB por documento clínico

export class FormatoNoSoportadoError extends Error {}
export class ArchivoInconsistenteError extends Error {}
export class ArchivoDemasiadoGrandeError extends Error {}

export interface ResultadoValidacion {
  tipoDetectado: TipoArchivo;
  tamanoBytes: number;
}

const EXTENSIONES_A_TIPO: Record<string, TipoArchivo> = {
  ".pdf": "PDF",
  ".jpg": "IMAGEN",
  ".jpeg": "IMAGEN",
  ".png": "IMAGEN",
  ".tif": "IMAGEN",
  ".tiff": "IMAGEN",
  ".webp": "IMAGEN",
  ".json": "JSON",
  ".txt": "TEXTO",
};

const MIME_A_TIPO: Record<string, TipoArchivo> = {
  "application/pdf": "PDF",
  "image/jpeg": "IMAGEN",
  "image/png": "IMAGEN",
  "image/webp": "IMAGEN",
  "image/tiff": "IMAGEN",
  "application/json": "JSON",
  "text/plain": "TEXTO",
};

function detectarPorExtension(nombreArchivo: string): TipoArchivo | null {
  const match = /\.[a-z0-9]+$/i.exec(nombreArchivo.toLowerCase());
  if (!match) return null;
  return EXTENSIONES_A_TIPO[match[0]] ?? null;
}

function detectarPorContentType(contentType: string | null): TipoArchivo | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return MIME_A_TIPO[base] ?? null;
}

function detectarPorFirmaBinaria(bytes: Uint8Array): TipoArchivo | null {
  const inicia = (firma: number[]) =>
    firma.every((byte, i) => bytes[i] === byte);

  if (inicia([0x25, 0x50, 0x44, 0x46, 0x2d])) return "PDF"; // %PDF-
  if (inicia([0xff, 0xd8, 0xff])) return "IMAGEN"; // JPEG
  if (inicia([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "IMAGEN"; // PNG
  if (inicia([0x49, 0x49, 0x2a, 0x00])) return "IMAGEN"; // TIFF little-endian
  if (inicia([0x4d, 0x4d, 0x00, 0x2a])) return "IMAGEN"; // TIFF big-endian
  if (inicia([0x52, 0x49, 0x46, 0x46])) return "IMAGEN"; // RIFF (confirmar WEBP aparte)
  return null;
}

/** Valida un archivo subido (PDF o IMAGEN) contra las tres señales disponibles. */
export function validarArchivo(
  nombreArchivo: string,
  contentType: string | null,
  contenido: Uint8Array,
): ResultadoValidacion {
  const tamano = contenido.byteLength;

  if (tamano === 0) {
    throw new FormatoNoSoportadoError("El archivo está vacío.");
  }
  if (tamano > TAMANO_MAXIMO_BYTES) {
    throw new ArchivoDemasiadoGrandeError(
      `El archivo pesa ${tamano} bytes; el máximo permitido es ${TAMANO_MAXIMO_BYTES} bytes.`,
    );
  }

  const tipoExt = detectarPorExtension(nombreArchivo);
  const tipoMime = detectarPorContentType(contentType);
  const tipoFirma = detectarPorFirmaBinaria(contenido.subarray(0, 16));

  if (tipoFirma === null) {
    throw new FormatoNoSoportadoError(
      "El contenido del archivo no corresponde a ningún formato soportado " +
        `(PDF, IMAGEN). Formatos aceptados: ${Object.values(TipoArchivo).join(", ")}.`,
    );
  }

  // WEBP comparte la firma contenedora RIFF; se confirma el subtipo en el offset 8.
  if (
    contenido[0] === 0x52 &&
    contenido[1] === 0x49 &&
    contenido[2] === 0x46 &&
    contenido[3] === 0x46
  ) {
    const subtipo = new TextDecoder().decode(contenido.subarray(8, 12));
    if (subtipo !== "WEBP") {
      throw new FormatoNoSoportadoError(
        "Contenedor RIFF no identificado como WEBP; formato no soportado.",
      );
    }
  }

  const señales = [tipoExt, tipoMime, tipoFirma].filter(
    (s): s is TipoArchivo => s !== null,
  );
  const distintas = new Set(señales);
  if (señales.length >= 2 && distintas.size > 1) {
    throw new ArchivoInconsistenteError(
      `Señales de formato inconsistentes — extensión=${tipoExt}, ` +
        `content_type=${tipoMime}, firma_binaria=${tipoFirma}. ` +
        "Verifique que el archivo no esté mal nombrado o corrupto.",
    );
  }

  return { tipoDetectado: tipoFirma, tamanoBytes: tamano };
}

/** Valida el tamaño de un payload de texto/JSON ya parseado por zod. */
export function validarTextoJson(contenidoTexto: string): ResultadoValidacion {
  const tamano = new TextEncoder().encode(contenidoTexto).byteLength;
  if (tamano === 0) {
    throw new FormatoNoSoportadoError("documento_texto está vacío.");
  }
  if (tamano > TAMANO_MAXIMO_BYTES) {
    throw new ArchivoDemasiadoGrandeError(
      `El texto pesa ${tamano} bytes; el máximo permitido es ${TAMANO_MAXIMO_BYTES} bytes.`,
    );
  }
  return { tipoDetectado: "TEXTO", tamanoBytes: tamano };
}
