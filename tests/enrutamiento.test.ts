import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/ingest/route/route";
import { REGLAS_ENRUTAMIENTO, EnrutarEntradaSchema, enrutarDocumento } from "../lib/enrutamiento";
import { completarRutaNormal } from "../lib/flujo-enrutamiento";
import type { CategoriaDocumento } from "../lib/clasificacion";
const id = "DOC-CLIN-2026-A1B2C3";

test("asigna las diez categorías sin decisiones de confianza o auditoría", async () => {
  for (const [categoria, destino] of Object.entries(REGLAS_ENRUTAMIENTO)) {
    const r = await POST(new Request("http://localhost/api/ingest/route", { method: "POST",
      body: JSON.stringify({ documento_id: id, categoria }) }));
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.destino, destino);
    assert.equal(body.estado, "pendiente_entrega");
    assert.equal("requiere_revision_humana" in body, false);
    assert.equal("confianza" in body, false);
  }
  assert.equal(REGLAS_ENRUTAMIENTO.OTRO, "cola_area_correspondiente");
});
test("rechaza categorías inválidas y campos del contrato anterior", async () => {
  for (const entrada of [{ categoria: "RECETA_MEDICA" }, { documento_id: id, categoria: "INVALIDA" },
    { documento_id: id, categoria: "RECETA_MEDICA", requiere_revision_humana: true }]) {
    const r = await POST(new Request("http://localhost/api/ingest/route", { method: "POST", body: JSON.stringify(entrada) }));
    assert.equal(r.status, 422);
  }
});
test("el flujo solo llama a enrutamiento después de prioridad normal", async () => {
  let llamadas = 0;
  const solicitar: typeof fetch = async (_url, init) => {
    llamadas++;
    const entrada = JSON.parse(String(init?.body));
    assert.deepEqual(entrada, { documento_id: id, categoria: "RECETA_MEDICA" });
    return Response.json(enrutarDocumento(EnrutarEntradaSchema.parse(entrada)));
  };
  const clasificacion = { ok: true, body: { categoria: "RECETA_MEDICA" as CategoriaDocumento } };
  for (const [nivel, destino] of [["URGENTE", "Cola_Emergencia_Medica"], ["NO_DETERMINADA", "Cola_Auditoria_Humana"]]) {
    const extraccion = { ok: true, body: { prioridad_urgencia: { estado: "evaluada", nivel }, decision_enrutamiento: { destino_principal: destino } } };
    assert.equal(await completarRutaNormal(extraccion, clasificacion, id, solicitar), extraccion);
  }
  assert.equal(llamadas, 0);
  const normal = { ok: true, body: { datos_extraidos: { dato: "conservado" },
    prioridad_urgencia: { estado: "evaluada", nivel: "NORMAL" },
    decision_enrutamiento: { destino_principal: "Ruta_Normal", requiere_auditoria_humana: false } } };
  const r = await completarRutaNormal(normal, clasificacion, id, solicitar);
  assert.equal(llamadas, 1);
  const body = r.body as typeof normal.body;
  assert.equal(body.decision_enrutamiento.destino_principal, "cola_farmacia");
  assert.equal((r.enrutamiento?.body as { destino: string }).destino, "cola_farmacia");
  assert.equal("enrutamiento" in body, false);
  assert.deepEqual(body.datos_extraidos, normal.body.datos_extraidos);
  const fallo = await completarRutaNormal(normal, clasificacion, id, async () => { throw new Error("red"); });
  assert.equal(fallo.ok, false);
  assert.deepEqual((fallo.body as typeof normal.body).datos_extraidos, normal.body.datos_extraidos);
});
