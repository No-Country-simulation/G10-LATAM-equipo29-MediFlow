import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { ObjectStorageClient, type requests, type responses } from "oci-objectstorage";
import { ErrorAlmacenamiento, formatoOriginal, obtenerConexionOci, persistirDocumentoRecibido } from "../lib/storage";
import { POST as enviarJson } from "../app/api/ingest/json/route";
import { POST as enviarArchivo } from "../app/api/ingest/file/route";

const id = "DOC-CLIN-2026-1U0FNJ";
const entrada = {
  contenido: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]),
  extension: "jpg", contentType: "image/jpeg",
  metadato: {
    documento_id: id, canal_origen: "Otro" as const, tipo_archivo_detectado: "IMAGEN" as const,
    tamano_bytes: 5, recibido_en: "2026-09-30T23:59:59.999Z", nombre_original: "paciente.jpg",
  },
};

function simular(falloEn = 0, codigo?: number, fallaBorrado = false) {
  const puts: requests.PutObjectRequest[] = [];
  const deletes: requests.DeleteObjectRequest[] = [];
  const cliente: Pick<ObjectStorageClient, "putObject" | "deleteObject"> = {
    async putObject(request) {
      puts.push(request);
      if (puts.length === falloEn) throw Object.assign(new Error("Secreto del SDK"), { statusCode: codigo });
      return { eTag: "etag-reserva" } as responses.PutObjectResponse;
    },
    async deleteObject(request) {
      deletes.push(request);
      if (fallaBorrado) throw new Error("Sin permisos");
      return {} as responses.DeleteObjectResponse;
    },
  };
  return { puts, deletes, conectar: () => ({ cliente, namespace: "namespace-prueba" }) };
}

test("guarda original intacto y solo metadatos de recepción con almacenamiento OCI anidado", async () => {
  const oci = simular();
  const resultado = await persistirDocumentoRecibido(entrada, oci.conectar);
  const carpeta = `recibidos/2026/09/${id}`;
  assert.equal(resultado.ruta_objeto, `${carpeta}/${id}.jpg`);
  assert.equal(oci.puts[0].objectName, `${carpeta}/${id}.metadata.json`);
  assert.equal(oci.puts.length, 2);
  const meta = JSON.parse(Buffer.from(oci.puts[0].putObjectBody as Buffer).toString());
  assert.deepEqual(meta, {
    ...entrada.metadato,
    almacenamiento_oci: {
      bucket: "mediflow-documentos-clinicos", ruta_objeto: resultado.ruta_objeto,
    },
  });
  assert.deepEqual(oci.puts[1].putObjectBody, entrada.contenido);
  assert.equal(oci.puts[1].contentType, "image/jpeg");
  for (const put of oci.puts) {
    assert.equal(put.bucketName, "mediflow-documentos-clinicos");
    assert.equal(put.ifNoneMatch, "*");
  }
});

