import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GET } from "../app/api/ingest/salud/route";
import { ErrorAlmacenamiento, obtenerConexionOci } from "../lib/storage";

test("salud solo devuelve disponibilidad, sin configuración ni rutas locales", async () => {
  const respuesta = await GET();
  assert.equal(respuesta.status, 200);
  assert.deepEqual(await respuesta.json(), { status: "ok", servicio: "mediflow-ingest" });
});

test("errores de configuración OCI no exponen valores en respuesta ni logs", (t) => {
  const nombres = ["OCI_REGION", "OCI_NAMESPACE", "OCI_AUTH_MODE"];
  const anteriores = nombres.map((nombre) => process.env[nombre]);
  const secreto = "valor-interno-que-no-debe-exponerse";
  const logs: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => logs.push(args));
  Object.assign(process.env, {
    OCI_REGION: "us-phoenix-1", OCI_NAMESPACE: "prueba", OCI_AUTH_MODE: secreto,
  });
  try {
    assert.throws(obtenerConexionOci, (error) => {
      assert.ok(error instanceof ErrorAlmacenamiento);
      assert.equal(error.status, 503);
      assert.equal(error.message, "El almacenamiento OCI no está configurado correctamente.");
      return true;
    });
    assert.ok(logs.length > 0);
    assert.ok(!JSON.stringify(logs).includes(secreto));
  } finally {
    nombres.forEach((nombre, indice) => {
      if (anteriores[indice] === undefined) delete process.env[nombre];
      else process.env[nombre] = anteriores[indice];
    });
  }
});

test("el ejemplo de entorno mantiene vacías las credenciales", () => {
  const ejemplo = readFileSync(".env.example", "utf8");
  for (const nombre of ["GEMINI_API_KEY", "OCI_PRIVATE_KEY", "OCI_PRIVATE_KEY_PASSPHRASE",
    "OCI_FINGERPRINT", "OCI_USER_OCID", "OCI_TENANCY_OCID"]) {
    const linea = ejemplo.split(/\r?\n/).find((valor) => valor.startsWith(`${nombre}=`));
    assert.equal(linea?.slice(nombre.length + 1).trim(), "", `${nombre} debe estar vacío`);
  }
});
