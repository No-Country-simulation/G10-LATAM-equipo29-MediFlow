import { validarRecepcionArchivo } from "./recepcion-archivo";
import { validarRecepcionTexto } from "./recepcion-texto";
import { ErrorAlmacenamiento, formatoOriginal, persistirDocumentoRecibido } from "./storage";
import type { MetadatoDocumento } from "./types";

export async function recibirDocumento(request: Request, tipo: "archivo" | "texto",
  persistir = persistirDocumentoRecibido): Promise<Response> {
  const validacion = await (tipo === "archivo" ? validarRecepcionArchivo : validarRecepcionTexto)(request.clone());
  if (!validacion.ok) return validacion;
  const { almacenamiento: _estado, status: _status, ...metadatos } = await validacion.json();
  try {
    const archivo = tipo === "archivo" ? (await request.formData()).get("archivo") as File : null;
    const contenido = new Uint8Array(await (archivo ? archivo.arrayBuffer() : request.arrayBuffer()));
    const formato = !archivo || metadatos.tipo_archivo_detectado === "JSON"
      ? { extension: "json", contentType: "application/json" } : formatoOriginal(contenido);
    const ubicacion = await persistir({ contenido, ...formato, metadato: metadatos as MetadatoDocumento });
    return Response.json({ status: "recibido", ...metadatos,
      almacenamiento_oci: { ...ubicacion, status_backup: "exito" } }, { status: 201 });
  } catch (error) {
    return Response.json({ status: "error", ...metadatos,
      detalle: "No se pudo confirmar el almacenamiento del original en OCI." },
    { status: error instanceof ErrorAlmacenamiento ? error.status : 502 });
  }
}
