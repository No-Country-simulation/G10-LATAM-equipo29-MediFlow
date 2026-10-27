import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import type { ObjectStorageClient } from "oci-objectstorage";
import { listarObjetosAdmin, leerObjetoAdmin, validarRutaAdmin, errorAdmin, LIMITE_ADMIN } from "../lib/admin-oci";
import { BUCKET_DOCUMENTOS } from "../lib/storage";

test("admin: rechaza rutas inválidas y cursores ajenos antes de consultar OCI", async () => {
  for (const ruta of ["../secreto", "/externo", "recibidos/../otro", "a\\b", "a\n"]) assert.throws(() => validarRutaAdmin(ruta), { status: 400 });
  assert.equal(validarRutaAdmin("", true), "");
  await assert.rejects(listarObjetosAdmin("recibidos/", "errores/x", true, () => { throw new Error("No llamar"); }), { status: 400 });
});

test("admin: lista paginada siempre usa el bucket del proyecto y no carga contenidos", async () => {
  const cliente: Pick<ObjectStorageClient, "listObjects"> = { async listObjects(p) {
    assert.equal(p.bucketName, BUCKET_DOCUMENTOS); assert.equal(p.limit, 50); assert.equal(p.delimiter, "/"); assert.equal(p.start, "recibidos/b");
    return { listObjects: { objects: [{ name: "recibidos/b", size: 17 }], prefixes: ["recibidos/2026/"], nextStartWith: "recibidos/c" }, opcRequestId: "prueba", opcClientRequestId: "prueba" };
  } };
  const r = await listarObjetosAdmin("recibidos/", "recibidos/b", true, () => ({ cliente, namespace: "prueba" }));
  assert.equal(r.siguiente, "recibidos/c"); assert.equal(r.objetos[0].tamano, 17); assert.deepEqual(r.carpetas, ["recibidos/2026/"]);
});

function conexion(bytes: Buffer[], contentLength: number) {
  const stream = Readable.from(bytes);
  const cliente: Pick<ObjectStorageClient, "getObject"> = { async getObject(p) {
    assert.equal(p.bucketName, BUCKET_DOCUMENTOS);
    return { value: stream, contentLength } as Awaited<ReturnType<ObjectStorageClient["getObject"]>>;
  } };
  return { conectar: () => ({ cliente, namespace: "prueba" }), stream };
}
test("admin: lee bytes intactos y limita también streams con longitud incorrecta", async () => {
  const correcto = conexion([Buffer.from("abc"), Buffer.from("def")], 6);
  assert.equal((await leerObjetoAdmin("recibidos/prueba.txt", correcto.conectar)).toString(), "abcdef");
  const exceso = conexion([Buffer.alloc(LIMITE_ADMIN + 1)], 1);
  await assert.rejects(leerObjetoAdmin("recibidos/grande.pdf", exceso.conectar), { status: 413 });
  assert.equal(exceso.stream.destroyed, true);
});
test("admin: errores OCI no exponen secretos y explican falta de permisos", async () => {
  const r = errorAdmin({ statusCode: 403, message: "SECRETO" });
  assert.equal(r.status, 403); assert.match(await r.text(), /permisos/);
  assert.doesNotMatch(await errorAdmin(new Error("SECRETO")).text(), /SECRETO/);
});
