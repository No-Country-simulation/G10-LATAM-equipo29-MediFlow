import SuficienciaClinica from "./SuficienciaClinica";
import type { SuficienciaClinica as ResultadoSuficiencia } from "@/lib/suficiencia-clinica";
import { useState } from "react";
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
  const [seccion, setSeccion] = useState("clinica");
  const secciones = [["clinica", "Datos extraídos"], ["calidad", "Calidad y revisión"], ["destino", "Clasificación y destino"], ["recepcion", "Recepción y almacenamiento"], ["json", "JSON completo"]];
  const veredicto = veredictoDe(resultado);
  const i = leer<Ingesta>(resultado.body);
  const fallo = !resultado.ok ? resultado : resultado.clasificacion?.ok === false ? resultado.clasificacion
    : resultado.extraccion?.ok === false ? resultado.extraccion : resultado.enrutamiento?.ok === false ? resultado.enrutamiento : null;
  const c = leer<{ categoria: string; confianza: number; justificacion: string }>(resultado.clasificacion?.body);
  const detalle = leer<{ detalle: string }>(fallo?.body).detalle;
  const validacion = leer<{ validacion: ResultadoValidacion }>(resultado.extraccion?.body).validacion;
  const confianza = leer<{ confianza_documento: ResultadoConfianza }>(resultado.extraccion?.body).confianza_documento;
  const suficiencia = leer<{ suficiencia_clinica: ResultadoSuficiencia }>(resultado.extraccion?.body).suficiencia_clinica;
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
      {decision.decision_enrutamiento?.requiere_auditoria_humana && <div className="resumen__alerta"><strong>Revisión humana requerida</strong><p>{decision.decision_enrutamiento.justificacion_enrutamiento}</p></div>}
      {resultado.almacenamiento_oci && resultado.almacenamiento_oci.status_backup !== "exito" && <p className="resultado__error">{resultado.almacenamiento_oci.status_backup === "no_confirmado" ? "Guardado no confirmado. Verifique OCI antes de reenviar." : "No se pudo guardar el resultado en OCI."}</p>}
      <nav className="detalle-navegacion" aria-label="Secciones del resultado">{secciones.map(([id, titulo]) =>
        <button key={id} type="button" aria-current={seccion === id ? "true" : undefined} onClick={() => setSeccion(id)}>{titulo}</button>
      )}</nav>
      <div hidden={seccion !== "recepcion"}>
      <h4>Recepción del documento</h4>
      <dl className="datos">
        {i.documento_id && <div className="dato"><dt>ID del documento</dt><dd><code>{i.documento_id}</code></dd></div>}
        {i.nombre_original && <div className="dato"><dt>Nombre original</dt><dd>{i.nombre_original}</dd></div>}
        {i.tipo_archivo_detectado && <div className="dato"><dt>Formato</dt><dd>
          {nombreTipo(i.tipo_archivo_detectado)}, {formatearTamano(i.tamano_bytes)}
        </dd></div>}
        {i.canal_origen && <div className="dato"><dt>Canal de origen</dt><dd>{i.canal_origen}</dd></div>}
        {i.recibido_en && <div className="dato"><dt>Recibido en</dt><dd>{i.recibido_en}</dd></div>}
        {i.almacenamiento === "deshabilitado" && <div className="dato"><dt>Almacenamiento</dt><dd>Deshabilitado · Sin guardar en OCI</dd></div>}
      </dl>
      </div>
      <div hidden={seccion !== "destino"}>
      {resultado.clasificacion?.ok && <section aria-label="Clasificación del documento">
        <h4>Clasificación</h4>
        <dl className="datos">
          {c.categoria && <div className="dato"><dt>Categoría</dt><dd>{nombreCategoria(c.categoria)}</dd></div>}
          {typeof c.confianza === "number" && <div className="dato"><dt>Confianza de clasificación</dt><dd>{Math.round(c.confianza * 100)}%</dd></div>}
        </dl>
        {c.justificacion && <p>{c.justificacion}</p>}
      </section>}
      {!resultado.clasificacion && <p>La clasificación todavía no está disponible.</p>}
      </div>
      <div hidden={seccion !== "clinica"}>
      {resultado.extraccion?.ok ? <ExtraccionClinica datos={leer<ExtraccionVisible>(resultado.extraccion.body)} /> : <p>Los datos extraídos no están disponibles. Consulte el estado del proceso y las observaciones.</p>}
      </div>
      {revisionClasificacion && <section aria-label="Revisión de clasificación">
        <h4>Clasificación ambigua · Revisión humana requerida</h4>
        <p>{revisionClasificacion.justificacion_enrutamiento}</p>
        <p>Destino: Cola de Auditoría Humana · Pendiente de entrega.</p>
        <p>Prioridad no evaluada. Se omitieron extracción, validación, confianza de datos y asignación de área.</p>
      </section>}
      <div hidden={seccion !== "calidad"}>
      {!validacion && !confianza && <p>La evaluación de calidad no está disponible.</p>}
      {validacion && <ValidacionEstructural resultado={validacion} />}
      {confianza && <ConfianzaDocumento resultado={confianza} />}
      {suficiencia && <SuficienciaClinica resultado={suficiencia} />}
      </div>
      <div hidden={seccion !== "destino"}>
      {decision.decision_enrutamiento && <section aria-label="Decisión de enrutamiento">
        <h4>Prioridad y destino propuesto</h4>
        <p>Condiciones de confianza cumplidas: {decision.evaluacion_confianza?.suficiente ? "Sí" : "No"} · Umbral: {Math.round((decision.evaluacion_confianza?.umbral ?? 0) * 100)}%</p>
        <p>Prioridad: {decision.prioridad_urgencia?.estado === "omitida" ? "No evaluada por observaciones previas" : decision.prioridad_urgencia?.nivel.replaceAll("_", " ")}</p>
        <p>Destino: {decision.decision_enrutamiento.destino_principal.replaceAll("_", " ")}</p>
        <p>{decision.decision_enrutamiento.justificacion_enrutamiento}</p>
        {decision.decision_enrutamiento.requiere_auditoria_humana && <p>Requiere auditoría humana.</p>}
        {decision.decision_enrutamiento.notificacion_generada && <p>{decision.decision_enrutamiento.notificacion_generada.mensaje} · Pendiente de envío.</p>}
        <p className="resultado__nota">Destino pendiente de entrega. La prioridad es una propuesta automática que requiere valoración profesional.</p>
      </section>}
      {resultado.enrutamiento?.body != null && <section><h4>Asignación de cola</h4><dl className="datos">{Object.entries(leer<Record<string, unknown>>(resultado.enrutamiento.body)).map(([clave, valor]) => <div className="dato" key={clave}><dt>{clave.replaceAll("_", " ")}</dt><dd>{Array.isArray(valor) ? valor.join(" → ") : typeof valor === "object" ? JSON.stringify(valor) : String(valor ?? "No consta")}</dd></div>)}</dl></section>}
      </div>
      <div hidden={seccion !== "recepcion"}>
      {resultado.almacenamiento_oci && <section aria-label="Almacenamiento OCI">
        <h4>Almacenamiento OCI</h4>
        <p>{resultado.almacenamiento_oci.status_backup === "exito" ? "Guardado confirmado" : resultado.almacenamiento_oci.status_backup === "no_confirmado"
          ? "Escritura no confirmada. Verifique OCI antes de reenviar." : "No se pudo guardar el resultado."}</p>
        <p>Bucket: <code>{resultado.almacenamiento_oci.bucket}</code></p>
        <p>Ruta: <code>{resultado.almacenamiento_oci.ruta_objeto}</code></p>
      </section>}
      {!resultado.almacenamiento_oci && <p>Guardado sin confirmar.</p>}
      </div>
      <section className="crudo" hidden={seccion !== "json"}>
        <h4>Respuesta completa del proceso</h4>
        <pre>{JSON.stringify(resultado.json_final ?? { ingesta: resultado.body, clasificacion: resultado.clasificacion?.body,
          extraccion: resultado.extraccion?.body, enrutamiento: resultado.enrutamiento?.body,
          almacenamiento_oci: resultado.almacenamiento_oci }, null, 2)}</pre>
      </section>
    </section>
  );
}
