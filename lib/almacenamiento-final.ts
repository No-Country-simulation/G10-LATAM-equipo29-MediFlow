import { NoRetryConfigurationDetails } from "oci-common";
import { DOC_ID_PATTERN } from "./types";
import { BUCKET_DOCUMENTOS, ErrorAlmacenamiento, obtenerConexionOci } from "./storage";
import type { AlmacenamientoOci, JsonFlujo, RutaFinal } from "./resultado-flujo";

const RUTAS: RutaFinal[] = ["procesados/normales", "procesados/urgentes", "auditoria_humana", "rechazados", "errores"];
export async function guardarResultadoFinal(id: string, ruta: RutaFinal, resultado: JsonFlujo,
  conectar = obtenerConexionOci): Promise<JsonFlujo & { almacenamiento_oci: AlmacenamientoOci }> {
  if (!DOC_ID_PATTERN.test(id) || !RUTAS.includes(ruta)) throw new Error("Ruta de resultado inválida");
  const ubicacion = { bucket: BUCKET_DOCUMENTOS, ruta_objeto: `${ruta}/${id}.json` };
  // El objeto incluye su ubicación; solo se confirma éxito al cliente después del PUT.
  const completo = { ...resultado, almacenamiento_oci: { ...ubicacion, status_backup: "exito" as const } };
  try {
    const { cliente, namespace } = conectar();
    const bytes = Buffer.from(JSON.stringify(completo, null, 2));
    await cliente.putObject({ namespaceName: namespace, bucketName: ubicacion.bucket,
      objectName: ubicacion.ruta_objeto, contentType: "application/json", contentLength: bytes.byteLength,
      putObjectBody: bytes, ifNoneMatch: "*", retryConfiguration: NoRetryConfigurationDetails });
    return completo;
  } catch (error) {
    const status = (error as { statusCode?: number })?.statusCode;
    const definitivo = error instanceof ErrorAlmacenamiento && error.status === 503 ||
      (status !== undefined && status >= 400 && status < 500 && status !== 408);
    return { ...resultado, almacenamiento_oci: { ...ubicacion,
      status_backup: definitivo ? "error" : "no_confirmado" } };
  }
}
