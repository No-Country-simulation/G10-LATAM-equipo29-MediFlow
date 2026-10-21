import type { ConfianzaDocumento as ResultadoConfianza } from "@/lib/confianza-extraccion";

export default function ConfianzaDocumento({ resultado }: { resultado: ResultadoConfianza }) {
  return <section aria-label="Confianza de la extracción clínica">
    <h4>Confianza de la extracción clínica</h4>
    <p>{resultado.score === null ? "No evaluable" : `${Math.round(resultado.score * 100)} / 100 · Nivel ${resultado.nivel}`}</p>
    <dl className="datos">{Object.entries(resultado.factores).map(([nombre, valor]) =>
      <div className="dato" key={nombre}><dt>{nombre}</dt><dd>{valor === null ? "No evaluable" : `${Math.round(valor * 100)} / 100`}</dd></div>
    )}</dl>
    <p>{resultado.requiere_revision_humana ? "Requiere revisión humana." : "Supera el umbral provisional de extracción."}</p>
    {!!resultado.motivos.length && <ul>{resultado.motivos.map(motivo => <li key={motivo}>{motivo.replaceAll("_", " ")}</li>)}</ul>}
    {!!resultado.campos_observados.length && <ul>{resultado.campos_observados.map(campo =>
      <li key={campo.ruta}><code>{campo.ruta}</code>: {campo.estado.replaceAll("_", " ")}</li>
    )}</ul>}
    <p className="resultado__nota">Estimación no calibrada, basada en cotejo con Gemini. No es una probabilidad de exactitud ni una aprobación médica.</p>
  </section>;
}
