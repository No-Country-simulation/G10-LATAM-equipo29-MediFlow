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
  identificacion: "Identificación", matricula: "Matrícula", via: "Vía", duracion: "Duración",
  concentracion: "Concentración", presentacion: "Presentación", descripcion: "Descripción",
  conclusion: "Conclusión", tecnica: "Técnica", region_anatomica: "Región anatómica", cie10: "CIE-10 documentado",
};
const etiqueta = (clave: string) => ETIQUETAS[clave] ??
  (clave.charAt(0).toUpperCase() + clave.slice(1)).replaceAll("_", " ");

// Recorre todas las secciones para que ningún campo del contrato quede oculto.
function Valor({ valor }: { valor: unknown }) {
  if (valor === null || valor === undefined) return <>No consta</>;
  if (Array.isArray(valor)) return valor.length ? (
    <ol>{valor.map((item, indice) => <li key={indice}><Valor valor={item} /></li>)}</ol>
  ) : <>No consta información</>;
  if (typeof valor === "object") return (
    <dl className="datos">{Object.entries(valor).map(([clave, contenido]) => (
      <div className="dato" key={clave}>
        <dt>{etiqueta(clave)}</dt><dd><Valor valor={contenido} /></dd>
      </div>
    ))}</dl>
  );
  return <span style={{ whiteSpace: "pre-wrap" }}>{typeof valor === "boolean" ? (valor ? "Sí" : "No") : String(valor)}</span>;
}

export default function ExtraccionClinica({ datos }: { datos: Partial<ExtraccionVisible> }) {
  if (!datos.datos_extraidos) return null;
  return (
    <section aria-label="Datos clínicos extraídos">
      <h4>Datos clínicos extraídos</h4>
      <p className="resultado__nota">Validación clínica pendiente.</p>
      {Object.entries(datos.datos_extraidos).map(([clave, valor]) => (
        <section key={clave} aria-label={etiqueta(clave)}>
          <h5>{etiqueta(clave)}</h5>
          <Valor valor={valor} />
        </section>
      ))}
    </section>
  );
}
