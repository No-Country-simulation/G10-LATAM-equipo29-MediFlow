import { observacionesConfianza } from "@/lib/observaciones-confianza";
import type { ConfianzaDocumento as ResultadoConfianza } from "@/lib/confianza-extraccion";

export default function ConfianzaDocumento({ resultado }: { resultado: ResultadoConfianza }) {
  const observaciones = observacionesConfianza(resultado);
  return <section aria-label="Confianza de la extracción clínica">
    <h4>Confianza de la extracción clínica</h4>
    <p>{resultado.score === null ? "No evaluable" : `${Math.round(resultado.score * 100)} / 100 · Nivel ${resultado.nivel}`}</p>
    {resultado.diagnostico && <div className="resumen__alerta">
      <strong>No se pudo calcular el score de confianza</strong>
      <p>{resultado.diagnostico.mensaje}</p>
      <p>La falta de score no demuestra que los datos extraídos sean incorrectos.</p>
      {resultado.diagnostico.conteos && <dl className="datos">{Object.entries(resultado.diagnostico.conteos).map(([nombre, valor]) =>
        <div className="dato" key={nombre}><dt>{nombre.replaceAll("_", " ")}</dt><dd>{valor}</dd></div>
      )}</dl>}
      <details><summary>Referencia del diagnóstico</summary><p>Código: <code>{resultado.diagnostico.codigo}</code> · Etapa: {resultado.diagnostico.etapa}{resultado.diagnostico.http_status ? ` · HTTP ${resultado.diagnostico.http_status}` : ""}</p></details>
    </div>}
    <dl className="datos">{Object.entries(resultado.factores).map(([nombre, valor]) =>
      <div className="dato" key={nombre}><dt>{nombre}</dt><dd>{valor === null ? "No evaluable" : `${Math.round(valor * 100)} / 100`}</dd></div>
    )}</dl>
    <p>{resultado.requiere_revision_humana ? "Requiere revisión humana." : "Supera el umbral provisional de extracción."}</p>
    {observaciones.length > 0 && <section aria-label="Detalle de observaciones"><h5>Observaciones reportadas por el evaluador</h5><ul>{observaciones.map((detalle, i) => <li key={i}>{detalle}</li>)}</ul><p>Estas observaciones requieren cotejo con el documento original.</p></section>}
    {resultado.diagnostico?.campos_faltantes?.length ? <p>Campos sin evaluar: {resultado.diagnostico.campos_faltantes.join(", ")}</p> : null}
    {resultado.diagnostico?.campos_duplicados?.length ? <p>Campos evaluados más de una vez: {resultado.diagnostico.campos_duplicados.join(", ")}</p> : null}
    {!!resultado.motivos.length && <details><summary>Códigos de las observaciones</summary><ul>{resultado.motivos.map(motivo => <li key={motivo}>{motivo}</li>)}</ul></details>}
    <p className="resultado__nota">Estimación no calibrada, basada en cotejo con Gemini. No es una probabilidad de exactitud ni una aprobación médica.</p>
  </section>;
}
