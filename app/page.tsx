"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

import Etapas from "@/components/Etapas";
import type { EstadoEscena } from "@/components/EscenaMedica";
import VistaResultado, { veredictoDe } from "@/components/VistaResultado";
import { CANALES, formatearTamano } from "@/components/etiquetas";
import type { Fase, Resultado } from "@/components/tipos";

// La escena 3D solo existe en el navegador y se carga aparte del resto.
const EscenaMedica = dynamic(() => import("@/components/EscenaMedica"), {
  ssr: false,
});

/** Clasifica automáticamente un documento recién ingerido (usa la salida de la ingesta). */
async function clasificar(ingesta: unknown): Promise<Resultado> {
  const { documento_id, almacenamiento_oci } = ingesta as {
    documento_id: string;
    almacenamiento_oci: { ruta_objeto: string };
  };
  try {
    const respuesta = await fetch("/api/ingest/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documento_id,
        ruta_objeto: almacenamiento_oci.ruta_objeto,
      }),
    });
    return { ok: respuesta.ok, body: await respuesta.json() };
  } catch (error) {
    return { ok: false, body: { detalle: String(error) } };
  }
}

/** Enruta automáticamente según categoría y reglas condicionales. */
async function enrutar(
  clasificacion: unknown,
  ingesta: unknown,
): Promise<Resultado> {
  const datosClasificacion = clasificacion as {
    documento_id?: string;
    categoria?: string;
    confianza?: number;
    requiere_revision_humana?: boolean;
  };
  const datosIngesta = ingesta as { canal_origen?: string };

  if (
    !datosClasificacion.documento_id ||
    !datosClasificacion.categoria ||
    typeof datosClasificacion.confianza !== "number" ||
    typeof datosClasificacion.requiere_revision_humana !== "boolean"
  ) {
    return {
      ok: false,
      body: {
        detalle: "No se pudo enrutar: faltan datos de clasificación válidos.",
      },
    };
  }

  try {
    const respuesta = await fetch("/api/ingest/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documento_id: datosClasificacion.documento_id,
        categoria: datosClasificacion.categoria,
        confianza: datosClasificacion.confianza,
        requiere_revision_humana: datosClasificacion.requiere_revision_humana,
        canal_origen: datosIngesta.canal_origen,
      }),
    });
    return { ok: respuesta.ok, body: await respuesta.json() };
  } catch (error) {
    return { ok: false, body: { detalle: String(error) } };
  }
}

const TEXTO_BOTON: Record<Fase, string | null> = {
  reposo: null,
  ingesta: "Recibiendo el documento...",
  clasificacion: "Clasificando...",
  enrutamiento: "Eligiendo la cola de destino...",
  listo: null,
  error: null,
};

function Logo() {
  return (
    <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
      <g transform="rotate(-45 16 16)">
        <path d="M16 5h0a6 6 0 0 1 6 6v5H10v-5a6 6 0 0 1 6-6z" fill="#f4efe4" />
        <path d="M10 16h12v5a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6z" fill="#2dd4bf" />
      </g>
    </svg>
  );
}

