import { PROMPT_SUFICIENCIA, evaluarSuficiencia } from "../lib/suficiencia-clinica";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ExtraccionClinica from "../components/ExtraccionClinica";
import type { GenerateContentParameters } from "@google/genai";
import { ObjectStorageClient } from "oci-objectstorage";
import { extraerDocumento, type DatosClinicos } from "../lib/extraccion";
import type { ConexionGemini } from "../lib/clasificacion";
import { decidirEnrutamiento, PROMPT_PRIORIDAD } from "../lib/decision-enrutamiento";
import { POST } from "../app/api/ingest/extract/route";
import VistaResultado, { veredictoDe } from "../components/VistaResultado";
import Etapas from "../components/Etapas";
import { validarDatosClinicos } from "../lib/validacion-clinica";
import { camposExtraidos, calcularConfianza, evaluarConfianza, PROMPT_EVALUACION, type Evaluacion } from "../lib/confianza-extraccion";

const fuente = "Paciente: Persona Sintética. ID: TEST-001. Edad: 45. Nacimiento: 1981-01-02. " +
  "Fecha: 2026-10-18. Profesional: Médico Ejemplo. Matrícula: DEMO-01. " +
  "Medicamento ficticio X, 1 unidad, vía oral, cada 24 horas, por 2 días.";
function vacio(): DatosClinicos {
  return {
    paciente: { nombre: null, identificacion: null, edad: null, unidad_edad: null,
      fecha_nacimiento: null, sexo: null, contacto: null },
    profesionales: [], documento: { titulo: null, fecha: null, identificador: null },
    institucion: { nombre: null, telefono: null, direccion: null, correo_electronico: null, sitio_web: null },
    motivo_consulta: null, antecedentes: [], alergias: [], sintomas: [], exploracion_fisica: null,
    signos_vitales: [], diagnosticos: [], medicamentos: [], estudios: [], resultados_laboratorio: [],
    procedimientos: [], evolucion_clinica: null, indicaciones: [], seguimiento: [],
    urgencia: { declarada: null, descripcion: null },
  };
}
function datos(): DatosClinicos {
  const d = vacio();
  d.paciente = { ...d.paciente, nombre: "Persona Sintética", edad: 45 };
  d.profesionales = [{ nombre: "Médico Ejemplo", matricula: "DEMO-01", especialidad: null, rol: null }];
  d.medicamentos = [{ nombre: "Medicamento ficticio X", dosis: "1 unidad", via: "oral",
    frecuencia: "cada 24 horas", duracion: "2 días", concentracion: null, presentacion: null,
    cantidad: null, indicaciones: null, estado: null }];
  return d;
}
const entrada = () => ({ contenido: Buffer.from(JSON.stringify({ tipo_archivo: "TEXTO", documento_texto: fuente })),
  extension: "json" });

test("decisión: umbral, observaciones y fallos impiden enrutamiento automático", async () => {
  const confianza = calcularConfianza(datos(), evaluacion());
  let llamadas = 0;
  const conexion: ConexionGemini = { modelo: "prueba", async generar() {
    llamadas++;
    return { text: JSON.stringify({ nivel: "NORMAL", justificacion: "Seguimiento documentado." }) };
  } };
  for (const cambio of [{ score: 0.8499 }, { score: null }, { estado: "no_evaluable" as const },
    { requiere_revision_humana: true }, { motivos: ["INFORMACION_OMITIDA"] }]) {
    const r = await decidirEnrutamiento(datos(), { ...confianza, ...cambio }, conexion);
    assert.equal(r.decision_enrutamiento.destino_principal, "Cola_Auditoria_Humana");
    assert.equal(r.prioridad_urgencia.estado, "omitida");
    assert.equal(r.decision_enrutamiento.notificacion_generada, null);
  }
  assert.equal(llamadas, 0);
  const limite = await decidirEnrutamiento(datos(), { ...confianza, score: 0.85 }, conexion);
  assert.equal(limite.evaluacion_confianza.suficiente, true);
  assert.equal(limite.decision_enrutamiento.destino_principal, "Ruta_Normal");
  for (const respuesta of ["{", "{}", JSON.stringify({ nivel: "NO_DETERMINADA", justificacion: "Falta contexto." })]) {
    const r = await decidirEnrutamiento(datos(), confianza, { modelo: "prueba", async generar() { return { text: respuesta }; } });
    assert.equal(r.decision_enrutamiento.requiere_auditoria_humana, true);
  }
  const fallo = await decidirEnrutamiento(datos(), confianza, { modelo: "prueba", async generar() { throw new Error("SECRETO"); } });
  assert.equal(fallo.prioridad_urgencia.estado, "no_evaluable");
  assert.doesNotMatch(JSON.stringify(fallo), /SECRETO/);
});

