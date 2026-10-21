/** Verificación manual: crea un documento sintético real en OCI; no elimina objetos. */
import { loadEnvConfig } from "@next/env";
import { procesarFlujo } from "../lib/procesar-flujo";
import { obtenerConexionOci, leerDocumentoRecibido } from "../lib/storage";

async function main() {
  loadEnvConfig(process.cwd());
  const original = JSON.stringify({ tipo_archivo: "TEXTO", canal_origen: "Otro",
    documento_texto: "DOCUMENTO SINTÉTICO DE PRUEBA DE MEDIFLOW. Sin datos de personas reales. Constancia administrativa de prueba para verificar almacenamiento. Centro: Clínica Sintética. No contiene información de un paciente ni indicaciones médicas." });
  const resultado = await procesarFlujo(new Request("http://localhost/api/process", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: original,
  }), evento => console.log(JSON.stringify({ fase: evento.fase })));
  const almacenamiento = resultado.almacenamiento_oci;
  console.log(JSON.stringify({ documento_id: resultado.ingesta.documento_id, almacenamiento_oci: almacenamiento }));
  if (almacenamiento?.status_backup !== "exito") throw new Error("No se confirmó escritura final");
  const { cliente, namespace } = obtenerConexionOci();
  const guardado = await cliente.getObject({ namespaceName: namespace, bucketName: almacenamiento.bucket, objectName: almacenamiento.ruta_objeto });
  const texto = await new Response(guardado.value as BodyInit).text();
  if (JSON.stringify(JSON.parse(texto)) !== JSON.stringify(resultado)) throw new Error("El resultado almacenado difiere");
  const recibido = resultado.ingesta.almacenamiento_oci as { ruta_objeto: string } | undefined;
  if (!recibido) throw new Error("No se confirmó el original");
  const contenido = await leerDocumentoRecibido(String(resultado.ingesta.documento_id), recibido.ruta_objeto, 10000);
  if (new TextDecoder().decode(contenido.contenido) !== original) throw new Error("El original difiere");
  console.log(JSON.stringify({ original_intacto: true, resultado_identico: true }));
}
main().catch(() => { console.error("La verificación real no pudo completarse; no se muestran datos del SDK."); process.exitCode = 1; });
