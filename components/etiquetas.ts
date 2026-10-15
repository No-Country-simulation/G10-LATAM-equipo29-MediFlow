/** Textos legibles para los valores técnicos que devuelve la API.
 * Los valores enviados al servidor no cambian; solo se traducen al mostrarlos. */

export const CANALES: Array<{ valor: string; etiqueta: string }> = [
  { valor: "Guardia_Emergencias", etiqueta: "Guardia de emergencias" },
  { valor: "Consultorio_Externo", etiqueta: "Consultorio externo" },
  { valor: "Laboratorio", etiqueta: "Laboratorio" },
  { valor: "Farmacia", etiqueta: "Farmacia" },
  { valor: "Portal_Paciente", etiqueta: "Portal del paciente" },
  { valor: "Otro", etiqueta: "Otro" },
];

const CATEGORIAS: Record<string, string> = {
  RECETA_MEDICA: "Receta médica",
  RESULTADO_LABORATORIO: "Resultado de laboratorio",
  INFORME_IMAGENOLOGIA: "Informe de imagenología",
  HISTORIA_CLINICA: "Historia clínica",
  RESUMEN_ALTA: "Resumen de alta",
  ORDEN_MEDICA: "Orden médica",
  CERTIFICADO_MEDICO: "Certificado médico",
  CONSENTIMIENTO_INFORMADO: "Consentimiento informado",
  DOCUMENTO_ADMINISTRATIVO: "Documento administrativo",
  OTRO: "Otro tipo de documento",
};

const DESTINOS: Record<string, string> = {
  cola_farmacia: "Farmacia",
  cola_laboratorio: "Laboratorio",
  cola_imagenologia: "Imagenología",
  cola_historia_clinica: "Historia clínica",
  cola_resumen_alta: "Altas",
  cola_ordenes_medicas: "Órdenes médicas",
  cola_certificados: "Certificados",
  cola_consentimientos: "Consentimientos",
  cola_administrativa: "Administración",
  cola_revision_manual: "Revisión manual",
};

const NODOS: Record<string, string> = {
  INICIO: "Inicio",
  REVISION_HUMANA: "Revisión humana",
  RUTA_PRIMARIA: "Ruta primaria",
  FALLBACK_CONTINGENCIA: "Contingencia",
  FIN: "Fin",
};

const TIPOS: Record<string, string> = {
  PDF: "PDF",
  IMAGEN: "Imagen",
  JSON: "JSON",
  TEXTO: "Texto",
};

export const nombreCategoria = (v?: string) => (v ? (CATEGORIAS[v] ?? v) : "—");
export const nombreDestino = (v?: string) => (v ? (DESTINOS[v] ?? v) : "—");
export const nombreNodo = (v: string) => NODOS[v] ?? v;
export const nombreTipo = (v?: string) => (v ? (TIPOS[v] ?? v) : "—");

export function formatearTamano(bytes?: number): string {
  if (typeof bytes !== "number") return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