test("decisión: urgencia prepara alerta sin enviarla y no rebaja urgencia declarada", async () => {
  const d = datos();
  d.urgencia = { declarada: true, descripcion: "Atención urgente indicada en documento sintético." };
  const confianza = calcularConfianza(d, evaluacion(d));
  for (const nivel of ["URGENTE", "NORMAL"]) {
    const r = await decidirEnrutamiento(d, confianza, { modelo: "prueba", async generar() {
      return { text: JSON.stringify({ nivel, justificacion: "Atención urgente documentada." }) };
    } });
    assert.equal(r.decision_enrutamiento.destino_principal, nivel === "URGENTE" ? "Cola_Emergencia_Medica" : "Cola_Auditoria_Humana");
    assert.equal(r.decision_enrutamiento.estado, "pendiente_entrega");
    if (nivel === "URGENTE") assert.equal(r.decision_enrutamiento.notificacion_generada?.estado, "pendiente_envio");
  }
});
function evaluacion(datosEvaluados: unknown = datos()): Evaluacion {
  return { campos: camposExtraidos(datosEvaluados).map(ruta => ({ ruta, estado: "respaldado" })),
    unidades_legibles: 20, unidades_ilegibles: 0, omisiones: [], conflicto_documental: false };
}
function simular(respuesta: unknown = datos()) {
  const llamadas: GenerateContentParameters[] = [];
  const conectar = (): ConexionGemini => ({ modelo: "modelo-prueba", async generar(params) {
    llamadas.push(params);
    if (respuesta instanceof Error) throw respuesta;
    if (params.config?.systemInstruction === PROMPT_SUFICIENCIA) return { text: JSON.stringify({ observaciones: [] }) };
    if (params.config?.systemInstruction === PROMPT_EVALUACION) return { text: JSON.stringify(evaluacion(respuesta)) };
    if (params.config?.systemInstruction === PROMPT_PRIORIDAD) return { text: JSON.stringify({ nivel: "NORMAL", justificacion: "Receta de seguimiento documentado." }) };
    return { text: typeof respuesta === "string" ? respuesta : JSON.stringify(respuesta) };
  } });
  return { llamadas, conectar };
}

test("extrae texto completo, valida y conserva ausencias sin inventar datos", async () => {
  const gemini = simular();
  const resultado = await extraerDocumento(entrada(), gemini.conectar);
  assert.deepEqual(resultado.datos_extraidos, datos());
  assert.equal("requiere_revision_humana" in resultado, false);
  assert.equal(resultado.validacion.valido, true);
  assert.equal("version_prompt" in resultado, false);
  assert.equal(resultado.confianza_documento.score, 1);
  assert.equal(gemini.llamadas.length, 4);
  assert.equal(resultado.decision_enrutamiento.destino_principal, "Ruta_Normal");
  assert.equal(gemini.llamadas[1].config?.systemInstruction, PROMPT_EVALUACION);
  const solicitud = JSON.stringify(gemini.llamadas[0]);
  assert.ok(solicitud.includes(fuente));
  assert.ok(!solicitud.includes('tipo_archivo'));
  assert.equal(gemini.llamadas[0].config?.responseMimeType, "application/json");
  assert.doesNotMatch(JSON.stringify(gemini.llamadas[0].config?.responseJsonSchema), /"(?:minimum|maximum|maxItems)":/);
  assert.match(String(gemini.llamadas[0].config?.systemInstruction), /No inventes/);
});

test("PDF e imágenes se envían intactos por inlineData con MIME correcto", async () => {
  for (const [extension, mime] of Object.entries({ pdf: "application/pdf", jpg: "image/jpeg", png: "image/png", webp: "image/webp" })) {
    const gemini = simular();
    const contenido = Buffer.from([1, 2, 3]);
    const resultado = await extraerDocumento({ ...entrada(), extension, contenido }, gemini.conectar);
    const solicitud = JSON.stringify(gemini.llamadas[0]);
    assert.ok(solicitud.includes(mime));
    assert.ok(solicitud.includes(contenido.toString("base64")));
    assert.equal(resultado.validacion.valido, true);
  }
});

test("rechaza formato, UTF-8 y tamaños inválidos sin llamadas ni truncamiento", async () => {
  const gemini = simular();
  for (const [extension, contenido, status] of [
    ["tiff", Buffer.from([1]), 415], ["pdf", Buffer.alloc(14 * 1024 * 1024 + 1), 413],
    ["json", Buffer.from(JSON.stringify({ tipo_archivo: "TEXTO", documento_texto: "a".repeat(50_001) })), 413],
    ["json", Buffer.from([0xff]), 422], ["json", Buffer.from("{"), 422], ["pdf", Buffer.alloc(0), 422],
  ] as const) await assert.rejects(extraerDocumento({ ...entrada(), extension, contenido }, gemini.conectar), { status });
  assert.equal(gemini.llamadas.length, 0);
});

