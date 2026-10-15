import { leer, type Resultado } from "./tipos";
import {
  formatearTamano,
  nombreCategoria,
  nombreDestino,
  nombreNodo,
  nombreTipo,
} from "./etiquetas";

type Ingesta = {
  documento_id: string;
  tipo_archivo_detectado: string;
  tamano_bytes: number;
  detalle: string;
};
type Clasificacion = {
  categoria: string;
  confianza: number;
  justificacion: string;
  requiere_revision_humana: boolean;
  detalle: string;
};
type Enrutamiento = {
  destino: string;
  fallback_activado: boolean;
  motivo_fallback: string | null;
  ruta_decision: string[];
  detalle: string;
};

export type Veredicto = "ok" | "revision" | "error";

/** Resume el resultado completo en un solo veredicto visual. */
export function veredictoDe(resultado: Resultado | null): Veredicto | null {
  if (!resultado) return null;
  if (!resultado.ok) return "error";
  const clasificacion = resultado.clasificacion;
  const enrutamiento = resultado.enrutamiento;
  if (!clasificacion?.ok || !enrutamiento?.ok) return "error";
  const c = leer<Clasificacion>(clasificacion.body);
  const r = leer<Enrutamiento>(enrutamiento.body);
  if (c.requiere_revision_humana || r.destino === "cola_revision_manual") return "revision";
  return "ok";
}

function Fila({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="dato">
      <dt>{nombre}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function mensajeError(resultado: Resultado): string | null {
  const etapas = [resultado.enrutamiento, resultado.clasificacion, resultado];
  for (const etapa of etapas) {
    if (etapa && !etapa.ok) {
      const { detalle } = leer<{ detalle: string }>(etapa.body);
      return typeof detalle === "string" ? detalle : "La etapa devolvió un error sin detalle.";
    }
  }
  return null;
}

export default function VistaResultado({ resultado }: { resultado: Resultado }) {
  const veredicto = veredictoDe(resultado) ?? "error";
  const i = leer<Ingesta>(resultado.body);
  const c = leer<Clasificacion>(resultado.clasificacion?.body);
  const r = leer<Enrutamiento>(resultado.enrutamiento?.body);
  const error = mensajeError(resultado);

  const titulo =
    veredicto === "ok"
      ? "Documento enrutado"
      : veredicto === "revision"
        ? "Pasó a revisión humana"
        : "No se pudo completar el envío";

  const confianza = typeof c.confianza === "number" ? Math.round(c.confianza * 100) : null;

  return (
    <section className={`resultado resultado--${veredicto}`} aria-labelledby="titulo-resultado">
      <h3 id="titulo-resultado" className="resultado__titulo">
        <span className="resultado__punto" aria-hidden="true" />
        {titulo}
      </h3>

      {error && <p className="resultado__error">{error}</p>}

      <dl className="datos">
        {i.documento_id && (
          <Fila nombre="Documento">
            <code>{i.documento_id}</code>
          </Fila>
        )}
        {i.tipo_archivo_detectado && (
          <Fila nombre="Formato">
            {nombreTipo(i.tipo_archivo_detectado)}, {formatearTamano(i.tamano_bytes)}
          </Fila>
        )}
        {c.categoria && <Fila nombre="Categoría">{nombreCategoria(c.categoria)}</Fila>}
        {confianza !== null && (
          <Fila nombre="Confianza">
            <span className="medidor" role="img" aria-label={`${confianza} por ciento`}>
              <span className="medidor__barra" style={{ width: `${confianza}%` }} />
            </span>
            <span className="medidor__valor">{confianza}%</span>
          </Fila>
        )}
        {r.destino && <Fila nombre="Destino">{nombreDestino(r.destino)}</Fila>}
      </dl>

      {c.justificacion && <p className="resultado__nota">{c.justificacion}</p>}
      {r.fallback_activado && r.motivo_fallback && <p className="resultado__nota">{r.motivo_fallback}</p>}

      {Array.isArray(r.ruta_decision) && r.ruta_decision.length > 0 && (
        <ul className="ruta" aria-label="Ruta de decisión">
          {r.ruta_decision.map((nodo, n) => (
            <li key={`${nodo}-${n}`}>{nombreNodo(nodo)}</li>
          ))}
        </ul>
      )}

      <details className="crudo">
        <summary>Ver la respuesta completa</summary>
        <pre>
          {JSON.stringify(
            {
              ingesta: resultado.body,
              clasificacion: resultado.clasificacion?.body,
              enrutamiento: resultado.enrutamiento?.body,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </section>
  );
}