test("particiona por fecha UTC de recepción incluso si el ID tiene otro año", async () => {
  const oci = simular();
  const resultado = await persistirDocumentoRecibido({ ...entrada,
    metadato: { ...entrada.metadato, recibido_en: "2026-12-31T23:30:00-06:00" },
  }, oci.conectar);
  assert.match(resultado.ruta_objeto, /^recibidos\/2027\/01\//);
});

test("preserva el JSON original y mide bytes UTF-8, no caracteres", async () => {
  const oci = simular();
  const contenido = '{ "tipo_archivo": "TEXTO", "documento_texto": "Prueba áé" }\n';
  const resultado = await persistirDocumentoRecibido({ ...entrada, contenido,
    extension: "json", contentType: "application/json",
  }, oci.conectar);
  assert.equal(Buffer.from(oci.puts[1].putObjectBody as Buffer).toString(), contenido);
  assert.match(resultado.ruta_objeto, /\.json$/);
  assert.equal(JSON.parse(Buffer.from(oci.puts[0].putObjectBody as Buffer).toString()).tamano_bytes, Buffer.byteLength(contenido));
});

test("conflicto en metadata no escribe original ni elimina objetos existentes", async () => {
  const oci = simular(1, 412);
  await assert.rejects(persistirDocumentoRecibido(entrada, oci.conectar), { status: 409 });
  assert.equal(oci.puts.length, 1);
  assert.equal(oci.deletes.length, 0);
});

test("rechazo definitivo del original revierte solo metadata con su ETag", async () => {
  const oci = simular(2, 403);
  await assert.rejects(persistirDocumentoRecibido(entrada, oci.conectar), { status: 502 });
  assert.equal(oci.deletes.length, 1);
  assert.equal(oci.deletes[0].ifMatch, "etag-reserva");
  assert.equal(oci.deletes[0].objectName, `recibidos/2026/09/${id}/${id}.metadata.json`);
});

test("timeout no borra metadata ni devuelve éxito cuando el resultado es incierto", async (t) => {
  t.mock.method(console, "error", () => {});
  const oci = simular(2);
  await assert.rejects(persistirDocumentoRecibido(entrada, oci.conectar), { status: 502 });
  assert.equal(oci.deletes.length, 0);
});

test("fallo de limpieza sigue devolviendo un error controlado sin secretos", async (t) => {
  t.mock.method(console, "error", () => {});
  const oci = simular(2, 403, true);
  await assert.rejects(persistirDocumentoRecibido(entrada, oci.conectar), (error) => {
    assert.ok(error instanceof ErrorAlmacenamiento);
    assert.equal(error.status, 502);
    assert.doesNotMatch(error.message, /Secreto|permisos/);
    return true;
  });
});

test("no permite rutas inyectadas mediante ID o extensión", async () => {
  const oci = simular();
  await assert.rejects(persistirDocumentoRecibido({ ...entrada,
    metadato: { ...entrada.metadato, documento_id: "../otro" },
  }, oci.conectar));
  await assert.rejects(persistirDocumentoRecibido({ ...entrada, extension: "../../pdf" }, oci.conectar));
  assert.equal(oci.puts.length, 0);
});

test("deriva extensión y MIME de las firmas admitidas", () => {
  for (const [firma, extension] of [[0x25, "pdf"], [0xff, "jpg"], [0x89, "png"],
    [0x49, "tiff"], [0x4d, "tiff"], [0x52, "webp"]] as const) {
    assert.equal(formatoOriginal(new Uint8Array([firma])).extension, extension);
  }
});

test("rechaza JSON mal formado antes de intentar almacenarlo", async (t) => {
  const put = t.mock.method(ObjectStorageClient.prototype, "putObject", async () => {
    throw new Error("No debe escribir contenido inválido");
  });
  for (const body of ['{"tipo_archivo":', JSON.stringify({
    tipo_archivo: "JSON", documento_texto: '{"valor": 1,}',
  }), JSON.stringify({ tipo_archivo: "JSON", documento_texto: "texto sin estructura JSON" })]) {
    const respuesta = await enviarJson(new Request("http://localhost/api/ingest/json", { method: "POST", body }));
    assert.equal(respuesta.status, body === '{"tipo_archivo":' ? 400 : 422);
    assert.equal((await respuesta.json()).status, "rechazado");
  }
  assert.equal(put.mock.callCount(), 0);
});

test("rechaza cualquier JSON válido enviado como TEXTO sin escribir en OCI", async (t) => {
  const put = t.mock.method(ObjectStorageClient.prototype, "putObject", async () => {
    throw new Error("No debe almacenar JSON como TEXTO");
  });
  for (const documento_texto of ['{"valor": 1}', '[1, {"valor": true}]', '{}', '[]',
    '  \n {"texto": "áé"} \n ', '"cadena JSON"', '123', 'true', 'false', 'null']) {
    const respuesta = await enviarJson(new Request("http://localhost/api/ingest/json", {
      method: "POST", body: JSON.stringify({ tipo_archivo: "TEXTO", documento_texto }),
    }));
    assert.equal(respuesta.status, 422);
    assert.deepEqual(await respuesta.json(), {
      status: "rechazado",
      detalle: "El contenido es JSON válido. Seleccione la opción JSON en lugar de TEXTO.",
    });
  }
  assert.equal(put.mock.callCount(), 0);
});

test("API sin configuración OCI devuelve 503 y mantiene validación de entrada", async () => {
  const originalNamespace = process.env.OCI_NAMESPACE;
  delete process.env.OCI_NAMESPACE;
  try {
    assert.throws(obtenerConexionOci, { status: 503 });
    const respuesta = await enviarJson(new Request("http://localhost/api/ingest/json", {
      method: "POST", body: JSON.stringify({ tipo_archivo: "TEXTO", documento_texto: "Texto de prueba" }),
    }));
    assert.equal(respuesta.status, 503);
    assert.equal((await respuesta.json()).status, "rechazado");
    const form = new FormData();
    form.set("archivo", new File(["%PDF-1.7\n"], "prueba.pdf", { type: "application/pdf" }));
    const archivo = await enviarArchivo(new Request("http://localhost/api/ingest/file", { method: "POST", body: form }));
    assert.equal(archivo.status, 503);
    const invalido = await enviarJson(new Request("http://localhost/api/ingest/json", { method: "POST", body: "{}" }));
    assert.equal(invalido.status, 422);
  } finally {
    if (originalNamespace === undefined) delete process.env.OCI_NAMESPACE;
    else process.env.OCI_NAMESPACE = originalNamespace;
  }
});

test("ambas APIs confirman 201 tras dos escrituras y conservan sus originales", async (t) => {
  const variables = ["OCI_REGION", "OCI_NAMESPACE", "OCI_AUTH_MODE", "OCI_TENANCY_OCID",
    "OCI_USER_OCID", "OCI_FINGERPRINT", "OCI_PRIVATE_KEY", "OCI_PRIVATE_KEY_PASSPHRASE"];
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
  });
  const puts: requests.PutObjectRequest[] = [];
  t.mock.method(ObjectStorageClient.prototype, "putObject", async (request: requests.PutObjectRequest) => {
    puts.push(request);
    return { eTag: "etag-prueba" };
  });
  try {
    const original = '{ "tipo_archivo": "TEXTO", "documento_texto": "Prueba sintética á" }\n';
    const json = await enviarJson(new Request("http://localhost/api/ingest/json", { method: "POST", body: original }));
    assert.equal(json.status, 201);
    const respuesta = await json.json();
    assert.match(respuesta.documento_id, /^DOC-CLIN-\d{4}-[A-Z0-9]{6}$/);
    assert.equal("ruta_objeto_temporal" in respuesta, false);
    assert.equal(puts.length, 2);
    assert.equal(Buffer.from(puts[1].putObjectBody as Buffer).toString(), original);
    const { status: estadoJson, ...metadatosJson } = respuesta;
    assert.equal(estadoJson, "recibido");
    assert.deepEqual(JSON.parse(Buffer.from(puts[0].putObjectBody as Buffer).toString()), {
      ...metadatosJson, nombre_original: `${respuesta.documento_id}.json`,
    });
    assert.deepEqual(respuesta.almacenamiento_oci, {
      bucket: "mediflow-documentos-clinicos", ruta_objeto: puts[1].objectName,
    });
    const bytes = Buffer.from("%PDF-1.7\nOriginal sintético\n");
    const form = new FormData();
    form.set("archivo", new File([bytes], "nombre-paciente.pdf", { type: "application/pdf" }));
    const pdf = await enviarArchivo(new Request("http://localhost/api/ingest/file", { method: "POST", body: form }));
    assert.equal(pdf.status, 201);
    assert.equal(puts.length, 4);
    assert.deepEqual(puts[3].putObjectBody, bytes);
    assert.doesNotMatch(puts[3].objectName, /nombre-paciente/);
    const respuestaPdf = await pdf.json();
    assert.match(respuestaPdf.documento_id, /^DOC-CLIN-\d{4}-[A-Z0-9]{6}$/);
    assert.equal("ruta_objeto_temporal" in respuestaPdf, false);
    const { status: estadoPdf, ...metadatosPdf } = respuestaPdf;
    assert.equal(estadoPdf, "recibido");
    assert.deepEqual(JSON.parse(Buffer.from(puts[2].putObjectBody as Buffer).toString()), {
      ...metadatosPdf, nombre_original: "nombre-paciente.pdf",
    });
    assert.deepEqual(respuestaPdf.almacenamiento_oci, {
      bucket: "mediflow-documentos-clinicos", ruta_objeto: puts[3].objectName,
    });
    const contenidoJson = Buffer.from(' {"paciente":"Prueba á", "resultados":[1,true,null]}\n');
    const inicioJson: number = puts.length;
    const formJson = new FormData();
    formJson.set("archivo", new File([contenidoJson], "clinico.json", { type: "application/json" }));
    const archivoJson = await enviarArchivo(new Request("http://localhost/api/ingest/file", { method: "POST", body: formJson }));
    assert.equal(archivoJson.status, 201);
    const resultadoJson = await archivoJson.json();
    assert.equal(resultadoJson.tipo_archivo_detectado, "JSON");
    assert.equal(puts.length, inicioJson + 2);
    assert.deepEqual(puts[inicioJson + 1].putObjectBody, contenidoJson);
    assert.equal(puts[inicioJson + 1].contentType, "application/json");
    assert.match(puts[inicioJson + 1].objectName, /\.json$/);
    const { status: estadoArchivoJson, ...metaArchivoJson } = resultadoJson;
    assert.equal(estadoArchivoJson, "recibido");
    assert.deepEqual(JSON.parse(Buffer.from(puts[inicioJson].putObjectBody as Buffer).toString()), {
      ...metaArchivoJson, nombre_original: "clinico.json",
    });
    const escriturasAntes: number = puts.length;
    const formInvalido = new FormData();
    formInvalido.set("archivo", new File(['{"dato":}'], "invalido.json", { type: "application/json" }));
    const invalido = await enviarArchivo(new Request("http://localhost/api/ingest/file", { method: "POST", body: formInvalido }));
    assert.equal(invalido.status, 415);
    assert.equal(puts.length, escriturasAntes);

    for (const tipo_archivo of ["TEXTO", "JSON"] as const) {
      const texto = 'Línea con "comillas", tildes áé, emoji 🩺\nOtra línea\tC:\\documentos';
      const estructura = { texto, resultados: [1, true, null, { unidad: "mg" }] };
      const documento_texto = tipo_archivo === "TEXTO" ? texto : JSON.stringify(estructura);
      const cuerpo = { tipo_archivo, documento_texto, canal_origen: "Portal_Paciente" };
      const inicio: number = puts.length;
      const respuestaPrueba = await enviarJson(new Request("http://localhost/api/ingest/json", {
        method: "POST", body: JSON.stringify(cuerpo),
      }));
      assert.equal(respuestaPrueba.status, 201);
      assert.equal(puts.length, inicio + 2);
      const resultado = await respuestaPrueba.json();
      const metadata = JSON.parse(Buffer.from(puts[inicio].putObjectBody as Buffer).toString("utf8"));
      const original: Buffer = Buffer.from(puts[inicio + 1].putObjectBody as Buffer);
      const guardado = JSON.parse(original.toString("utf8"));
      assert.deepEqual(guardado, cuerpo);
      if (tipo_archivo === "JSON") assert.deepEqual(JSON.parse(guardado.documento_texto), estructura);
      assert.deepEqual(metadata, {
        documento_id: resultado.documento_id,
        canal_origen: cuerpo.canal_origen,
        tipo_archivo_detectado: tipo_archivo,
        tamano_bytes: original.byteLength,
        recibido_en: resultado.recibido_en,
        nombre_original: `${resultado.documento_id}.json`,
        almacenamiento_oci: resultado.almacenamiento_oci,
      });
      for (const solicitud of puts.slice(inicio)) {
        assert.equal(solicitud.contentType, "application/json");
        assert.equal(solicitud.contentLength, Buffer.byteLength(solicitud.putObjectBody as Buffer));
      }
    }
  } finally {
    variables.forEach((nombre, indice) => {
      if (anteriores[indice] === undefined) delete process.env[nombre];
      else process.env[nombre] = anteriores[indice];
    });
  }
});