test("rechaza respuestas inválidas y campos extra sin filtrar datos del modelo", async () => {
  for (const respuesta of ["no-json-SECRETO", {}, { ...datos(), confianza: 2 },
    { ...datos(), paciente: { ...datos().paciente, edad: "45" } },
    { ...datos(), paciente: { ...datos().paciente, evidencia: "texto" } },
    { ...datos(), medicamentos: null },
    { ...datos(), otros_datos: [] },
    { ...datos(), institucion: { ...datos().institucion, publicidad: "texto" } },
    { ...datos(), medicamentos: [{ ...datos().medicamentos[0], evidencia: "texto" }] },
    { ...datos(), validacion: {} }, { ...datos(), secreto: "dato" }]) {
    await assert.rejects(extraerDocumento(entrada(), simular(respuesta).conectar), (error) => {
      assert.equal((error as { status: number }).status, 502);
      assert.doesNotMatch(String(error), /SECRETO|dato"/);
      return true;
    });
  }
  await assert.rejects(extraerDocumento(entrada(), simular(new Error("clave secreta")).conectar), {
    status: 502, message: "No se pudo obtener la extracción del modelo.",
  });
});

test("distingue errores del proveedor sin exponer su respuesta", async () => {
  for (const [status, esperado, mensaje] of [
    [400, 502, /compatibilidad del modelo y del esquema/],
    [401, 503, /configuración y el acceso/], [403, 503, /configuración y el acceso/],
    [404, 503, /configuración y el acceso/], [429, 503, /límite de solicitudes o cuota/],
    [500, 502, /No se pudo obtener/],
  ] as const) {
    const errorSDK = Object.assign(new Error("SECRETO DEL PROVEEDOR"), { status });
    await assert.rejects(extraerDocumento(entrada(), simular(errorSDK).conectar), (error) => {
      assert.equal((error as { status: number }).status, esperado);
      assert.match(String(error), mensaje);
      assert.doesNotMatch(String(error), /SECRETO/);
      return true;
    });
  }
});

test("conserva datos ausentes sin evaluar consistencia clínica", async () => {
  const d = vacio();
  const resultado = await extraerDocumento(entrada(), simular(d).conectar);
  assert.deepEqual(resultado.datos_extraidos, d);
  assert.deepEqual(Object.keys(resultado).sort(), ["confianza_documento", "datos_extraidos", "decision_enrutamiento", "evaluacion_confianza", "prioridad_urgencia", "suficiencia_clinica", "validacion"]);
  assert.equal(resultado.confianza_documento.score, null);
});

test("confianza: calcula factores sin penalizar null y aplica límites por contradicción", () => {
  const d = datos();
  const e = evaluacion(d);
  assert.equal(calcularConfianza(d, e).score, 1);
  e.unidades_ilegibles = 5;
  e.omisiones = [{ seccion: "medicamentos", cantidad: 2 }];
  const r = calcularConfianza(d, e);
  const n = e.campos.length;
  assert.equal(r.factores.legibilidad, 0.8);
  assert.equal(r.factores.cobertura, Math.round(n / (n + 2) * 10000) / 10000);
  assert.equal(r.score, Math.round((0.2 * 0.8 + 0.4 + 0.25 * n / (n + 2) + 0.15) * 10000) / 10000);
  assert.equal(r.requiere_revision_humana, true);
  e.campos[0].estado = "contradictorio";
  assert.ok(calcularConfianza(d, e).score! <= 0.59);
  e.campos[0].estado = "no_respaldado";
  assert.ok(calcularConfianza(d, e).score! < r.score!);
  e.campos[0].estado = "no_verificable";
  assert.equal(calcularConfianza(d, e).requiere_revision_humana, true);
});

test("confianza: evaluación incompleta, duplicada o inválida no produce un score", () => {
  const d = datos();
  const e = evaluacion(d);
  for (const entrada of [{}, { ...e, campos: e.campos.slice(1) },
    { ...e, campos: e.campos.map(() => e.campos[0]) }, { ...e, unidades_legibles: -1 },
    { ...e, unidades_legibles: 0, unidades_ilegibles: 0 },
    { ...e, omisiones: [{ seccion: "SECRETO", cantidad: 1 }] }]) {
    const r = calcularConfianza(d, entrada);
    assert.equal(r.score, null);
    assert.equal(r.requiere_revision_humana, true);
    assert.doesNotMatch(JSON.stringify(r), /SECRETO/);
  }
  assert.equal(calcularConfianza(vacio(), evaluacion(vacio())).score, null);
});

test("confianza: falla cerrada sin exponer SDK y no se llama si el JSON extraído es inválido", async () => {
  const d = datos();
  const r = await evaluarConfianza(d, [{ text: "Documento sintético" }], {
    modelo: "prueba", generar: async () => { throw new Error("SECRETO"); },
  });
  assert.equal(r.score, null);
  assert.doesNotMatch(JSON.stringify(r), /SECRETO/);
  const gemini = simular({});
  await assert.rejects(extraerDocumento(entrada(), gemini.conectar));
  assert.equal(gemini.llamadas.length, 1);
});

test("JSON Schema detecta tipos, campos faltantes, extras y textos vacíos sin modificar los datos", () => {
  const pruebas: Array<[unknown, string, string]> = [
    [{ ...datos(), paciente: { ...datos().paciente, edad: "45" } }, "/paciente/edad", "type"],
    [{ ...datos(), paciente: { ...datos().paciente, edad: -1 } }, "/paciente/edad", "minimum"],
    [{ ...datos(), paciente: { ...datos().paciente, edad: Infinity } }, "/paciente/edad", "type"],
    [{ ...datos(), paciente: { ...datos().paciente, nombre: "   " } }, "/paciente/nombre", "pattern"],
    [{ ...datos(), paciente: { ...datos().paciente, nombre: "" } }, "/paciente/nombre", "minLength"],
    [{ ...datos(), urgencia: { declarada: "false", descripcion: null } }, "/urgencia/declarada", "type"],
    [{ ...datos(), medicamentos: {} }, "/medicamentos", "type"],
    [{ ...datos(), medicamentos: [{ ...datos().medicamentos[0], dosis: 1 }] }, "/medicamentos/0/dosis", "type"],
    [{ ...datos(), institucion: { nombre: null } }, "/institucion/telefono", "required"],
    [{ ...datos(), paciente: { ...datos().paciente, SECRETO: "valor privado" } }, "/paciente", "additionalProperties"],
    [[], "/", "type"], [null, "/", "type"],
  ];
  for (const [entrada, ruta, regla] of pruebas) {
    const original = structuredClone(entrada);
    const resultado = validarDatosClinicos(entrada);
    assert.equal(resultado.valido, false);
    assert.ok(resultado.errores.some(e => e.ruta === ruta && e.regla === regla));
    assert.deepEqual(entrada, original, "no convierte tipos ni elimina valores inválidos");
    assert.doesNotMatch(JSON.stringify(resultado), /SECRETO|valor privado/);
  }
  const conEspacios = datos();
  conEspacios.paciente.nombre = "  Nombre literal  ";
  assert.equal(validarDatosClinicos(conEspacios).valido, true);
  assert.equal(conEspacios.paciente.nombre, "  Nombre literal  ");
  assert.equal(validarDatosClinicos(vacio()).valido, true);
  assert.equal(validarDatosClinicos({}).total_errores > 1, true);
});

test("la interfaz muestra validación válida o errores del esquema sin datos inválidos", async () => {
  const extraccion = await extraerDocumento(entrada(), simular().conectar);
  const htmlValido = renderToStaticMarkup(createElement(VistaResultado, {
    resultado: { ok: true, body: {}, extraccion: { ok: true, body: extraccion } },
  }));
  assert.match(htmlValido, /JSON válido según el esquema/);
  const validacion = validarDatosClinicos({ ...datos(), paciente: { ...datos().paciente, edad: "SECRETO" } });
  const htmlInvalido = renderToStaticMarkup(createElement(VistaResultado, {
    resultado: { ok: true, body: {}, extraccion: { ok: false, body: { validacion } } },
  }));
  assert.match(htmlInvalido, /JSON inválido según el esquema/);
  assert.match(htmlInvalido, /\/paciente\/edad/);
  assert.doesNotMatch(htmlInvalido, /SECRETO/);
});

test("la interfaz presenta clasificación antes de extracción, sin enrutamiento", () => {
  const resultado = { ok: true, body: { nombre_original: "prueba.pdf", canal_origen: "Farmacia",
    recibido_en: "2026-10-18T22:00:00.000Z", almacenamiento: "deshabilitado" },
    clasificacion: { ok: true, body: { categoria: "RECETA_MEDICA", confianza: 0.95, justificacion: "Receta de prueba" } },
    extraccion: { ok: true, body: { datos_extraidos: datos() } } };
  assert.equal(veredictoDe(resultado), "ok");
  assert.equal(veredictoDe({ ok: true, body: {} }), null);
  assert.equal(veredictoDe({ ...resultado, extraccion: { ok: false, body: {} } }), "error");
  const html = renderToStaticMarkup(createElement(VistaResultado, { resultado }));
  const etapas = renderToStaticMarkup(createElement(Etapas, { fase: "listo", resultado }));
  assert.match(html, /Extracción completada/);
  for (const valor of ["prueba.pdf", "Farmacia", "2026-10-18T22:00:00.000Z", "Sin guardar en OCI"]) {
    assert.ok(html.includes(valor));
  }
  assert.match(etapas, /Ingesta/);
  assert.match(etapas, /Extracción/);
  assert.ok(etapas.indexOf("Clasificación") < etapas.indexOf("Extracción"));
  assert.match(html, /Receta de prueba/);
  assert.equal(veredictoDe({ ...resultado, clasificacion: { ok: false, body: {} } }), "error");
  assert.doesNotMatch(html + etapas, /Enrutamiento|enrutamiento|Destino|Documento enrutado/);
});
test("conserva y muestra datos clínicos e institución sin campos genéricos", async () => {
  const d = datos();
  d.resultados_laboratorio = ["2026-10-01", "2026-10-02"].map(fecha => ({
    prueba: "Analito de prueba", resultado: "4.5", unidad: "mg/dL", rango_referencia: "3–6",
    indicador: "Normal", muestra: "Suero", fecha,
  }));
  d.diagnosticos = [{ descripcion: "Hallazgo descartado", cie10: null, estado: "Descartado", tipo: null }];
  d.estudios = [{ nombre: "Estudio de prueba", estado: "Solicitado", fecha: null,
    region_anatomica: null, tecnica: null, hallazgos: null, conclusion: null }];
  d.indicaciones = ["Reposo por 4 días"];
  d.evolucion_clinica = "Detalle narrativo. ".repeat(100).trim();
  d.institucion = { nombre: "Centro de prueba", telefono: "555-0100", direccion: "Calle de prueba 123",
    correo_electronico: "contacto@example.test", sitio_web: "https://example.test" };
  const respuesta = await extraerDocumento(entrada(), simular(d).conectar);
  assert.deepEqual(respuesta.datos_extraidos, d);
  const html = renderToStaticMarkup(createElement(ExtraccionClinica, { datos: respuesta }));
  for (const valor of ["4.5", "mg/dL", "3–6", "2026-10-01", "2026-10-02", "Descartado",
    "Solicitado", "Reposo por 4 días", ...Object.values(d.institucion) as string[], d.evolucion_clinica]) {
    assert.ok(html.includes(valor), `La interfaz debe mostrar ${valor.slice(0, 30)}`);
  }
  assert.doesNotMatch(JSON.stringify(respuesta.datos_extraidos), /"(?:otros_datos|evidencia|validacion|confianza|requiere_revision_humana)":/);
});
test("API extrae JSON/texto y archivos directamente sin leer ni escribir OCI", async (t) => {
  const id = "DOC-CLIN-2026-ABC123";
  const variables = ["OCI_NAMESPACE", "GEMINI_API_KEY", "GEMINI_MODEL"];
  const anteriores = variables.map(v => process.env[v]);
  delete process.env.OCI_NAMESPACE;
  Object.assign(process.env, { GEMINI_API_KEY: "prueba", GEMINI_MODEL: "prueba" });
  const get = t.mock.method(ObjectStorageClient.prototype, "getObject", async () => { throw new Error("No leer OCI"); });
  const put = t.mock.method(ObjectStorageClient.prototype, "putObject", async () => { throw new Error("No escribir OCI"); });
  let invalido = false;
  const llamadas: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.match(String(url), /generativelanguage.googleapis.com/);
    llamadas.push(String(init?.body));
    const esEvaluacion = String(init?.body).includes("Coteja una extracción");
    const esSuficiencia = String(init?.body).includes("Revisa suficiencia documental");
    const esPrioridad = String(init?.body).includes("Evalúa la prioridad documental");
    const salida = esSuficiencia ? { observaciones: [] } : esPrioridad ? { nivel: "NORMAL", justificacion: "Seguimiento documentado." } : esEvaluacion ? evaluacion() : datos();
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: invalido ? "{}" : JSON.stringify(salida) }] }, finishReason: "STOP" }] });
  });
  const solicitar = (body: unknown) => POST(new Request("http://localhost/api/ingest/extract", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }));
  const payload = { documento_id: id, tipo_archivo: "TEXTO", documento_texto: fuente };
  try {
    for (const body of [payload, { ...payload, tipo_archivo: "JSON", documento_texto: '{"dato": "sintético"}' }]) {
      const r = await solicitar(body);
      assert.equal(r.status, 200);
      const result = await r.json();
      assert.equal(result.documento_id, id);
      assert.deepEqual(result.datos_extraidos, datos());
      assert.equal(result.validacion.valido, true);
      assert.equal(result.confianza_documento.estado, "evaluado");
      assert.equal(result.decision_enrutamiento.destino_principal, "Ruta_Normal");
      assert.equal(result.prioridad_urgencia.nivel, "NORMAL");
      assert.equal("resultado_oci" in result, false);
    }
    assert.ok(llamadas[0].includes(fuente));
    for (const [nombre, bytes, mime] of [["prueba.pdf", Buffer.from("%PDF-1.7\n"), "application/pdf"],
      ["prueba.jpg", Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg"],
      ["prueba.json", Buffer.from('{"dato":1}'), "application/json"]] as const) {
      const form = new FormData();
      form.set("documento_id", id);
      form.set("archivo", new File([bytes], nombre, { type: mime }));
      const r = await POST(new Request("http://localhost/api/ingest/extract", { method: "POST", body: form }));
      assert.equal(r.status, 200);
      if (mime !== "application/json") assert.ok(llamadas.at(-3)?.includes(bytes.toString("base64")));
    }
    const antes = llamadas.length;
    assert.equal((await solicitar({ documento_id: id, ruta_objeto: "recibidos/antiguo.json" })).status, 422);
    assert.equal((await solicitar({ ...payload, documento_id: "../x" })).status, 422);
    assert.equal((await solicitar({ ...payload, tipo_archivo: "JSON" })).status, 422);
    assert.equal((await solicitar("{")).status, 400);
    const form = new FormData();
    form.set("documento_id", id);
    form.set("archivo", new File(["no es PDF"], "prueba.pdf", { type: "application/pdf" }));
    assert.equal((await POST(new Request("http://localhost/api/ingest/extract", { method: "POST", body: form }))).status, 415);
    assert.equal(llamadas.length, antes);
    invalido = true;
    const fallo = await solicitar(payload);
    assert.equal(fallo.status, 200);
    const rechazado = await fallo.json();
    assert.equal(rechazado.validacion.valido, false);
    assert.ok(rechazado.validacion.errores.length > 0);
    assert.equal("datos_extraidos" in rechazado, false);
    assert.equal(rechazado.status, "revision_humana");
    assert.equal(rechazado.documento_id, id);
    assert.equal(rechazado.decision_enrutamiento.destino_principal, "Cola_Auditoria_Humana");
    assert.equal(rechazado.decision_enrutamiento.requiere_auditoria_humana, true);
    assert.equal(rechazado.evaluacion_confianza.estado, "omitida");
    assert.equal(rechazado.evaluacion_confianza.score, null);
    assert.equal(rechazado.prioridad_urgencia.estado, "omitida");
    assert.equal(llamadas.length, antes + 1, "No ejecuta cotejo ni prioridad tras fallar JSON Schema");
    const htmlRevision = renderToStaticMarkup(createElement(VistaResultado, {
      resultado: { ok: true, body: {}, extraccion: { ok: true, body: rechazado } },
    }));
    assert.match(htmlRevision, /Revisión humana requerida/);
    assert.match(htmlRevision, /JSON inválido según el esquema/);
    assert.match(htmlRevision, /Cola Auditoria Humana/);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(put.mock.callCount(), 0);
  } finally {
    variables.forEach((v, i) => { if (anteriores[i] === undefined) delete process.env[v]; else process.env[v] = anteriores[i]; });
  }
});


