import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import type { GenerateContentParameters } from "@google/genai";
import { ObjectStorageClient, type requests, type responses } from "oci-objectstorage";
import {
  CATEGORIAS_DOCUMENTO,
  clasificarDocumento,
  ErrorClasificacion,
  MAX_BYTES_INLINE,
  obtenerConexionGemini,
  type ConexionGemini,
} from "../lib/clasificacion";
import {
  analizarRutaRecibido,
  ErrorAlmacenamiento,
  leerDocumentoRecibido,
  persistirResultadoProcesado,
} from "../lib/storage";
import { POST as clasificar } from "../app/api/ingest/classify/route";

const id = "DOC-CLIN-2026-1U0FNJ";
const rutaPdf = `recibidos/2026/09/${id}/${id}.pdf`;
const pdf = Buffer.from("%PDF-1.7\nReceta sintética\n");

function respuestaModelo(extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    categoria: "RECETA_MEDICA",
    confianza: 0.93,
    justificacion: "Contiene prescripción de medicamentos con dosis.",
    ...extra,
  });
}

function simularGemini(texto: string | undefined | Error) {
  const llamadas: GenerateContentParameters[] = [];
  const conectar = (): ConexionGemini => ({
    modelo: "modelo-prueba",
    async generar(params) {
      llamadas.push(params);
      if (texto instanceof Error) throw texto;
      return { text: texto };
    },
  });
  return { llamadas, conectar };
}

test("clasifica un PDF enviándolo inline a Gemini con salida estructurada", async () => {
  const gemini = simularGemini(respuestaModelo());
  const resultado = await clasificarDocumento({ contenido: pdf, extension: "pdf" }, gemini.conectar);

  assert.deepEqual(resultado, {
    categoria: "RECETA_MEDICA",
    confianza: 0.93,
    justificacion: "Contiene prescripción de medicamentos con dosis.",
  });

  assert.equal(gemini.llamadas.length, 1);
  const llamada = gemini.llamadas[0];
  assert.equal(llamada.model, "modelo-prueba");
  assert.equal(llamada.config?.responseMimeType, "application/json");
  for (const categoria of CATEGORIAS_DOCUMENTO) {
    assert.match(String(llamada.config?.systemInstruction), new RegExp(categoria));
  }
  const contenidos = llamada.contents as { role: string; parts: Record<string, unknown>[] }[];
  const inline = contenidos[0].parts.find((p) => "inlineData" in p)?.inlineData as {
    mimeType: string;
    data: string;
  };
  assert.equal(inline.mimeType, "application/pdf");
  assert.deepEqual(Buffer.from(inline.data, "base64"), pdf);
});

test("usa el MIME correcto para cada imagen admitida", async () => {
  for (const [extension, mime] of [["jpg", "image/jpeg"], ["png", "image/png"], ["webp", "image/webp"]]) {
    const gemini = simularGemini(respuestaModelo());
    await clasificarDocumento({ contenido: Buffer.from([1, 2, 3]), extension }, gemini.conectar);
    const partes = (gemini.llamadas[0].contents as { parts: { inlineData?: { mimeType: string } }[] }[])[0].parts;
    assert.equal(partes.find((p) => p.inlineData)?.inlineData?.mimeType, mime);
  }
});

test("clasificación omite modelo y decisiones de revisión incluso con confianza baja u OTRO", async () => {
  for (const extra of [
    { confianza: 0.69 },
    { confianza: 0.7 },
    { categoria: "OTRO", confianza: 0.99 },
  ] as const) {
    const gemini = simularGemini(respuestaModelo(extra));
    const resultado = await clasificarDocumento({ contenido: pdf, extension: "pdf" }, gemini.conectar);
    assert.equal("requiere_revision_humana" in resultado, false);
    assert.equal("modelo" in resultado, false);
  }
});

test("envía JSON/texto como texto delimitado, sin datos binarios", async () => {
  const gemini = simularGemini(respuestaModelo({ categoria: "RESULTADO_LABORATORIO" }));
  const original = '{"tipo_archivo":"TEXTO","documento_texto":"Hemoglobina 13 g/dL áé"}';
  const resultado = await clasificarDocumento(
    { contenido: Buffer.from(original), extension: "json" },
    gemini.conectar,
  );
  assert.equal(resultado.categoria, "RESULTADO_LABORATORIO");
  const partes = (gemini.llamadas[0].contents as { parts: { text?: string; inlineData?: unknown }[] }[])[0].parts;
  assert.equal(partes.some((p) => p.inlineData), false);
  assert.equal(partes[1].text, `<documento>\n${original}\n</documento>`);
});

