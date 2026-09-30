/**
 * storage.ts — Persistencia temporal de la etapa de ingesta.
 *
 * TODO(OCI): reemplazar por el SDK de OCI Object Storage
 * (bucket "mediflow-documentos-clinicos", prefijo "recibidos/").
 * Las funciones serverless de Vercel solo tienen escritura en /tmp
 * (efímera, no persiste entre invocaciones) — sirve para probar el
 * contrato de datos localmente, pero la subida real a OCI debe hacerse
 * desde aquí antes de pasar el documento a la etapa de clasificación.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { MetadatoDocumento } from "./types";

const DIRECTORIO_RECIBIDOS = join("/tmp", "mediflow-recibidos");

export async function persistirEnOciStub(
  nombreArchivo: string,
  contenido: Uint8Array | string,
): Promise<string> {
  await mkdir(DIRECTORIO_RECIBIDOS, { recursive: true });
  const destino = join(DIRECTORIO_RECIBIDOS, nombreArchivo);
  await writeFile(destino, contenido as any);
  return `mediflow-documentos-clinicos/recibidos/${nombreArchivo}`;
}

/** Persiste el sidecar `<nombreArchivo>.metadata.json` junto al documento,
 * con los metadatos básicos de entrada (documento_id, canal_origen, etc.).
 * TODO(OCI): al conectar el SDK real, subir este JSON como el objeto
 * `recibidos/<nombreArchivo>.metadata.json` en el mismo bucket, para que
 * quede junto al documento y no dependa de la respuesta HTTP original. */
export async function persistirMetadatoStub(
  nombreArchivo: string,
  metadato: MetadatoDocumento,
): Promise<string> {
  const nombreSidecar = `${nombreArchivo}.metadata.json`;
  await persistirEnOciStub(nombreSidecar, JSON.stringify(metadato, null, 2));
  return `mediflow-documentos-clinicos/recibidos/${nombreSidecar}`;
}