test("diagnóstico: distingue fallos del proveedor sin exponer mensajes ni datos", async () => {
  for (const [status, codigo] of [[429, "EVALUACION_LIMITE_O_CUOTA"], [403, "EVALUACION_ACCESO_DENEGADO"],
    [401, "EVALUACION_ACCESO_DENEGADO"], [404, "EVALUACION_MODELO_NO_ENCONTRADO"],
    [400, "EVALUACION_SOLICITUD_RECHAZADA"], [503, "EVALUACION_SERVICIO_NO_DISPONIBLE"],
    [500, "EVALUACION_SERVICIO_NO_DISPONIBLE"], [504, "EVALUACION_TIEMPO_AGOTADO"]] as const) {
    const r = await evaluarConfianza(datos(), [], { modelo: "prueba", generar: async () => {
      throw Object.assign(new Error("SECRETO_CLINICO"), { status, body: "SECRETO_CLINICO" });
    } });
    assert.equal(r.score, null);
    assert.equal(r.diagnostico?.codigo, codigo);
    assert.equal(r.diagnostico?.http_status, status);
    assert.equal(r.diagnostico?.etapa, "proveedor");
    assert.equal(r.requiere_revision_humana, true);
    assert.doesNotMatch(JSON.stringify(r), /SECRETO_CLINICO/);
  }
  for (const name of ["TimeoutError", "AbortError", "Error"]) {
    const r = await evaluarConfianza(datos(), [], { modelo: "prueba", generar: async () => {
      throw Object.assign(new Error("SECRETO"), { name });
    } });
    assert.equal(r.diagnostico?.codigo, name === "Error" ? "EVALUACION_NO_DISPONIBLE" : "EVALUACION_TIEMPO_AGOTADO");
    assert.equal(r.diagnostico?.http_status, undefined);
  }
});

