import assert from "node:assert/strict";
import { test } from "node:test";

import { POST as enrutarApi } from "../app/api/ingest/route/route";
import { DESTINOS_ENRUTAMIENTO, enrutarDocumento } from "../lib/enrutamiento";

const documentoBase = {
  documento_id: "DOC-CLIN-2026-A1B2C3",
  confianza: 0.91,
  requiere_revision_humana: false,
  canal_origen: "Guardia_Emergencias" as const,
  destinos_no_disponibles: [],
};

test("enruta por regla primaria cuando el destino está disponible", () => {
  const resultado = enrutarDocumento({
    ...documentoBase,
    categoria: "RECETA_MEDICA",
  });

  assert.equal(resultado.destino, DESTINOS_ENRUTAMIENTO.FARMACIA);
  assert.equal(resultado.fallback_activado, false);
  assert.deepEqual(resultado.ruta_decision, ["INICIO", "RUTA_PRIMARIA", "FIN"]);
});

test("si el destino primario no está disponible, activa fallback automático", () => {
  const resultado = enrutarDocumento({
    ...documentoBase,
    categoria: "RESULTADO_LABORATORIO",
    destinos_no_disponibles: [DESTINOS_ENRUTAMIENTO.LABORATORIO],
  });

  assert.equal(resultado.destino, DESTINOS_ENRUTAMIENTO.REVISION_MANUAL);
  assert.equal(resultado.fallback_activado, true);
  assert.match(String(resultado.motivo_fallback), /primario no disponible/i);
  assert.deepEqual(resultado.ruta_decision, [
    "INICIO",
    "RUTA_PRIMARIA",
    "FALLBACK_CONTINGENCIA",
    "FIN",
  ]);
});

test("si requiere revisión humana, prioriza ruta de revisión", () => {
  const resultado = enrutarDocumento({
    ...documentoBase,
    categoria: "HISTORIA_CLINICA",
    requiere_revision_humana: true,
  });

  assert.equal(resultado.destino, DESTINOS_ENRUTAMIENTO.REVISION_MANUAL);
  assert.equal(resultado.fallback_activado, false);
  assert.deepEqual(resultado.ruta_decision, [
    "INICIO",
    "REVISION_HUMANA",
    "FIN",
  ]);
});

test("POST /api/ingest/route enruta y responde 200", async () => {
  const respuesta = await enrutarApi(
    new Request("http://localhost/api/ingest/route", {
      method: "POST",
      body: JSON.stringify({
        ...documentoBase,
        categoria: "ORDEN_MEDICA",
      }),
    }),
  );

  assert.equal(respuesta.status, 200);
  const body = await respuesta.json();
  assert.equal(body.status, "enrutado");
  assert.equal(body.destino, DESTINOS_ENRUTAMIENTO.ORDENES);
});

test("POST /api/ingest/route valida input y rechaza payload inválido", async () => {
  const respuesta = await enrutarApi(
    new Request("http://localhost/api/ingest/route", {
      method: "POST",
      body: JSON.stringify({ categoria: "RECETA_MEDICA" }),
    }),
  );

  assert.equal(respuesta.status, 422);
  const body = await respuesta.json();
  assert.equal(body.status, "rechazado");
});
