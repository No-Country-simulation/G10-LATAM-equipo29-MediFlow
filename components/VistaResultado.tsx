import { leer, type Resultado } from "./tipos";
import ExtraccionClinica, { type ExtraccionVisible } from "./ExtraccionClinica";
import ValidacionEstructural from "./ValidacionEstructural";
import ConfianzaDocumento from "./ConfianzaDocumento";
import type { DecisionDocumento } from "@/lib/decision-enrutamiento";
import type { ConfianzaDocumento as ResultadoConfianza } from "@/lib/confianza-extraccion";
import type { ValidacionEstructural as ResultadoValidacion } from "@/lib/validacion-clinica";
import { formatearTamano, nombreTipo, nombreCategoria } from "./etiquetas";

type Ingesta = {
  documento_id: string; tipo_archivo_detectado: string; tamano_bytes: number; detalle: string;
  nombre_original: string; canal_origen: string; recibido_en: string; almacenamiento: string;
};
export type Veredicto = "ok" | "error";

export function veredictoDe(resultado: Resultado | null): Veredicto | null {
  if (!resultado) return null;
  if (!resultado.ok || resultado.clasificacion?.ok === false || resultado.extraccion?.ok === false || resultado.enrutamiento?.ok === false ||
    (resultado.almacenamiento_oci && resultado.almacenamiento_oci.status_backup !== "exito")) return "error";
  return resultado.extraccion?.ok || resultado.json_final?.decision_enrutamiento?.requiere_auditoria_humana ? "ok" : null;
}