test("diagnóstico: separa respuesta vacía, JSON inválido y esquema inválido", async () => {
  for (const [text, codigo] of [[undefined, "EVALUACION_RESPUESTA_VACIA"], ["   ", "EVALUACION_RESPUESTA_VACIA"],
    ["{SECRETO", "EVALUACION_JSON_INVALIDO"], ['{"SECRETO":true}', "EVALUACION_INVALIDA"]] as const) {
    const r = await evaluarConfianza(datos(), [], { modelo: "prueba", generar: async () => ({ text }) });
    assert.equal(r.diagnostico?.codigo, codigo);
    assert.equal(r.score, null);
    assert.doesNotMatch(JSON.stringify(r), /SECRETO/);
  }
});

test("diagnóstico: cuenta faltantes, duplicados y desconocidos sin devolver rutas del modelo", () => {
  const e = evaluacion();
  const original = structuredClone(e);
  e.campos = [...e.campos.slice(1), e.campos[1], { ruta: "/SECRETO", estado: "respaldado" }];
  e.omisiones = [{ seccion: "SECRETO", cantidad: 1 }, { seccion: "SECRETO", cantidad: 2 }];
  const r = calcularConfianza(datos(), e);
  assert.deepEqual(r.diagnostico?.conteos, {
    campos_esperados: original.campos.length, campos_recibidos: original.campos.length + 1,
    campos_faltantes: 1, campos_duplicados: 1, campos_desconocidos: 1,
    secciones_omision_desconocidas: 2, secciones_omision_duplicadas: 1,
  });
  assert.doesNotMatch(JSON.stringify(r), /SECRETO/);
  assert.equal(calcularConfianza(datos(), original).diagnostico, undefined);
  assert.equal(calcularConfianza(datos(), original).score, 1);
});

