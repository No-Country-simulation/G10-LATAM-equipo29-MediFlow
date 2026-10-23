import test from "node:test";
import assert from "node:assert/strict";
import { evaluarClasificacion } from "../lib/politica-clasificacion";

test("umbral inclusivo, OTRO siempre requiere revisión y los motivos se acumulan", () => {
  for (const [categoria, confianza, estado, motivos] of [
    ["RECETA_MEDICA", 0.85, "aceptada", []],
    ["RECETA_MEDICA", 0.8499, "ambigua", ["CONFIANZA_CLASIFICACION_INSUFICIENTE"]],
    ["OTRO", 1, "ambigua", ["CATEGORIA_NO_ESPECIFICA"]],
    ["OTRO", 0.2, "ambigua", ["CONFIANZA_CLASIFICACION_INSUFICIENTE", "CATEGORIA_NO_ESPECIFICA"]],
  ] as const) {
    assert.deepEqual(evaluarClasificacion({ categoria, confianza }, ""), { umbral: 0.85, estado, motivos });
  }
  assert.equal(evaluarClasificacion({ categoria: "RECETA_MEDICA", confianza: 0.85 }, "0.9").estado, "ambigua");
});

test("salida inválida y mala configuración son errores, no ambigüedad", () => {
  for (const datos of [{ categoria: "inventada", confianza: 0.9 }, { categoria: "OTRO" },
    { categoria: "OTRO", confianza: NaN }, { categoria: "OTRO", confianza: 2 }]) {
    assert.throws(() => evaluarClasificacion(datos, "0.85"));
  }
  for (const umbral of ["NaN", "-1", "1.1"]) {
    assert.throws(() => evaluarClasificacion({ categoria: "OTRO", confianza: 1 }, umbral));
  }
});