export default function VistaResultado({ resultado }: { resultado: Resultado }) {
  const veredicto = veredictoDe(resultado);
  const i = leer<Ingesta>(resultado.body);
  const fallo = !resultado.ok ? resultado : resultado.clasificacion?.ok === false ? resultado.clasificacion
    : resultado.extraccion?.ok === false ? resultado.extraccion : resultado.enrutamiento?.ok === false ? resultado.enrutamiento : null;
  const c = leer<{ categoria: string; confianza: number; justificacion: string }>(resultado.clasificacion?.body);
  const detalle = leer<{ detalle: string }>(fallo?.body).detalle;
  const validacion = leer<{ validacion: ResultadoValidacion }>(resultado.extraccion?.body).validacion;
  const confianza = leer<{ confianza_documento: ResultadoConfianza }>(resultado.extraccion?.body).confianza_documento;
  const decision = leer<DecisionDocumento>(resultado.extraccion?.body);
  const revisionClasificacion = resultado.json_final?.decision_enrutamiento;
  const titulo = veredicto === "ok" ? (revisionClasificacion?.requiere_auditoria_humana || decision.decision_enrutamiento?.requiere_auditoria_humana
    ? "Revisión humana requerida" : "Extracción completada") : veredicto === "error"
    ? "No se pudo completar el proceso" : resultado.clasificacion?.ok
      ? "Documento clasificado · Extrayendo datos" : "Documento recibido · Clasificando";
  return (
    <section className={`resultado${veredicto ? ` resultado--${veredicto}` : ""}`} aria-labelledby="titulo-resultado">
      <h3 id="titulo-resultado" className="resultado__titulo">
        <span className="resultado__punto" aria-hidden="true" />{titulo}
      </h3>
      {fallo && <p className="resultado__error">{typeof detalle === "string" ? detalle : "La etapa devolvió un error sin detalle."}</p>}
      <dl className="datos">
        {i.documento_id && <div className="dato"><dt>Documento</dt><dd><code>{i.documento_id}</code></dd></div>}
        {i.nombre_original && <div className="dato"><dt>Nombre original</dt><dd>{i.nombre_original}</dd></div>}
        {i.tipo_archivo_detectado && <div className="dato"><dt>Formato</dt><dd>
          {nombreTipo(i.tipo_archivo_detectado)}, {formatearTamano(i.tamano_bytes)}
        </dd></div>}
        {i.canal_origen && <div className="dato"><dt>Canal de origen</dt><dd>{i.canal_origen}</dd></div>}
        {i.recibido_en && <div className="dato"><dt>Recibido en</dt><dd>{i.recibido_en}</dd></div>}
        {i.almacenamiento === "deshabilitado" && <div className="dato"><dt>Almacenamiento</dt><dd>Deshabilitado · Sin guardar en OCI</dd></div>}
      </dl>
      {resultado.clasificacion?.ok && <section aria-label="Clasificación del documento">
        <h4>Clasificación</h4>
        <dl className="datos">
          {c.categoria && <div className="dato"><dt>Categoría</dt><dd>{nombreCategoria(c.categoria)}</dd></div>}
          {typeof c.confianza === "number" && <div className="dato"><dt>Confianza de clasificación</dt><dd>{Math.round(c.confianza * 100)}%</dd></div>}
        </dl>
        {c.justificacion && <p>{c.justificacion}</p>}
      </section>}
      {resultado.extraccion?.ok && <ExtraccionClinica datos={leer<ExtraccionVisible>(resultado.extraccion.body)} />}
      {revisionClasificacion && <section aria-label="Revisión de clasificación">
        <h4>Clasificación ambigua · Revisión humana requerida</h4>
        <p>{revisionClasificacion.justificacion_enrutamiento}</p>
        <p>Destino: Cola de Auditoría Humana · Pendiente de entrega.</p>
        <p>Prioridad no evaluada. Se omitieron extracción, validación, confianza de datos y asignación de área.</p>
      </section>}
      {validacion && <ValidacionEstructural resultado={validacion} />}
      {confianza && <ConfianzaDocumento resultado={confianza} />}
      {decision.decision_enrutamiento && <section aria-label="Decisión de enrutamiento">
        <h4>Prioridad y destino propuesto</h4>
        <p>Confianza suficiente: {decision.evaluacion_confianza?.suficiente ? "Sí" : "No"} · Umbral: {Math.round((decision.evaluacion_confianza?.umbral ?? 0) * 100)}%</p>
        <p>Prioridad: {decision.prioridad_urgencia?.nivel.replaceAll("_", " ")}</p>
        <p>Destino: {decision.decision_enrutamiento.destino_principal.replaceAll("_", " ")}</p>
        <p>{decision.decision_enrutamiento.justificacion_enrutamiento}</p>
        {decision.decision_enrutamiento.requiere_auditoria_humana && <p>Requiere auditoría humana.</p>}
        {decision.decision_enrutamiento.notificacion_generada && <p>{decision.decision_enrutamiento.notificacion_generada.mensaje} · Pendiente de envío.</p>}
        <p className="resultado__nota">Destino pendiente de entrega. La prioridad es una propuesta automática que requiere valoración profesional.</p>
      </section>}
      {resultado.almacenamiento_oci && <section aria-label="Almacenamiento OCI">
        <h4>Almacenamiento OCI</h4>
        <p>{resultado.almacenamiento_oci.status_backup === "exito" ? "Guardado confirmado" : resultado.almacenamiento_oci.status_backup === "no_confirmado"
          ? "Escritura no confirmada. Verifique OCI antes de reenviar." : "No se pudo guardar el resultado."}</p>
        <p>Bucket: <code>{resultado.almacenamiento_oci.bucket}</code></p>
        <p>Ruta: <code>{resultado.almacenamiento_oci.ruta_objeto}</code></p>
      </section>}
      <details className="crudo">
        <summary>Ver la respuesta completa</summary>
        <pre>{JSON.stringify(resultado.json_final ?? { ingesta: resultado.body, clasificacion: resultado.clasificacion?.body,
          extraccion: resultado.extraccion?.body, enrutamiento: resultado.enrutamiento?.body,
          almacenamiento_oci: resultado.almacenamiento_oci }, null, 2)}</pre>
      </details>
    </section>
  );
}
