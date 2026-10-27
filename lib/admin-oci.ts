import type { ObjectStorageClient } from "oci-objectstorage";
import { NoRetryConfigurationDetails } from "oci-common";
import { BUCKET_DOCUMENTOS, obtenerConexionOci, ErrorAlmacenamiento } from "./storage";

export const LIMITE_ADMIN = 20 * 1024 * 1024;
export function validarRutaAdmin(ruta: string, permitirVacia = false): string {
  if ((!ruta && !permitirVacia) || ruta.length > 1024 || /[\\\x00-\x1f\x7f]/.test(ruta) || ruta.startsWith("/") || ruta.split("/").some(p => p === "." || p === "..")) throw new ErrorAlmacenamiento(400, "Ruta de objeto inválida.");
  return ruta;
}
export async function listarObjetosAdmin(prefijo: string, inicio?: string, carpetas = true, conectar: () => { cliente: Pick<ObjectStorageClient, "listObjects">; namespace: string } = obtenerConexionOci) {
  validarRutaAdmin(prefijo, true);
  if (inicio) { validarRutaAdmin(inicio); if (!inicio.startsWith(prefijo)) throw new ErrorAlmacenamiento(400, "La página no pertenece a esta carpeta."); }
  const { cliente, namespace } = conectar();
  const r = await cliente.listObjects({ namespaceName: namespace, bucketName: BUCKET_DOCUMENTOS, prefix: prefijo,
    start: inicio, delimiter: carpetas ? "/" : undefined, limit: 50, fields: "name,size,timeModified,storageTier,archivalState", retryConfiguration: NoRetryConfigurationDetails });
  return { bucket: BUCKET_DOCUMENTOS, carpetas: r.listObjects.prefixes ?? [], siguiente: r.listObjects.nextStartWith ?? null,
    objetos: r.listObjects.objects.map(o => ({ ruta: o.name, tamano: o.size ?? 0, modificado: o.timeModified ?? null, archivo: o.archivalState ?? null })) };
}
export async function leerObjetoAdmin(ruta: string, conectar: () => { cliente: Pick<ObjectStorageClient, "getObject">; namespace: string } = obtenerConexionOci) {
  validarRutaAdmin(ruta);
  const { cliente, namespace } = conectar();
  const r = await cliente.getObject({ namespaceName: namespace, bucketName: BUCKET_DOCUMENTOS, objectName: ruta, retryConfiguration: NoRetryConfigurationDetails });
  const flujo = r.value;
  const lector = typeof (flujo as ReadableStream).getReader === "function" ? (flujo as ReadableStream<Uint8Array>).getReader() : null;
  const cancelar = async () => { if (lector) await lector.cancel().catch(() => {}); else if ("destroy" in flujo) flujo.destroy(); };
  const partes: Uint8Array[] = []; let total = 0;
  try {
    if (r.contentLength > LIMITE_ADMIN) throw new ErrorAlmacenamiento(413, "El archivo supera el límite de consulta de 20 MiB.");
    const guardar = (p: Uint8Array | string) => { const b = typeof p === "string" ? Buffer.from(p) : p; total += b.byteLength;
      if (total > LIMITE_ADMIN) throw new ErrorAlmacenamiento(413, "El archivo supera el límite de consulta de 20 MiB."); partes.push(b); };
    if (lector) { for (;;) { const p = await lector.read(); if (p.done) break; guardar(p.value); } }
    else { for await (const p of flujo as AsyncIterable<Uint8Array>) guardar(p); }
    return Buffer.concat(partes);
  } catch (error) { await cancelar(); throw error; }
  finally { lector?.releaseLock(); }
}
export function errorAdmin(error: unknown): Response {
  const status = error instanceof ErrorAlmacenamiento ? error.status : (error as { statusCode?: number })?.statusCode;
  const codigo = status === 400 || status === 403 || status === 404 || status === 413 || status === 503 ? status : 502;
  const mensaje = error instanceof ErrorAlmacenamiento ? error.message : codigo === 403 ? "OCI denegó el acceso. Se requieren permisos de lectura y listado del bucket." : codigo === 404 ? "No se encontró el objeto o el bucket, o no está accesible con los permisos actuales." : "No se pudo consultar OCI. Compruebe la conexión, configuración y permisos.";
  return Response.json({ detalle: mensaje }, { status: codigo, headers: { "Cache-Control": "no-store" } });
}
