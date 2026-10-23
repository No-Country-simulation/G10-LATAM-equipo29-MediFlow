import { leer, type Fase, type Resultado } from "./tipos";

type EstadoEtapa = "espera" | "activa" | "lista" | "error" | "omitida";

const ETAPAS: Array<{ clave: Exclude<Fase, "reposo" | "listo" | "error">; titulo: string; detalle: string }> = [
  { clave: "ingesta", titulo: "Ingesta", detalle: "Recibe el documento y valida su formato" },
  { clave: "clasificacion", titulo: "Clasificación", detalle: "Identifica el tipo de documento con Gemini" },
  { clave: "extraccion", titulo: "Extracción y decisión", detalle: "Valida, evalúa confianza y determina prioridad y destino" },
  { clave: "enrutamiento", titulo: "Enrutamiento", detalle: "Asigna la cola según el tipo de documento" },
  { clave: "almacenamiento", titulo: "Almacenamiento OCI", detalle: "Guarda el JSON final según la ruta del flujo" },
];

function tieneRutaNormal(resultado: Resultado | null): boolean {
  const datos = leer<{ prioridad_urgencia: { estado: string; nivel: string } }>(resultado?.extraccion?.body);
  return datos.prioridad_urgencia?.estado === "evaluada" && datos.prioridad_urgencia.nivel === "NORMAL";
}

function estadoDe(clave: (typeof ETAPAS)[number]["clave"], fase: Fase, resultado: Resultado | null): EstadoEtapa {
  if (clave === "extraccion" && resultado?.json_final?.decision_enrutamiento?.requiere_auditoria_humana) return "omitida";
  if (clave === "almacenamiento") {
    if (fase === clave) return "activa";
    if (resultado?.almacenamiento_oci) return resultado.almacenamiento_oci.status_backup === "exito" ? "lista" : "error";
    return "espera";
  }
  if (clave === "enrutamiento") {
    if (fase === "enrutamiento") return "activa";
    const datos = leer<{ status: string }>(resultado?.enrutamiento?.body);
    if (datos.status === "enrutado") return "lista";
    return fase === "error" && tieneRutaNormal(resultado) ? "error" : "espera";
  }
  if (clave === "extraccion" && tieneRutaNormal(resultado)) return "lista";
  const etapa =
    clave === "ingesta" ? resultado : resultado?.[clave];
  if (fase === clave) return "activa";
  if (etapa) return etapa.ok ? "lista" : "error";
  return "espera";
}

const TEXTO_ESTADO: Record<EstadoEtapa, string> = {
  espera: "en espera",
  activa: "en curso",
  lista: "completada",
  error: "con error",
  omitida: "omitida por revisión de clasificación",
};

function Marca({ estado, numero }: { estado: EstadoEtapa; numero: number }) {
  if (estado === "lista") {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (estado === "error") {
    return (
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  return <span>{numero}</span>;
}

export default function Etapas({ fase, resultado }: { fase: Fase; resultado: Resultado | null }) {
  const etapas = ETAPAS.filter(etapa => etapa.clave !== "enrutamiento" || fase === "enrutamiento" || tieneRutaNormal(resultado));
  return (
    <ol className="etapas" aria-label="Avance del documento">
      {etapas.map((etapa, i) => {
        const estado = estadoDe(etapa.clave, fase, resultado);
        return (
          <li key={etapa.clave} className={`etapa etapa--${estado}`}>
            {i < etapas.length - 1 && (
              <span className={`etapa__union ${estado === "lista" ? "etapa__union--llena" : ""}`} aria-hidden="true" />
            )}
            <span className="etapa__marca">
              <Marca estado={estado} numero={i + 1} />
            </span>
            <span className="etapa__texto">
              <strong>{etapa.titulo}</strong>
              <span>{estado === "omitida" ? TEXTO_ESTADO.omitida : etapa.detalle}</span>
              <span className="solo-lector">, {TEXTO_ESTADO[estado]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
