import assert from "node:assert/strict";
import { test } from "node:test";
import { validarArchivo, FormatoNoSoportadoError, ArchivoInconsistenteError, ArchivoDemasiadoGrandeError, TAMANO_MAXIMO_BYTES } from "../lib/validators";

test("acepta archivos JSON válidos y mide sus bytes UTF-8", () => {
  for (const valor of [' {"texto":"áé", "datos":[1,true,null]}\n', '[]', 'null', '123', '"texto"']) {
    for (const mime of ["application/json", "application/json; charset=utf-8", "", "application/octet-stream"]) {
      const bytes = Buffer.from(valor);
      assert.deepEqual(validarArchivo("documento.JSON", mime, bytes), {
        tipoDetectado: "JSON", tamanoBytes: bytes.length,
      });
    }
  }
});

test("rechaza JSON vacío, mal formado o con UTF-8 inválido", () => {
  for (const bytes of [Buffer.from(""), Buffer.from("   "), Buffer.from('{"a":1,}'),
    Buffer.from("texto plano"), Buffer.from([0x22, 0xff, 0x22])]) {
    assert.throws(() => validarArchivo("documento.json", "application/json", bytes), FormatoNoSoportadoError);
  }
});

test("rechaza discrepancias entre JSON y PDF o imagen", () => {
  for (const [nombre, mime, contenido] of [
    ["documento.pdf", "application/pdf", "{}"],
    ["documento.json", "image/png", "{}"],
    ["documento.json", "application/json", "%PDF-1.7\n"],
  ]) {
    assert.throws(() => validarArchivo(nombre, mime, Buffer.from(contenido)), ArchivoInconsistenteError);
  }
});

test("mantiene el límite de tamaño para archivos JSON", () => {
  assert.throws(() => validarArchivo("documento.json", "application/json",
    Buffer.alloc(TAMANO_MAXIMO_BYTES + 1, 0x20)), ArchivoDemasiadoGrandeError);
});