test("diagnóstico: conserva extracción y propaga causa a auditoría y a la interfaz", async () => {
  const resultado = await extraerDocumento(entrada(), () => ({ modelo: "prueba", async generar(params) {
    if (params.config?.systemInstruction === PROMPT_SUFICIENCIA) return { text: JSON.stringify({ observaciones: [] }) };
    if (params.config?.systemInstruction === PROMPT_EVALUACION) throw Object.assign(new Error("SECRETO"), { status: 429 });
    assert.notEqual(params.config?.systemInstruction, PROMPT_PRIORIDAD);
    return { text: JSON.stringify(datos()) };
  } }));
  assert.deepEqual(resultado.datos_extraidos, datos());
  assert.equal(resultado.confianza_documento.score, null);
  assert.match(resultado.decision_enrutamiento.justificacion_enrutamiento, /límite de solicitudes o cuota/);
  assert.equal(resultado.decision_enrutamiento.destino_principal, "Cola_Auditoria_Humana");
  const html = renderToStaticMarkup(createElement(VistaResultado, {
    resultado: { ok: true, body: {}, extraccion: { ok: true, body: resultado } },
  }));
  assert.match(html, /No se pudo calcular el score de confianza/);
  assert.match(html, /HTTP 429/);
  assert.doesNotMatch(html, /SECRETO/);
});

