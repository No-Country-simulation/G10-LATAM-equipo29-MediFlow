import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResumenResultado from "../components/ResumenResultado";
import ExtraccionClinica from "../components/ExtraccionClinica";
import type { DatosClinicos } from "../lib/esquema-clinico";

test("el resumen conserva extracción completada cuando falla el guardado", () => {
  const html = renderToStaticMarkup(createElement(ResumenResultado, {
    resultado: { ok: true, body: {}, extraccion: { ok: true, body: {} },
      almacenamiento_oci: { status_backup: "error", bucket: "prueba", ruta_objeto: "prueba" } },
    fase: "error", nombre: "Documento de prueba", onDetalle() {},
  }));
  assert.match(html, /Completada/);
  assert.match(html, /No se pudo guardar/);
  assert.match(html, /Documento de prueba/);
});

test("el resumen explica la extracción omitida y no inventa confianza", () => {
  const html = renderToStaticMarkup(createElement(ResumenResultado, {
    resultado: { ok: true, body: {}, json_final: { ingesta: {}, decision_enrutamiento: {
      destino_principal: "Cola_Auditoria_Humana", requiere_auditoria_humana: true,
      justificacion_enrutamiento: "Clasificación ambigua", notificacion_generada: null, estado: "pendiente_entrega",
    } } }, fase: "almacenamiento", nombre: "Prueba", onDetalle() {},
  }));
  assert.match(html, /Guardando el resultado/);
  assert.match(html, /Omitida por revisión/);
  assert.match(html, /Revisión humana requerida/);
  assert.match(html, /No disponible/);
  assert.doesNotMatch(html, /0 \/ 100/);
});

test("la ficha conserva campos de tablas y distingue falso de información ausente", () => {
  const datos = { paciente: { nombre: "Paciente de prueba", edad: 0 },
    urgencia: { declarada: false, descripcion: null }, antecedentes: [],
    medicamentos: [{ nombre: "Medicamento de prueba", dosis: "Dosis documentada", indicaciones: "Indicación completa", estado: null }],
    resultados_laboratorio: [{ prueba: "Prueba de ejemplo", resultado: "Resultado documentado", rango_referencia: "Referencia original" }],
  } as unknown as DatosClinicos;
  const html = renderToStaticMarkup(createElement(ExtraccionClinica, { datos: { datos_extraidos: datos } }));
  assert.match(html, /<table>/);
  for (const texto of ["Dosis documentada", "Indicación completa", "Referencia original", "No consta", "Ver secciones sin información (1)"]) assert.ok(html.includes(texto));
  assert.match(html, />No<\/span>/);
  assert.match(html, />0<\/span>/);
});
