import assert from "node:assert/strict";
import { test } from "node:test";
import { ObjectStorageClient, type requests, type responses } from "oci-objectstorage";
import { ErrorAlmacenamiento, formatoOriginal, persistirDocumentoRecibido } from "../lib/storage";
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

test("recepción requiere OCI y no confirma éxito sin configuración", async (t) => {
  const anterior = process.env.OCI_NAMESPACE;
  delete process.env.OCI_NAMESPACE;
  t.mock.method(console, "error", () => {});
  try {
    const respuesta = await enviarJson(new Request("http://localhost/api/ingest/json", {
      method: "POST", body: JSON.stringify({ tipo_archivo: "TEXTO", documento_texto: "Documento sintético" }),
    }));
    assert.equal(respuesta.status, 503);
    assert.equal((await respuesta.json()).status, "error");
  } finally {
    if (anterior === undefined) delete process.env.OCI_NAMESPACE; else process.env.OCI_NAMESPACE = anterior;
  }
});
