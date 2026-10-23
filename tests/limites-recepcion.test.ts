import test from "node:test";
import assert from "node:assert/strict";
import { MAX_BYTES_BINARIO } from "../lib/limites-documento";
import { validarArchivo, ArchivoDemasiadoGrandeError } from "../lib/validators";
import { recibirDocumento } from "../lib/recepcion";

test("recepción admite PDF de 14 MiB y rechaza un byte adicional", () => {
  const pdf = Buffer.alloc(MAX_BYTES_BINARIO + 1);
  pdf.write("%PDF-");
  assert.equal(validarArchivo("archivo.pdf", "application/pdf", pdf.subarray(0, MAX_BYTES_BINARIO)).tamanoBytes, MAX_BYTES_BINARIO);
  assert.throws(() => validarArchivo("archivo.pdf", "application/pdf", pdf), ArchivoDemasiadoGrandeError);
});

test("TIFF y binarios grandes no se almacenan, incluso con nombre engañoso", async () => {
  const grande = Buffer.alloc(MAX_BYTES_BINARIO + 1);
  grande.write("%PDF-");
  let escrituras = 0;
  for (const [nombre, mime, bytes, status] of [
    ["archivo.tiff", "image/tiff", Buffer.from([0x49, 0x49, 0x2a, 0]), 415],
    ["archivo.png", "image/png", Buffer.from([0x49, 0x49, 0x2a, 0]), 415],
    ["archivo.jpg", "image/jpeg", Buffer.from([0x4d, 0x4d, 0, 0x2a]), 415],
    ["archivo.json", "application/octet-stream", grande, 413],
  ] as const) {
    const form = new FormData();
    form.set("archivo", new File([bytes], nombre, { type: mime }));
    const respuesta = await recibirDocumento(new Request("http://localhost/api/ingest/file", {
      method: "POST", body: form,
    }), "archivo", async () => { escrituras++; throw new Error("No debe almacenar"); });
    assert.equal(respuesta.status, status);
  }
  assert.equal(escrituras, 0);
});
