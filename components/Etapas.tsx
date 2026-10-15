import type { Fase, Resultado } from "./tipos";

type EstadoEtapa = "espera" | "activa" | "lista" | "error";

const ETAPAS: Array<{ clave: Exclude<Fase, "reposo" | "listo" | "error">; titulo: string; detalle: string }> = [
  { clave: "ingesta", titulo: "Ingesta", detalle: "Recibe el documento y valida su formato" },
  { clave: "clasificacion", titulo: "Clasificación", detalle: "La IA identifica qué tipo de documento es" },
  { clave: "enrutamiento", titulo: "Enrutamiento", detalle: "Elige la cola que debe atenderlo" },
];

function estadoDe(clave: (typeof ETAPAS)[number]["clave"], fase: Fase, resultado: Resultado | null): EstadoEtapa {
  const etapa =
    clave === "ingesta" ? resultado : clave === "clasificacion" ? resultado?.clasificacion : resultado?.enrutamiento;
  if (fase === clave) return "activa";
  if (etapa) return etapa.ok ? "lista" : "error";
  return "espera";
}

const TEXTO_ESTADO: Record<EstadoEtapa, string> = {
  espera: "en espera",
  activa: "en curso",
  lista: "completada",
  error: "con error",
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
  return (
    <ol className="etapas" aria-label="Avance del documento">
      {ETAPAS.map((etapa, i) => {
        const estado = estadoDe(etapa.clave, fase, resultado);
        return (
          <li key={etapa.clave} className={`etapa etapa--${estado}`}>
            {i < ETAPAS.length - 1 && (
              <span className={`etapa__union ${estado === "lista" ? "etapa__union--llena" : ""}`} aria-hidden="true" />
            )}
            <span className="etapa__marca">
              <Marca estado={estado} numero={i + 1} />
            </span>
            <span className="etapa__texto">
              <strong>{etapa.titulo}</strong>
              <span>{etapa.detalle}</span>
              <span className="solo-lector">, {TEXTO_ESTADO[estado]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
