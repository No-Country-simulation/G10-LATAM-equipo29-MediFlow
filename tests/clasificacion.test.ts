import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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
import { POST as clasificar } from "../app/api/classify/route";

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
    requiere_revision_humana: false,
    modelo: "modelo-prueba",
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

test("marca revisión humana con confianza baja o categoría OTRO", async () => {
  for (const [extra, esperado] of [
    [{ confianza: 0.69 }, true],
    [{ confianza: 0.7 }, false],
    [{ categoria: "OTRO", confianza: 0.99 }, true],
  ] as const) {
    const gemini = simularGemini(respuestaModelo(extra));
    const resultado = await clasificarDocumento({ contenido: pdf, extension: "pdf" }, gemini.conectar);
    assert.equal(resultado.requiere_revision_humana, esperado);
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

test("POST /api/classify: lee de OCI, llama a Gemini y guarda el resultado", async (t) => {
  const variables = ["OCI_REGION", "OCI_NAMESPACE", "OCI_AUTH_MODE", "OCI_TENANCY_OCID",
    "OCI_USER_OCID", "OCI_FINGERPRINT", "OCI_PRIVATE_KEY", "OCI_PRIVATE_KEY_PASSPHRASE",
    "GEMINI_API_KEY", "GEMINI_MODEL"];
  const anteriores = variables.map((nombre) => process.env[nombre]);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  Object.assign(process.env, {
    OCI_REGION: "us-phoenix-1", OCI_NAMESPACE: "namespace-prueba", OCI_AUTH_MODE: "api_key",
    OCI_TENANCY_OCID: "ocid1.tenancy.oc1..prueba", OCI_USER_OCID: "ocid1.user.oc1..prueba",
    OCI_FINGERPRINT: "00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00",
    OCI_PRIVATE_KEY: privateKey, OCI_PRIVATE_KEY_PASSPHRASE: "",
    GEMINI_API_KEY: "clave-de-prueba", GEMINI_MODEL: "modelo-de-prueba",
  });

  const lecturas: requests.GetObjectRequest[] = [];
  const puts: requests.PutObjectRequest[] = [];
  let existe = true;
  t.mock.method(ObjectStorageClient.prototype, "getObject", async (request: requests.GetObjectRequest) => {
    lecturas.push(request);
    if (!existe) throw Object.assign(new Error("no existe"), { statusCode: 404 });
    return { contentLength: pdf.byteLength, value: Readable.from([pdf]) };
  });
  t.mock.method(ObjectStorageClient.prototype, "putObject", async (request: requests.PutObjectRequest) => {
    puts.push(request);
    return { eTag: "etag-prueba" };
  });

  const peticionesGemini: { url: string; clave: string | null; cuerpo: any }[] = [];
  const fetchOriginal = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (entrada: unknown, init?: RequestInit) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada);
    assert.match(url, /generativelanguage\.googleapis\.com/, "solo se permite tráfico hacia Gemini");
    peticionesGemini.push({
      url,
      clave: new Headers(init?.headers).get("x-goog-api-key"),
      cuerpo: JSON.parse(String(init?.body)),
    });
    return Response.json({
      candidates: [{
        content: { role: "model", parts: [{ text: respuestaModelo() }] },
        finishReason: "STOP",
      }],
    });
  });

  const solicitar = (body: unknown) => clasificar(new Request("http://localhost/api/classify", {
    method: "POST", body: typeof body === "string" ? body : JSON.stringify(body),
  }));

  try {
    const ok = await solicitar({ documento_id: id, ruta_objeto: rutaPdf });
    assert.equal(ok.status, 200);
    const cuerpo = await ok.json();
    assert.equal(cuerpo.status, "clasificado");
    assert.equal(cuerpo.documento_id, id);
    assert.equal(cuerpo.categoria, "RECETA_MEDICA");
    assert.equal(cuerpo.confianza, 0.93);
    assert.equal(cuerpo.requiere_revision_humana, false);
    assert.equal(cuerpo.modelo, "modelo-de-prueba");
    assert.ok(!Number.isNaN(Date.parse(cuerpo.clasificado_en)));
    assert.deepEqual(cuerpo.resultado_oci, {
      bucket: "mediflow-documentos-clinicos",
      ruta_objeto: `procesados/2026/09/${id}/${id}.clasificacion.json`,
    });

    assert.equal(lecturas.length, 1);
    assert.equal(lecturas[0].objectName, rutaPdf);

    assert.equal(peticionesGemini.length, 1);
    assert.match(peticionesGemini[0].url, /modelo-de-prueba:generateContent/);
    assert.equal(peticionesGemini[0].clave, "clave-de-prueba");
    const partes = peticionesGemini[0].cuerpo.contents[0].parts;
    const inline = partes.find((p: any) => p.inlineData ?? p.inline_data);
    assert.ok(inline, "el PDF viaja como dato inline");
    assert.deepEqual(Buffer.from((inline.inlineData ?? inline.inline_data).data, "base64"), pdf);

    assert.equal(puts.length, 1);
    assert.equal(puts[0].objectName, cuerpo.resultado_oci.ruta_objeto);
    const guardado = JSON.parse(Buffer.from(puts[0].putObjectBody as Buffer).toString());
    assert.equal(guardado.categoria, "RECETA_MEDICA");
    assert.equal(guardado.documento_id, id);
    assert.equal("status" in guardado, false);
    assert.equal("resultado_oci" in guardado, false);

    // Entradas inválidas: no tocan OCI ni Gemini.
    const antes = { lecturas: lecturas.length, gemini: peticionesGemini.length, puts: puts.length };
    for (const [body, estado] of [
      ["{", 400],
      [{}, 422],
      [{ documento_id: "../x", ruta_objeto: rutaPdf }, 422],
      [{ documento_id: id, ruta_objeto: `recibidos/2026/09/${id}/${id}.metadata.json` }, 422],
      [{ documento_id: id, ruta_objeto: `recibidos/2026/09/DOC-CLIN-2026-AAAAAA/DOC-CLIN-2026-AAAAAA.pdf` }, 422],
    ] as const) {
      const respuesta = await solicitar(body);
      assert.equal(respuesta.status, estado);
      assert.equal((await respuesta.json()).status, "rechazado");
    }
    assert.deepEqual(
      { lecturas: lecturas.length, gemini: peticionesGemini.length, puts: puts.length },
      antes,
    );

    // Documento inexistente: 404 sin llamar a Gemini ni escribir.
    existe = false;
    const noExiste = await solicitar({ documento_id: id, ruta_objeto: rutaPdf });
    assert.equal(noExiste.status, 404);
    assert.equal(peticionesGemini.length, 1);
    assert.equal(puts.length, 1);
  } finally {
    globalThis.fetch = fetchOriginal;
    variables.forEach((nombre, indice) => {
      if (anteriores[indice] === undefined) delete process.env[nombre];
      else process.env[nombre] = anteriores[indice];
    });
  }
});
