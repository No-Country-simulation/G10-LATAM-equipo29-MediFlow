import { recibirDocumento } from "./recepcion";
import { clasificarOriginal, extraerOriginal } from "./etapas-documento";
import { BUCKET_DOCUMENTOS, leerDocumentoRecibido } from "./storage";
import { MAX_BYTES_LECTURA } from "./validators";
import { EnrutarEntradaSchema, enrutarDocumento } from "./enrutamiento";
import { generarDocumentoId, DOC_ID_PATTERN } from "./types";
import { guardarResultadoFinal } from "./almacenamiento-final";
import type { JsonFlujo, RutaFinal } from "./resultado-flujo";

export type FaseServidor = "ingesta" | "clasificacion" | "extraccion" | "enrutamiento" | "almacenamiento";
export type EventoFlujo = { fase: FaseServidor; resultado: JsonFlujo } |
  { fase: "listo" | "error"; resultado: JsonFlujo; final: true };
interface Dependencias {
  recibir: typeof recibirDocumento;
  leer: typeof leerDocumentoRecibido;
  clasificar: typeof clasificarOriginal;
  extraer: typeof extraerOriginal;
  enrutar: typeof enrutarDocumento;
  guardar: typeof guardarResultadoFinal;
}
const dependencias: Dependencias = { recibir: recibirDocumento, leer: leerDocumentoRecibido,
  clasificar: clasificarOriginal, extraer: extraerOriginal, enrutar: enrutarDocumento, guardar: guardarResultadoFinal };

/** Un único proceso de servidor conserva resultados parciales y escribe al terminar. */
export async function procesarFlujo(request: Request, publicar: (evento: EventoFlujo) => void,
  deps = dependencias): Promise<JsonFlujo> {
  let id = generarDocumentoId();
  let fase: FaseServidor = "ingesta";
  let ruta: RutaFinal = "errores";
  let resultado: JsonFlujo = { ingesta: { documento_id: id } };
  const emitir = (siguiente: FaseServidor) => { fase = siguiente; publicar({ fase, resultado }); };
  const terminar = async () => {
    emitir("almacenamiento");
    const guardado = await deps.guardar(id, ruta, resultado);
    const error = ruta === "errores" || ruta === "rechazados" || guardado.almacenamiento_oci.status_backup !== "exito";
    publicar({ fase: error ? "error" : "listo", resultado: guardado, final: true });
    return guardado;
  };
  const fallo = (status: number): RutaFinal => status >= 400 && status < 500 && status !== 429 ? "rechazados" : "errores";
  try {
    emitir("ingesta");
    const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data") ?? false;
    const recepcion = await deps.recibir(request.clone(), multipart ? "archivo" : "texto");
    resultado.ingesta = await recepcion.json();
    if (typeof resultado.ingesta.documento_id === "string" && DOC_ID_PATTERN.test(resultado.ingesta.documento_id)) id = resultado.ingesta.documento_id;
    resultado.ingesta.documento_id = id;
    if (!recepcion.ok) { ruta = fallo(recepcion.status); return await terminar(); }

    emitir("clasificacion");
    const ubicacion = resultado.ingesta.almacenamiento_oci as { bucket?: string; ruta_objeto?: string; status_backup?: string } | undefined;
    if (ubicacion?.bucket !== BUCKET_DOCUMENTOS || ubicacion.status_backup !== "exito" || !ubicacion.ruta_objeto) {
      throw new Error("No existe un original confirmado en OCI");
    }
    // Una lectura del original confirmado, compartida por clasificación, extracción y cotejo.
    // No se vuelve a leer el cuerpo de la solicitud ni se modifica el JSON almacenado.
    const original = await deps.leer(id, ubicacion.ruta_objeto, MAX_BYTES_LECTURA);
    const documento = { documento_id: id, contenido: original.contenido, extension: original.extension };
    const clasificacion = await deps.clasificar(documento);
    resultado.clasificacion = await clasificacion.json();
    if (!clasificacion.ok) { ruta = fallo(clasificacion.status); return await terminar(); }
    emitir("extraccion");
    const extraccion = await deps.extraer(documento);
    resultado.extraccion = await extraccion.json();
    if (!extraccion.ok) { ruta = fallo(extraccion.status); return await terminar(); }
    const decision = resultado.extraccion!.decision_enrutamiento as { destino_principal: string; requiere_auditoria_humana: boolean };
    const prioridad = resultado.extraccion!.prioridad_urgencia as { nivel: string; estado: string };
    if (decision.requiere_auditoria_humana) ruta = "auditoria_humana";
    else if (prioridad.estado === "evaluada" && prioridad.nivel === "URGENTE") ruta = "procesados/urgentes";
    else if (prioridad.estado === "evaluada" && prioridad.nivel === "NORMAL" && decision.destino_principal === "Ruta_Normal") {
      emitir("enrutamiento");
      const enrutamiento = deps.enrutar(EnrutarEntradaSchema.parse({ documento_id: id, categoria: resultado.clasificacion!.categoria }));
      resultado.enrutamiento = enrutamiento;
      resultado.extraccion!.decision_enrutamiento = { ...decision, destino_principal: enrutamiento.destino,
        justificacion_enrutamiento: enrutamiento.justificacion };
      ruta = "procesados/normales";
    } else throw new Error("Decisión terminal inválida");
  } catch {
    ruta = "errores";
    const error = { status: "error", documento_id: id, detalle: `No se pudo completar la etapa ${fase}.` };
    const etapaFallida = fase as FaseServidor;
    if (etapaFallida === "clasificacion") resultado.clasificacion = error;
    else if (etapaFallida === "extraccion") resultado.extraccion = error;
    else if (etapaFallida === "enrutamiento") resultado.enrutamiento = error;
    else resultado.ingesta = { ...resultado.ingesta, ...error };
  }
  return terminar();
}