test("rechaza TIFF y archivos demasiado grandes sin llamar a Gemini", async () => {
  const gemini = simularGemini(respuestaModelo());
  await assert.rejects(
    clasificarDocumento({ contenido: Buffer.from([0x49, 0x49, 0x2a, 0x00]), extension: "tiff" }, gemini.conectar),
    { status: 415 },
  );
  await assert.rejects(
    clasificarDocumento({ contenido: Buffer.alloc(MAX_BYTES_INLINE + 1), extension: "pdf" }, gemini.conectar),
    { status: 413 },
  );
  await assert.rejects(
    clasificarDocumento({ contenido: Buffer.from([0xff, 0xfe]), extension: "json" }, gemini.conectar),
    { status: 422 },
  );
  assert.equal(gemini.llamadas.length, 0);
});

test("respuestas inválidas del modelo devuelven 502 sin exponer su contenido", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const texto of [
    undefined,
    "",
    "no es json",
    respuestaModelo({ categoria: "CATEGORIA_INVENTADA" }),
    respuestaModelo({ confianza: 1.5 }),
    respuestaModelo({ justificacion: "" }),
    JSON.stringify({ categoria: "OTRO" }),
  ]) {
    const gemini = simularGemini(texto);
    await assert.rejects(clasificarDocumento({ contenido: pdf, extension: "pdf" }, gemini.conectar), (error) => {
      assert.ok(error instanceof ErrorClasificacion);
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /CATEGORIA_INVENTADA|no es json/);
      return true;
    });
  }
});

test("un fallo de la llamada a Gemini no filtra secretos del SDK", async (t) => {
  t.mock.method(console, "error", () => {});
  const gemini = simularGemini(new Error("API key AIzaSecreta inválida"));
  await assert.rejects(clasificarDocumento({ contenido: pdf, extension: "pdf" }, gemini.conectar), (error) => {
    assert.ok(error instanceof ErrorClasificacion);
    assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /AIzaSecreta/);
    return true;
  });
});

test("sin GEMINI_API_KEY la configuración devuelve 503", () => {
  const anterior = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.throws(obtenerConexionGemini, { status: 503 });
  } finally {
    if (anterior !== undefined) process.env.GEMINI_API_KEY = anterior;
  }
});

test("solo acepta la ruta del original del mismo documento_id", () => {
  assert.deepEqual(analizarRutaRecibido(id, rutaPdf), { anio: "2026", mes: "09", extension: "pdf" });
  for (const ruta of [
    `recibidos/2026/09/${id}/${id}.metadata.json`,
    `procesados/2026/09/${id}/${id}.pdf`,
    `recibidos/2026/09/${id}/../OTRO/${id}.pdf`,
    `recibidos/2026/09/DOC-CLIN-2026-AAAAAA/DOC-CLIN-2026-AAAAAA.pdf`,
    `recibidos/2026/09/${id}/DOC-CLIN-2026-AAAAAA.pdf`,
    `recibidos/2026/09/${id}/${id}.exe`,
    `/recibidos/2026/09/${id}/${id}.pdf`,
  ]) {
    assert.throws(() => analizarRutaRecibido(id, ruta), { status: 422 }, ruta);
  }
});

function simularLectura(comportamiento: "ok" | "404" | "500" | "grande" | "flujo-grande") {
  const lecturas: requests.GetObjectRequest[] = [];
  const cliente: Pick<ObjectStorageClient, "getObject"> = {
    async getObject(request) {
      lecturas.push(request);
      if (comportamiento === "404") throw Object.assign(new Error("secreto"), { statusCode: 404 });
      if (comportamiento === "500") throw Object.assign(new Error("secreto"), { statusCode: 500 });
      const cuerpo = comportamiento === "flujo-grande" ? Buffer.alloc(20) : pdf;
      return {
        contentLength: comportamiento === "grande" ? 1_000 : cuerpo.byteLength,
        value: Readable.from([cuerpo.subarray(0, 5), cuerpo.subarray(5)]),
      } as unknown as responses.GetObjectResponse;
    },
  };
  return { lecturas, conectar: () => ({ cliente, namespace: "namespace-prueba" }) };
}

test("lee el original desde el bucket y devuelve sus bytes intactos", async () => {
  const oci = simularLectura("ok");
  const leido = await leerDocumentoRecibido(id, rutaPdf, 1_000, oci.conectar);
  assert.deepEqual(Buffer.from(leido.contenido), pdf);
  assert.equal(leido.extension, "pdf");
  assert.equal(oci.lecturas[0].bucketName, "mediflow-documentos-clinicos");
  assert.equal(oci.lecturas[0].namespaceName, "namespace-prueba");
  assert.equal(oci.lecturas[0].objectName, rutaPdf);
});

