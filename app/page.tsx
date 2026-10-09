"use client";

import { useState } from "react";

const CANALES = [
  "Guardia_Emergencias",
  "Consultorio_Externo",
  "Laboratorio",
  "Farmacia",
  "Portal_Paciente",
  "Otro",
];

type Resultado = {
  ok: boolean;
  body: unknown;
  clasificacion?: Resultado;
  enrutamiento?: Resultado;
};

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

export default function Pagina() {
  const [tab, setTab] = useState<"archivo" | "json">("archivo");

  // --- estado: pestaña archivo ---
  const [archivo, setArchivo] = useState<File | null>(null);
  const [canalArchivo, setCanalArchivo] = useState("Otro");
  const [resultadoArchivo, setResultadoArchivo] = useState<Resultado | null>(
    null,
  );
  const [enviandoArchivo, setEnviandoArchivo] = useState(false);

  // --- estado: pestaña JSON/texto ---
  const [texto, setTexto] = useState("");
  const [tipoJson, setTipoJson] = useState<"JSON" | "TEXTO">("TEXTO");
  const [canalJson, setCanalJson] = useState("Otro");
  const [resultadoJson, setResultadoJson] = useState<Resultado | null>(null);
  const [enviandoJson, setEnviandoJson] = useState(false);

  async function enviarArchivo() {
    if (!archivo) return;
    setEnviandoArchivo(true);
    setResultadoArchivo(null);

    try {
      const formData = new FormData();
      formData.append("archivo", archivo);
      formData.append("canal_origen", canalArchivo);

      const respuesta = await fetch("/api/ingest/file", {
        method: "POST",
        body: formData,
      });
      const ingesta: Resultado = {
        ok: respuesta.ok,
        body: await respuesta.json(),
      };

      if (!ingesta.ok) {
        setResultadoArchivo(ingesta);
        return;
      }

      const resultadoClasificacion = await clasificar(ingesta.body);
      const resultadoEnrutamiento = resultadoClasificacion.ok
        ? await enrutar(resultadoClasificacion.body, ingesta.body)
        : undefined;

      setResultadoArchivo({
        ...ingesta,
        clasificacion: resultadoClasificacion,
        enrutamiento: resultadoEnrutamiento,
      });
    } catch (error) {
      setResultadoArchivo({ ok: false, body: { detalle: String(error) } });
    } finally {
      setEnviandoArchivo(false);
    }
  }

  async function enviarJson() {
    if (!texto.trim()) return;
    setEnviandoJson(true);
    setResultadoJson(null);

    try {
      const respuesta = await fetch("/api/ingest/json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tipo_archivo: tipoJson,
          documento_texto: texto,
          canal_origen: canalJson,
        }),
      });
      const ingesta: Resultado = {
        ok: respuesta.ok,
        body: await respuesta.json(),
      };

      if (!ingesta.ok) {
        setResultadoJson(ingesta);
        return;
      }

      const resultadoClasificacion = await clasificar(ingesta.body);
      const resultadoEnrutamiento = resultadoClasificacion.ok
        ? await enrutar(resultadoClasificacion.body, ingesta.body)
        : undefined;

      setResultadoJson({
        ...ingesta,
        clasificacion: resultadoClasificacion,
        enrutamiento: resultadoEnrutamiento,
      });
    } catch (error) {
      setResultadoJson({ ok: false, body: { detalle: String(error) } });
    } finally {
      setEnviandoJson(false);
    }
  }

  return (
    <main>
      <h1>🏥 MediFlow — Recepción de documentos clínicos</h1>
      <p className="subtitulo">
        Formatos soportados: PDF, imagen (jpg/png/tiff/webp) o JSON/texto.
      </p>

      <div className="tabs">
        <button
          className={`tab ${tab === "archivo" ? "activa" : ""}`}
          onClick={() => setTab("archivo")}
        >
          📄 Subir archivo (PDF/Imagen/JSON)
        </button>
        <button
          className={`tab ${tab === "json" ? "activa" : ""}`}
          onClick={() => setTab("json")}
        >
          🧾 Enviar JSON/texto
        </button>
      </div>

      {tab === "archivo" && (
        <div className="panel">
          <label htmlFor="archivo">Documento clínico</label>
          <input
            id="archivo"
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff,.webp,.json"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          />

          <label htmlFor="canal-archivo">Canal de origen</label>
          <select
            id="canal-archivo"
            value={canalArchivo}
            onChange={(e) => setCanalArchivo(e.target.value)}
          >
            {CANALES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            className="enviar"
            disabled={!archivo || enviandoArchivo}
            onClick={enviarArchivo}
          >
            {enviandoArchivo
              ? "Enviando, clasificando y enrutando..."
              : "Enviar archivo"}
          </button>

          {resultadoArchivo && (
            <div
              className={`resultado ${resultadoArchivo.ok ? "ok" : "error"}`}
            >
              {JSON.stringify(resultadoArchivo.body, null, 2)}
            </div>
          )}
          {resultadoArchivo?.clasificacion && (
            <div
              className={`resultado ${resultadoArchivo.clasificacion.ok ? "ok" : "error"}`}
            >
              {"Clasificación:\n" +
                JSON.stringify(resultadoArchivo.clasificacion.body, null, 2)}
            </div>
          )}
          {resultadoArchivo?.enrutamiento && (
            <div
              className={`resultado ${resultadoArchivo.enrutamiento.ok ? "ok" : "error"}`}
            >
              {"Enrutamiento:\n" +
                JSON.stringify(resultadoArchivo.enrutamiento.body, null, 2)}
            </div>
          )}
        </div>
      )}

      {tab === "json" && (
        <div className="panel">
          <label htmlFor="texto">documento_texto</label>
          <textarea
            id="texto"
            rows={8}
            placeholder="Pegue aquí el contenido clínico en texto plano..."
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />

          <label htmlFor="tipo-json">tipo_archivo</label>
          <select
            id="tipo-json"
            value={tipoJson}
            onChange={(e) => setTipoJson(e.target.value as "JSON" | "TEXTO")}
          >
            <option value="TEXTO">TEXTO</option>
            <option value="JSON">JSON</option>
          </select>

          <label htmlFor="canal-json">Canal de origen</label>
          <select
            id="canal-json"
            value={canalJson}
            onChange={(e) => setCanalJson(e.target.value)}
          >
            {CANALES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <button
            className="enviar"
            disabled={!texto.trim() || enviandoJson}
            onClick={enviarJson}
          >
            {enviandoJson
              ? "Enviando, clasificando y enrutando..."
              : "Enviar JSON"}
          </button>

          {resultadoJson && (
            <div className={`resultado ${resultadoJson.ok ? "ok" : "error"}`}>
              {JSON.stringify(resultadoJson.body, null, 2)}
            </div>
          )}
          {resultadoJson?.clasificacion && (
            <div
              className={`resultado ${resultadoJson.clasificacion.ok ? "ok" : "error"}`}
            >
              {"Clasificación:\n" +
                JSON.stringify(resultadoJson.clasificacion.body, null, 2)}
            </div>
          )}
          {resultadoJson?.enrutamiento && (
            <div
              className={`resultado ${resultadoJson.enrutamiento.ok ? "ok" : "error"}`}
            >
              {"Enrutamiento:\n" +
                JSON.stringify(resultadoJson.enrutamiento.body, null, 2)}
            </div>
          )}
        </div>
      )}

      <p className="formatos">
        Rechazo estricto: cualquier formato fuera de PDF / IMAGEN / JSON / TEXTO
        se rechaza con 415, incluso si la extensión del archivo está falseada.
      </p>
    </main>
  );
}