export default function Pagina() {
  const [tab, setTab] = useState<"archivo" | "json">("archivo");
  const [fase, setFase] = useState<Fase>("reposo");
  const [resultado, setResultado] = useState<Resultado | null>(null);

  // --- estado: pestaña archivo ---
  const [archivo, setArchivo] = useState<File | null>(null);
  const [canalArchivo, setCanalArchivo] = useState("Otro");
  const [arrastrando, setArrastrando] = useState(false);

  // --- estado: pestaña JSON/texto ---
  const [texto, setTexto] = useState("");
  const [tipoJson, setTipoJson] = useState<"JSON" | "TEXTO">("TEXTO");
  const [canalJson, setCanalJson] = useState("Otro");

  const panelResultado = useRef<HTMLDivElement>(null);
  const enviando =
    fase === "ingesta" || fase === "clasificacion" || fase === "enrutamiento";

  /** Corre el flujo completo: ingesta → clasificación → enrutamiento. */
  async function ejecutarFlujo(ingestar: () => Promise<Response>) {
    setResultado(null);
    setFase("ingesta");

    try {
      const respuesta = await ingestar();
      const ingesta: Resultado = {
        ok: respuesta.ok,
        body: await respuesta.json(),
      };

      if (!ingesta.ok) {
        setResultado(ingesta);
        setFase("error");
        return;
      }

      setResultado(ingesta);
      setFase("clasificacion");
      const resultadoClasificacion = await clasificar(ingesta.body);

      if (!resultadoClasificacion.ok) {
        setResultado({ ...ingesta, clasificacion: resultadoClasificacion });
        setFase("error");
        return;
      }

      setResultado({ ...ingesta, clasificacion: resultadoClasificacion });
      setFase("enrutamiento");
      const resultadoEnrutamiento = await enrutar(
        resultadoClasificacion.body,
        ingesta.body,
      );

      setResultado({
        ...ingesta,
        clasificacion: resultadoClasificacion,
        enrutamiento: resultadoEnrutamiento,
      });
      setFase(resultadoEnrutamiento.ok ? "listo" : "error");
    } catch (error) {
      setResultado({ ok: false, body: { detalle: String(error) } });
      setFase("error");
    }
  }

  function enviarArchivo() {
    if (!archivo || enviando) return;
    const formData = new FormData();
    formData.append("archivo", archivo);
    formData.append("canal_origen", canalArchivo);
    void ejecutarFlujo(() =>
      fetch("/api/ingest/file", { method: "POST", body: formData }),
    );
  }

  function enviarJson() {
    if (!texto.trim() || enviando) return;
    void ejecutarFlujo(() =>
      fetch("/api/ingest/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_archivo: tipoJson,
          documento_texto: texto,
          canal_origen: canalJson,
        }),
      }),
    );
  }

  // Al terminar, lleva la vista al resultado (útil cuando está debajo del formulario).
  useEffect(() => {
    if (fase !== "listo" && fase !== "error") return;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelResultado.current?.scrollIntoView({
      behavior: reducido ? "auto" : "smooth",
      block: "nearest",
    });
  }, [fase]);

  const veredicto = veredictoDe(resultado);
  const estadoEscena: EstadoEscena = enviando
    ? "procesando"
    : fase === "error"
      ? "error"
      : fase === "listo"
        ? veredicto === "revision"
          ? "revision"
          : "ok"
        : "reposo";

  return (
    <>
      <section className="portada">
        <header className="portada__barra">
          <span className="marca">
            <Logo />
            MediFlow
          </span>
        </header>

        <div className="portada__contenido">
          <div className="portada__texto">
            <h1 className="portada__titulo">
              Cada documento clínico, en la cola correcta.
            </h1>
            <p className="portada__bajada">
              Reciba PDF, imágenes o texto, clasifíquelos con IA y envíelos al
              área que corresponde. Los casos dudosos pasan a revisión humana.
            </p>
            <a className="boton boton--claro" href="#recepcion">
              Subir un documento
            </a>
          </div>

          <div className="portada__escena">
            <EscenaMedica estado={estadoEscena} />
          </div>
        </div>
      </section>

      <main id="recepcion" className="mesa">
        <div className="mesa__interior">
          <div className="entrada">
            <div className="pestanas" role="tablist" aria-label="Forma de envío">
              <span
                className={`pestanas__indicador ${tab === "json" ? "pestanas__indicador--der" : ""}`}
                aria-hidden="true"
              />
              <button
                role="tab"
                id="pestana-archivo"
                aria-selected={tab === "archivo"}
                aria-controls="panel-archivo"
                className="pestana"
                onClick={() => setTab("archivo")}
              >
                Subir un archivo
              </button>
              <button
                role="tab"
                id="pestana-json"
                aria-selected={tab === "json"}
                aria-controls="panel-json"
                className="pestana"
                onClick={() => setTab("json")}
              >
                Texto o JSON
              </button>
            </div>

            {tab === "archivo" && (
              <div
                role="tabpanel"
                id="panel-archivo"
                aria-labelledby="pestana-archivo"
                className="formulario"
              >
                <label
                  className={`zona ${arrastrando ? "zona--sobre" : ""} ${archivo ? "zona--llena" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setArrastrando(true);
                  }}
                  onDragLeave={() => setArrastrando(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setArrastrando(false);
                    const soltado = e.dataTransfer.files?.[0];
                    if (soltado) setArchivo(soltado);
                  }}
                >
                  <input
                    id="archivo"
                    className="zona__entrada"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,.json"
                    onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                  />
                  <span className="zona__cuerpo">
                    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
                      <path
                        d="M11 5h13l8 8v20a2 2 0 0 1-2 2H11a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                      />
                      <path d="M24 5v8h8M20 29V19m-4 4l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {archivo ? (
                      <>
                        <strong className="zona__nombre">{archivo.name}</strong>
                        <span className="zona__ayuda">
                          {formatearTamano(archivo.size)}. Haga clic para elegir otro.
                        </span>
                      </>
                    ) : (
                      <>
                        <strong>Arrastre un documento o haga clic para elegirlo</strong>
                        <span className="zona__ayuda">
                          PDF, JPG, PNG, TIFF, WEBP o JSON
                        </span>
                      </>
                    )}
                  </span>
                </label>

                <label className="campo" htmlFor="canal-archivo">
                  Canal de origen
                </label>
                <select
                  id="canal-archivo"
                  className="selector"
                  value={canalArchivo}
                  onChange={(e) => setCanalArchivo(e.target.value)}
                >
                  {CANALES.map((c) => (
                    <option key={c.valor} value={c.valor}>
                      {c.etiqueta}
                    </option>
                  ))}
                </select>

                <button
                  className="boton boton--principal"
                  disabled={!archivo || enviando}
                  onClick={enviarArchivo}
                >
                  {TEXTO_BOTON[fase] ?? "Enviar documento"}
                </button>
              </div>
            )}

            {tab === "json" && (
              <div
                role="tabpanel"
                id="panel-json"
                aria-labelledby="pestana-json"
                className="formulario"
              >
                <label className="campo" htmlFor="texto">
                  Contenido del documento
                </label>
                <textarea
                  id="texto"
                  className="area"
                  rows={8}
                  placeholder="Pegue aquí el contenido clínico en texto plano o JSON..."
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                />

                <div className="par">
                  <div>
                    <label className="campo" htmlFor="tipo-json">
                      Tipo de contenido
                    </label>
                    <select
                      id="tipo-json"
                      className="selector"
                      value={tipoJson}
                      onChange={(e) =>
                        setTipoJson(e.target.value as "JSON" | "TEXTO")
                      }
                    >
                      <option value="TEXTO">Texto</option>
                      <option value="JSON">JSON</option>
                    </select>
                  </div>
                  <div>
                    <label className="campo" htmlFor="canal-json">
                      Canal de origen
                    </label>
                    <select
                      id="canal-json"
                      className="selector"
                      value={canalJson}
                      onChange={(e) => setCanalJson(e.target.value)}
                    >
                      {CANALES.map((c) => (
                        <option key={c.valor} value={c.valor}>
                          {c.etiqueta}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  className="boton boton--principal"
                  disabled={!texto.trim() || enviando}
                  onClick={enviarJson}
                >
                  {TEXTO_BOTON[fase] ?? "Enviar contenido"}
                </button>
              </div>
            )}

            <p className="nota-formatos">
              Solo se aceptan PDF, imagen, JSON y texto. Cualquier otro formato
              se rechaza con el error 415, aunque la extensión del archivo esté
              falseada.
            </p>
          </div>

          <aside className="avance" aria-live="polite" ref={panelResultado}>
            <Etapas fase={fase} resultado={resultado} />
            {resultado ? (
              <VistaResultado resultado={resultado} />
            ) : (
              <p className="vacio">
                Cuando envíe un documento, aquí verá su categoría, el nivel de
                confianza y la cola a la que fue enviado.
              </p>
            )}
          </aside>
        </div>

        <footer className="pie">
          Proyecto del Hackathon ONE, grupo 10 (Oracle Next Education y Alura).
        </footer>
      </main>
    </>
  );
}