test("lectura: ruta ajena no toca OCI; 404, 5xx y exceso de tamaño dan errores controlados", async (t) => {
  t.mock.method(console, "error", () => {});
  const ajena = simularLectura("ok");
  await assert.rejects(leerDocumentoRecibido(id, "recibidos/../secreto.pdf", 1_000, ajena.conectar), { status: 422 });
  assert.equal(ajena.lecturas.length, 0);

  await assert.rejects(leerDocumentoRecibido(id, rutaPdf, 1_000, simularLectura("404").conectar), { status: 404 });
  await assert.rejects(leerDocumentoRecibido(id, rutaPdf, 1_000, simularLectura("500").conectar), (error) => {
    assert.ok(error instanceof ErrorAlmacenamiento);
    assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /secreto/);
    return true;
  });
  await assert.rejects(leerDocumentoRecibido(id, rutaPdf, 100, simularLectura("grande").conectar), { status: 413 });
  await assert.rejects(leerDocumentoRecibido(id, rutaPdf, 10, simularLectura("flujo-grande").conectar), { status: 413 });
});

test("guarda el resultado en procesados/ junto al mismo AAAA/MM, permitiendo reclasificar", async () => {
  const puts: requests.PutObjectRequest[] = [];
  const cliente: Pick<ObjectStorageClient, "putObject"> = {
    async putObject(request) {
      puts.push(request);
      return { eTag: "etag" } as responses.PutObjectResponse;
    },
  };
  const guardado = await persistirResultadoProcesado(
    id,
    { anio: "2026", mes: "09", extension: "pdf" },
    "clasificacion",
    { categoria: "OTRO" },
    () => ({ cliente, namespace: "namespace-prueba" }),
  );
  const esperada = `procesados/2026/09/${id}/${id}.clasificacion.json`;
  assert.deepEqual(guardado, { bucket: "mediflow-documentos-clinicos", ruta_objeto: esperada });
  assert.equal(puts[0].objectName, esperada);
  assert.equal(puts[0].ifNoneMatch, undefined);
  assert.equal(puts[0].contentType, "application/json");
  assert.deepEqual(JSON.parse(Buffer.from(puts[0].putObjectBody as Buffer).toString()), { categoria: "OTRO" });
});

test("clasificación recibe el documento directamente sin OCI", async (t) => {
  const variables = ["OCI_NAMESPACE", "GEMINI_API_KEY", "GEMINI_MODEL"];
  const anteriores = variables.map(v => process.env[v]);
  delete process.env.OCI_NAMESPACE;
  Object.assign(process.env, { GEMINI_API_KEY: "prueba", GEMINI_MODEL: "modelo-prueba" });
  const get = t.mock.method(ObjectStorageClient.prototype, "getObject", async () => { throw new Error("No leer OCI"); });
  const put = t.mock.method(ObjectStorageClient.prototype, "putObject", async () => { throw new Error("No escribir OCI"); });
  let invalido = false;
  const solicitudes: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: unknown, init?: RequestInit) => {
    assert.match(String(url), /generativelanguage.googleapis.com/);
    solicitudes.push(String(init?.body));
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: invalido ? "{}" : respuestaModelo() }] }, finishReason: "STOP" }] });
  });
  const json = (body: unknown) => clasificar(new Request("http://localhost/api/ingest/classify", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" },
  }));
  try {
    for (const [nombre, bytes, mime] of [["prueba.pdf", pdf, "application/pdf"],
      ["prueba.jpg", Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg"],
      ["prueba.json", Buffer.from('{"dato":1}'), "application/json"]] as const) {
      const form = new FormData(); form.set("documento_id", id);
      form.set("archivo", new File([bytes], nombre, { type: mime }));
      const r = await clasificar(new Request("http://localhost/api/ingest/classify", { method: "POST", body: form }));
      assert.equal(r.status, 200);
      const salida = await r.json();
      assert.equal(salida.documento_id, id);
      assert.equal(salida.categoria, "RECETA_MEDICA");
      assert.equal(salida.confianza, 0.93);
      assert.equal("resultado_oci" in salida, false);
      if (mime !== "application/json") assert.ok(solicitudes.at(-1)?.includes(bytes.toString("base64")));
    }
    for (const [tipo_archivo, documento_texto] of [["TEXTO", "Receta sintética"], ["JSON", '{"dato":1}']]) {
      assert.equal((await json({ documento_id: id, tipo_archivo, documento_texto })).status, 200);
    }
    const antes = solicitudes.length;
    assert.equal((await json({ documento_id: id, ruta_objeto: rutaPdf })).status, 422);
    assert.equal((await json("{")).status, 400);
    assert.equal(solicitudes.length, antes);
    invalido = true;
    assert.equal((await json({ documento_id: id, tipo_archivo: "TEXTO", documento_texto: "Prueba" })).status, 502);
    assert.equal(get.mock.callCount(), 0);
    assert.equal(put.mock.callCount(), 0);
  } finally {
    variables.forEach((v, i) => { if (anteriores[i] === undefined) delete process.env[v]; else process.env[v] = anteriores[i]; });
  }
});
