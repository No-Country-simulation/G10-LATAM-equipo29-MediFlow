import type { DatosClinicos } from "@/lib/extraccion";

export type ExtraccionVisible = { datos_extraidos: DatosClinicos };
const ETIQUETAS: Record<string, string> = {
  paciente: "Paciente", profesionales: "Profesionales", documento: "Documento",
  institucion: "Institución", telefono: "Teléfono", direccion: "Dirección",
  motivo_consulta: "Motivo de consulta", antecedentes: "Antecedentes", alergias: "Alergias",
  sintomas: "Síntomas", exploracion_fisica: "Exploración física", signos_vitales: "Signos vitales",
  diagnosticos: "Diagnósticos", medicamentos: "Medicamentos", estudios: "Estudios",
  resultados_laboratorio: "Resultados de laboratorio", procedimientos: "Procedimientos",
  evolucion_clinica: "Evolución clínica", indicaciones: "Indicaciones", seguimiento: "Seguimiento",
  urgencia: "Urgencia documentada",
  unidad_edad: "Unidad de edad", fecha_nacimiento: "Fecha de nacimiento",
  rango_referencia: "Rango de referencia", correo_electronico: "Correo electrónico",
  identificacion: "Identificación", matricula: "Matrícula", via: "Vía", duracion: "Duración",
  concentracion: "Concentración", presentacion: "Presentación", descripcion: "Descripción",
  conclusion: "Conclusión", tecnica: "Técnica", region_anatomica: "Región anatómica", cie10: "CIE-10 documentado",
};
const etiqueta = (clave: string) => ETIQUETAS[clave] ??
  (clave.charAt(0).toUpperCase() + clave.slice(1)).replaceAll("_", " ");

// Conserva todos los campos, incluso los ausentes, sin anidar columnas estrechas.
function Valor({ valor }: { valor: unknown }) {
  if (valor === null || valor === undefined) return <span className="sin-datos">No consta</span>;
  if (Array.isArray(valor)) return valor.length ? <ul className="lista-clinica">{valor.map((item, indice) => <li key={indice}><Valor valor={item} /></li>)}</ul> : <span className="sin-datos">No consta información</span>;
  if (typeof valor === "object") return <dl className="ficha-campos">{Object.entries(valor).map(([clave, contenido]) => <div key={clave}><dt>{etiqueta(clave)}</dt><dd><Valor valor={contenido} /></dd></div>)}</dl>;
  return <span style={{ whiteSpace: "pre-wrap" }}>{typeof valor === "boolean" ? (valor ? "Sí" : "No") : String(valor)}</span>;
}

function Tabla({ titulo, filas }: { titulo: string; filas: Record<string, unknown>[] }) {
  const columnas = Array.from(new Set(filas.flatMap(fila => Object.keys(fila))));
  return <div className="tabla-clinica" role="region" aria-label={titulo} tabIndex={0}><table>
    <caption>{titulo}</caption>
    <thead><tr>{columnas.map(clave => <th scope="col" key={clave}>{etiqueta(clave)}</th>)}</tr></thead>
    <tbody>{filas.map((fila, indice) => <tr key={indice}>{columnas.map(clave => <td key={clave}><Valor valor={fila[clave]} /></td>)}</tr>)}</tbody>
  </table></div>;
}

function tieneDatos(valor: unknown): boolean {
  if (valor === null || valor === undefined || valor === "") return false;
  if (typeof valor === "object") return Object.values(valor).some(tieneDatos);
  return true;
}

export default function ExtraccionClinica({ datos }: { datos: Partial<ExtraccionVisible> }) {
  if (!datos.datos_extraidos) return <p>No hay datos clínicos disponibles.</p>;
  const entradas = Object.entries(datos.datos_extraidos);
  const ausentes = entradas.filter(([, valor]) => !tieneDatos(valor));
  return <section aria-label="Datos clínicos extraídos">
    <h4>Ficha clínica del documento</h4>
    <p className="resultado__nota">Información extraída del documento · Validación clínica pendiente. «No consta» indica ausencia de información, no un resultado negativo.</p>
    <div className="fichas-clinicas">{entradas.filter(([, valor]) => tieneDatos(valor)).map(([clave, valor]) => {
      const esTabla = ["medicamentos", "resultados_laboratorio", "signos_vitales"].includes(clave) && Array.isArray(valor) && valor.length > 0;
      return <section className={`ficha-clinica${esTabla || typeof valor === "string" || Array.isArray(valor) ? " ficha-clinica--ancha" : ""}`} key={clave} aria-label={etiqueta(clave)}>
        {esTabla ? <Tabla titulo={etiqueta(clave)} filas={valor as Record<string, unknown>[]} /> : <><h5>{etiqueta(clave)}</h5><Valor valor={valor} /></>}
      </section>;
    })}</div>
    {ausentes.length > 0 && <details className="campos-ausentes"><summary>Ver secciones sin información ({ausentes.length})</summary><div className="fichas-clinicas">{ausentes.map(([clave, valor]) => <section className="ficha-clinica" key={clave}><h5>{etiqueta(clave)}</h5><Valor valor={valor} /></section>)}</div></details>}
  </section>;
}
