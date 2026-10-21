import type { ValidacionEstructural as ResultadoValidacion } from "@/lib/validacion-clinica";

export default function ValidacionEstructural({ resultado }: { resultado: ResultadoValidacion }) {
  return (
    <section aria-label="Validación de estructura y tipos">
      <h4>Validación de estructura y tipos</h4>
      <p>{resultado.valido ? "JSON válido según el esquema." : "JSON inválido según el esquema."}</p>
      <p className="resultado__nota">Esquema {resultado.version_esquema}. No confirma exactitud ni validez clínica.</p>
      {!!resultado.errores.length && <ul>{resultado.errores.map((error, indice) => (
        <li key={indice}><code>{error.ruta}</code>: {error.mensaje} ({error.regla})</li>
      ))}</ul>}
      {resultado.total_errores > resultado.errores.length && <p>Se muestran {resultado.errores.length} de {resultado.total_errores} errores.</p>}
    </section>
  );
}
