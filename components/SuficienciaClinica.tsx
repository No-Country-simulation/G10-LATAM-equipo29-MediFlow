import type { SuficienciaClinica as ResultadoSuficiencia } from "@/lib/suficiencia-clinica";
import { nombreCampo } from "@/lib/observaciones-confianza";
export default function SuficienciaClinica({ resultado }: { resultado: ResultadoSuficiencia }) {
  return <section aria-label="Suficiencia clínica y ambigüedades">
    <h4>Suficiencia clínica y ambigüedades</h4>
    <p>{resultado.estado === "sin_hallazgos" ? "Sin hallazgos en las comprobaciones realizadas" : resultado.estado === "no_evaluable" ? "Evaluación incompleta · Revisión humana requerida" : "Datos faltantes o ambiguos · Revisión humana requerida"}</p>
    {resultado.hallazgos.length > 0 && <ul>{resultado.hallazgos.map((h, i) => <li key={i}><strong>{nombreCampo(h.ruta) || "Evaluación"}</strong>: {h.mensaje} <small>({h.origen === "modelo" ? "Observación del modelo" : h.origen === "regla" ? "Regla de datos mínimos" : "Fallo de evaluación"})</small></li>)}</ul>}
    <p className="resultado__nota">Revisión automática preliminar. Sin catálogo farmacológico: no confirma existencia ni ortografía de medicamentos, seguridad del tratamiento ni corrección médica. Los hallazgos requieren revisión profesional.</p>
  </section>;
}