test("omisiones: conserva campo, cantidad y página y explica auditoría con score alto", async () => {
  const e = evaluacion();
  e.omisiones = [{ seccion: "medicamentos", cantidad: 1, detalles: [{ campo: "/medicamentos/*/concentracion", cantidad: 1, pagina: 2 }] }];
  const r = calcularConfianza(datos(), e);
  assert.ok(r.score! > 0.85);
  assert.deepEqual(r.omisiones, e.omisiones);
  const decision = await decidirEnrutamiento(datos(), r, { modelo: "prueba", generar: async () => { throw new Error("No llamar"); } });
  assert.match(decision.decision_enrutamiento.justificacion_enrutamiento, /concentracion/);
  assert.match(decision.decision_enrutamiento.justificacion_enrutamiento, /Página 2/);
  const html = renderToStaticMarkup(createElement(VistaResultado, { resultado: { ok: true, body: {}, extraccion: { ok: true, body: { confianza_documento: r, ...decision } } } }));
  assert.match(html, /Observaciones reportadas por el evaluador/);
  assert.match(html, /concentracion/);
  assert.match(html, /No evaluada por observaciones previas/);
});

test("omisiones: rechaza detalles fuera del contrato, de otra sección o con conteos inconsistentes", () => {
  const e = evaluacion();
  for (const detalles of [
    [{ campo: "/SECRETO", cantidad: 1, pagina: 1 }],
    [{ campo: "/paciente/nombre", cantidad: 1, pagina: 1 }],
    [{ campo: "/medicamentos/*/dosis", cantidad: 2, pagina: 1 }],
    [{ campo: "/medicamentos/*/dosis", cantidad: 1, pagina: 0 }],
  ]) {
    const r = calcularConfianza(datos(), { ...e, omisiones: [{ seccion: "medicamentos", cantidad: 1, detalles }] });
    assert.equal(r.score, null);
    assert.doesNotMatch(JSON.stringify(r), /SECRETO/);
  }
});

test("observaciones: mantiene compatibilidad con omisiones sin detalle y explica campo contradictorio", () => {
  const e = evaluacion();
  e.omisiones = [{ seccion: "medicamentos", cantidad: 1 }];
  e.campos[0] = { ...e.campos[0], estado: "contradictorio", causa: "atribucion_incorrecta", pagina: 1 };
  const r = calcularConfianza(datos(), e);
  assert.equal(r.estado, "evaluado");
  assert.deepEqual(r.campos_observados[0], e.campos[0]);
  const html = renderToStaticMarkup(createElement(VistaResultado, { resultado: { ok: true, body: {}, extraccion: { ok: true, body: { confianza_documento: r } } } }));
  assert.match(html, /no identificó los campos concretos/);
  assert.match(html, /se atribuyó incorrectamente/);
  assert.match(html, /Página 1/);
});

test("suficiencia: detecta identificación ausente y medicamento sin nombre sin modificar datos", async () => {
  const d = datos(); d.paciente.nombre = null; d.paciente.identificacion = null; d.profesionales = []; d.medicamentos[0].nombre = null;
  const original = structuredClone(d);
  const r = await evaluarSuficiencia(d, [], { modelo: "prueba", generar: async () => ({ text: '{"observaciones":[]}' }) }, "RECETA_MEDICA");
  assert.equal(r.estado, "requiere_revision");
  assert.deepEqual(r.hallazgos.map(h => h.codigo).sort(), ["IDENTIFICACION_PACIENTE_AUSENTE", "MEDICAMENTO_SIN_NOMBRE", "PROFESIONAL_NO_IDENTIFICADO"].sort());
  assert.deepEqual(d, original);
});

