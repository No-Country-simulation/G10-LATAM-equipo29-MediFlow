import type { SuficienciaClinica } from "@/lib/suficiencia-clinica";
import { leer, type Fase, type Resultado } from "./tipos";
import { nombreCategoria } from "./etiquetas";
import type { DecisionDocumento } from "@/lib/decision-enrutamiento";
import type { ConfianzaDocumento } from "@/lib/confianza-extraccion";

export default function ResumenResultado({ resultado, fase, nombre, onDetalle }: {
  resultado: Resultado; fase: Fase; nombre: string; onDetalle: () => void;
}) {
  const ingesta = leer<{ documento_id: string; nombre_original: string; detalle: string }>(resultado.body);
  const clasificacion = leer<{ categoria: string }>(resultado.clasificacion?.body);
  const extraccion = leer<DecisionDocumento & { confianza_documento: ConfianzaDocumento; suficiencia_clinica: SuficienciaClinica }>(resultado.extraccion?.body);
  const decision = resultado.json_final?.decision_enrutamiento ?? extraccion.decision_enrutamiento;
  const ruta = leer<{ destino: string }>(resultado.enrutamiento?.body);
  const confianza = extraccion.confianza_documento;
  const guardado = resultado.almacenamiento_oci?.status_backup;
  const fallo = !resultado.ok ? resultado : [resultado.clasificacion, resultado.extraccion, resultado.enrutamiento].find(etapa => etapa?.ok === false);
  const detalleError = leer<{ detalle: string }>(fallo?.body).detalle;
  const estados: Partial<Record<Fase, string>> = {
    ingesta: "Recibiendo el documento…", clasificacion: "Clasificando el documento…",
    extraccion: "Extrayendo y evaluando datos clínicos…", enrutamiento: "Asignando la cola del documento…",
    almacenamiento: "Guardando el resultado en OCI…", listo: "Proceso completado", error: "Proceso con incidencias",
  };
  return <section className="resumen" aria-labelledby="titulo-resumen">
    <p className="resumen__estado">{estados[fase]}</p>
    <h3 id="titulo-resumen">{ingesta.documento_id || "ID de documento aún no asignado"}</h3>
    <dl className="resumen__datos">
      {(ingesta.nombre_original || nombre) && <div><dt>Nombre original / entrada</dt><dd>{ingesta.nombre_original || nombre}</dd></div>}
      <div><dt>Categoría detectada</dt><dd>{clasificacion.categoria ? nombreCategoria(clasificacion.categoria) : "Pendiente"}</dd></div>
      <div><dt>Extracción</dt><dd>{resultado.extraccion ? (resultado.extraccion.ok ? "Completada" : "Con error") : resultado.json_final?.decision_enrutamiento ? "Omitida por revisión de clasificación" : "Pendiente"}</dd></div>
      <div><dt>Confianza de extracción</dt><dd>{typeof confianza?.score === "number" ? `${Math.round(confianza.score * 100)} / 100 · Estimación` : confianza ? "No evaluable" : "No disponible"}</dd></div>
      {extraccion.suficiencia_clinica && <div><dt>Suficiencia clínica</dt><dd>{extraccion.suficiencia_clinica.requiere_revision_humana ? "Revisión humana requerida" : "Sin hallazgos automáticos"}</dd></div>}
      <div><dt>Prioridad propuesta</dt><dd>{extraccion.prioridad_urgencia?.estado === "omitida" ? "No evaluada por observaciones previas" : extraccion.prioridad_urgencia?.nivel.replaceAll("_", " ") ?? "No evaluada"}</dd></div>
      <div><dt>Destino propuesto · Pendiente de entrega</dt><dd>{(ruta.destino ?? decision?.destino_principal)?.replaceAll("_", " ") ?? "Pendiente"}</dd></div>
      <div><dt>Guardado</dt><dd>{guardado === "exito" ? "Confirmado en OCI" : guardado === "error" ? "No se pudo guardar" : guardado === "no_confirmado" ? "Escritura no confirmada" : fase === "almacenamiento" ? "En curso" : "Sin confirmar"}</dd></div>
    </dl>
    {decision?.requiere_auditoria_humana && <div className="resumen__alerta"><strong>Revisión humana requerida</strong><p>{decision.justificacion_enrutamiento}</p></div>}
    {(fallo || fase === "error") && <p className="resultado__error">{detalleError || ingesta.detalle || "El proceso terminó con incidencias. Consulte el detalle."}</p>}
    {guardado === "no_confirmado" && <p className="resumen__alerta">Verifique OCI antes de reenviar el documento.</p>}
    <button type="button" className="boton boton--principal" onClick={onDetalle}>Ver resultado completo <span aria-hidden="true">→</span></button>
  </section>;
}