test("suficiencia: ambigüedad y contexto faltante derivan a auditoría con confianza alta", async () => {
  const r = await evaluarSuficiencia(datos(), [], { modelo: "prueba", generar: async () => ({ text: JSON.stringify({ observaciones: [
    { ruta: "/medicamentos/0/nombre", codigo: "MEDICAMENTO_AMBIGUO" },
    { ruta: "/contexto_paciente/peso", codigo: "CONTEXTO_PACIENTE_INSUFICIENTE" },
  ] }) }) });
  let llamadas = 0;
  const decision = await decidirEnrutamiento(datos(), calcularConfianza(datos(), evaluacion()), { modelo: "prueba", generar: async () => { llamadas++; return {}; } }, r);
  assert.equal(llamadas, 0);
  assert.equal(decision.prioridad_urgencia.estado, "omitida");
  assert.equal(decision.decision_enrutamiento.requiere_auditoria_humana, true);
  assert.match(decision.decision_enrutamiento.justificacion_enrutamiento, /medicamentos\/0\/nombre/);
  const html = renderToStaticMarkup(createElement(VistaResultado, { resultado: { ok: true, body: {}, extraccion: { ok: true, body: { suficiencia_clinica: r, ...decision } } } }));
  assert.match(html, /Suficiencia clínica y ambigüedades/);
  assert.match(html, /no identificable/);
  assert.match(html, /peso/);
});

test("suficiencia: fallo o respuesta inválida nunca aprueba y no filtra contenido", async () => {
  for (const salida of ["{SECRETO", '{"observaciones":[{"ruta":"/SECRETO","codigo":"MEDICAMENTO_AMBIGUO"}]}', '{"observaciones":[{"ruta":"/paciente","codigo":"INVENTADO"}]}', new Error("SECRETO")]) {
    const r = await evaluarSuficiencia(datos(), [], { modelo: "prueba", generar: async () => { if (salida instanceof Error) throw salida; return { text: salida }; } });
    assert.equal(r.estado, "no_evaluable"); assert.equal(r.requiere_revision_humana, true);
    assert.doesNotMatch(JSON.stringify(r), /SECRETO|INVENTADO/);
  }
});

test("suficiencia: no exige pauta en antecedentes ni certifica un medicamento sin catálogo", async () => {
  const d = datos(); d.medicamentos[0].estado = "Suspendido"; d.medicamentos[0].dosis = null; d.medicamentos[0].frecuencia = null;
  const r = await evaluarSuficiencia(d, [], { modelo: "prueba", generar: async () => ({ text: '{"observaciones":[]}' }) }, "HISTORIA_CLINICA");
  assert.equal(r.estado, "sin_hallazgos");
  assert.equal(r.certifica_correccion_medica, false);
  assert.equal(r.catalogo_farmacologico, "no_disponible");
});

test("suficiencia: etiquetas numeradas generan hallazgo local específico sin duplicar ambigüedad", async () => {
  for (const nombre of ["Medicamento 1", "Medicamento 2", " MEDICAMENTO   12 ", "Medicamento #3", "Medicamento N.º 4"]) {
    const d = datos(); d.medicamentos[0].nombre = nombre;
    const r = await evaluarSuficiencia(d, [], { modelo: "prueba", generar: async () => ({ text: JSON.stringify({ observaciones: [
      { ruta: "/medicamentos/0/nombre", codigo: "MEDICAMENTO_AMBIGUO" },
      { ruta: "/medicamentos/0/via", codigo: "PAUTA_INCOMPLETA" },
    ] }) }) });
    const h = r.hallazgos.filter(h => h.ruta === "/medicamentos/0/nombre");
    assert.equal(h.length, 1);
    assert.equal(h[0].codigo, "MEDICAMENTO_ETIQUETA_GENERICA");
    assert.equal(h[0].origen, "regla");
    assert.ok(h[0].mensaje.includes(`“${nombre.trim().replace(/\s+/g, " ")}”`));
    assert.equal(r.hallazgos.length, 2);
    assert.equal(r.requiere_revision_humana, true);
    assert.equal(d.medicamentos[0].nombre, nombre);
    const decision = await decidirEnrutamiento(d, calcularConfianza(d, evaluacion(d)), { modelo: "prueba", generar: async () => { throw new Error("No evaluar prioridad"); } }, r);
    assert.match(decision.decision_enrutamiento.justificacion_enrutamiento, /etiqueta genérica/);
  }
});

test("suficiencia: etiqueta detectada aunque Gemini no observe nada o falle; no confunde nombres con dosis", async () => {
  const d = datos(); d.medicamentos[0].nombre = "Medicamento 1";
  for (const falla of [false, true]) {
    const r = await evaluarSuficiencia(d, [], { modelo: "prueba", generar: async () => { if (falla) throw new Error("SECRETO"); return { text: '{"observaciones":[]}' }; } });
    assert.equal(r.hallazgos[0].codigo, "MEDICAMENTO_ETIQUETA_GENERICA");
    assert.equal(r.requiere_revision_humana, true);
    assert.doesNotMatch(JSON.stringify(r), /SECRETO/);
  }
  for (const nombre of ["Paracetamol 500 mg", "Vitamina B12", "Medicamento 1 mg", "Medicamento 1 adicional"]) {
    d.medicamentos[0].nombre = nombre;
    const r = await evaluarSuficiencia(d, [], { modelo: "prueba", generar: async () => ({ text: '{"observaciones":[]}' }) });
    assert.equal(r.hallazgos.some(h => h.codigo === "MEDICAMENTO_ETIQUETA_GENERICA"), false);
  }
});
