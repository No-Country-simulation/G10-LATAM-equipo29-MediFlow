import assert from "node:assert/strict";
import { test } from "node:test";
import type { requests, responses } from "oci-objectstorage";
import { procesarFlujo, type EventoFlujo } from "../lib/procesar-flujo";
import { guardarResultadoFinal } from "../lib/almacenamiento-final";
import { recibirDocumento } from "../lib/recepcion";
import { enrutarDocumento } from "../lib/enrutamiento";
import { ErrorAlmacenamiento, persistirDocumentoRecibido } from "../lib/storage";
import { recibirEventos, resultadoInterfaz } from "../lib/cliente-flujo";
import type { JsonFlujo, RutaFinal } from "../lib/resultado-flujo";

const id = "DOC-CLIN-2026-TEST01";
const solicitud = () => new Request("http://localhost/api/process", { method: "POST",
  headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tipo_archivo: "TEXTO", documento_texto: "Documento sintético." }) });
function ociSimulado(codigo?: number) {
  const puts: requests.PutObjectRequest[] = [];
  return { puts, conectar: () => ({ namespace: "prueba", cliente: {
    async putObject(p: requests.PutObjectRequest) {
      puts.push(p);
      if (codigo) throw Object.assign(new Error("SECRETO SDK"), { statusCode: codigo });
      return { eTag: "etag" } as responses.PutObjectResponse;
    }, async deleteObject() { return {} as responses.DeleteObjectResponse; },
    async getObject() { throw new Error("No debe leer"); },
  } }) };
}

test("escribe un solo JSON consolidado, con ubicación propia, para cada ruta", async () => {
  for (const ruta of ["procesados/normales", "procesados/urgentes", "auditoria_humana", "rechazados", "errores"] as RutaFinal[]) {
    const oci = ociSimulado();
    const entrada: JsonFlujo = { ingesta: { documento_id: id }, clasificacion: { categoria: "RECETA_MEDICA" },
      extraccion: { validacion: { valido: true } }, enrutamiento: { destino: "cola_farmacia" } };
    const r = await guardarResultadoFinal(id, ruta, entrada, oci.conectar);
    assert.equal(oci.puts.length, 1);
    assert.equal(oci.puts[0].objectName, `${ruta}/${id}.json`);
    assert.equal(oci.puts[0].ifNoneMatch, "*");
    assert.deepEqual(JSON.parse(Buffer.from(oci.puts[0].putObjectBody as Buffer).toString()), r);
    assert.equal(Object.keys(r).at(-1), "almacenamiento_oci");
    assert.equal(r.almacenamiento_oci.status_backup, "exito");
  }
});

test("fallos y conflictos no declaran respaldo exitoso ni filtran mensajes internos", async () => {
  for (const [codigo, estado] of [[403, "error"], [412, "error"], [408, "no_confirmado"], [500, "no_confirmado"]] as const) {
    const oci = ociSimulado(codigo);
    const r = await guardarResultadoFinal(id, "errores", { ingesta: {} }, oci.conectar);
    assert.equal(r.almacenamiento_oci.status_backup, estado);
    assert.equal(oci.puts.length, 1);
    assert.doesNotMatch(JSON.stringify(r), /SECRETO/);
  }
  const r = await guardarResultadoFinal(id, "errores", { ingesta: {} }, () => { throw new ErrorAlmacenamiento(503, "SECRETO"); });
  assert.equal(r.almacenamiento_oci.status_backup, "error");
  await assert.rejects(guardarResultadoFinal("../x", "errores", { ingesta: {} }));
});

test("recepción guarda bytes intactos y metadatos una sola vez para archivo y texto", async () => {
  const form = new FormData(); form.set("archivo", new File(["%PDF-1.7\nsintético"], "prueba.pdf", { type: "application/pdf" }));
  for (const [request, tipo] of [[solicitud(), "texto"], [new Request("http://localhost", { method: "POST", body: form }), "archivo"]] as const) {
    const oci = ociSimulado();
    const r = await recibirDocumento(request, tipo, entrada => persistirDocumentoRecibido(entrada, oci.conectar));
    assert.equal(r.status, 201);
    const body = await r.json();
    assert.equal(body.almacenamiento_oci.status_backup, "exito");
    assert.equal(oci.puts.length, 2);
    assert.equal(oci.puts[1].objectName, body.almacenamiento_oci.ruta_objeto);
  }
});

test("el servidor finaliza cada rama una vez y conserva las etapas previas", async () => {
  for (const caso of ["normal", "urgente", "auditoria_schema", "auditoria_confianza", "rechazo", "error_lectura", "error_clasificacion", "error_extraccion", "error_ruta"] as const) {
    const eventos: EventoFlujo[] = [];
    const oci = ociSimulado();
    let clasificaciones = 0, extracciones = 0, rutas = 0, guardados = 0, lecturas = 0;
    const bytesOci = new TextEncoder().encode("Contenido recuperado de OCI, distinto de la solicitud");
    const rutaOriginal = `recibidos/2026/10/${id}/${id}.json`;
    const resultado = await procesarFlujo(solicitud(), e => eventos.push(structuredClone(e)), {
      recibir: async () => Response.json({ status: caso === "rechazo" ? "rechazado" : "recibido", documento_id: id,
        almacenamiento_oci: { bucket: "mediflow-documentos-clinicos", ruta_objeto: rutaOriginal, status_backup: "exito" } }, { status: caso === "rechazo" ? 415 : 201 }),
      leer: async (documentoId, ruta, limite) => {
        lecturas++;
        assert.equal(documentoId, id); assert.equal(ruta, rutaOriginal); assert.ok(limite > 0);
        if (caso === "error_lectura") throw new ErrorAlmacenamiento(404, "No existe el original");
        return { contenido: bytesOci, extension: "json", ruta: { anio: "2026", mes: "10", extension: "json" } };
      },
      clasificar: async documento => {
        clasificaciones++;
        assert.equal(documento.documento_id, id);
        assert.equal(documento.contenido, bytesOci);
        return Response.json({ status: caso === "error_clasificacion" ? "rechazado" : "clasificado", categoria: "RECETA_MEDICA" }, { status: caso === "error_clasificacion" ? 502 : 200 });
      },
      extraer: async documento => {
        extracciones++;
        assert.equal(documento.contenido, bytesOci);
        if (caso === "error_extraccion") throw new Error("SECRETO");
        const auditoria = caso.startsWith("auditoria");
        return Response.json({ status: auditoria ? "revision_humana" : "extraido",
          validacion: { valido: caso !== "auditoria_schema" },
          prioridad_urgencia: { estado: auditoria ? "omitida" : "evaluada", nivel: caso === "urgente" ? "URGENTE" : "NORMAL" },
          decision_enrutamiento: { requiere_auditoria_humana: auditoria,
            destino_principal: auditoria ? "Cola_Auditoria_Humana" : caso === "urgente" ? "Cola_Emergencia_Medica" : "Ruta_Normal" } });
      },
      enrutar: entrada => { rutas++; if (caso === "error_ruta") throw new Error("SECRETO"); return enrutarDocumento(entrada); },
      guardar: async (docId, ruta, json) => {
        guardados++;
        const esperada = caso === "normal" ? "procesados/normales" : caso === "urgente" ? "procesados/urgentes" : caso.startsWith("auditoria") ? "auditoria_humana" : caso === "rechazo" ? "rechazados" : "errores";
        assert.equal(ruta, esperada);
        return guardarResultadoFinal(docId, ruta, json, oci.conectar);
      },
    });
    assert.equal(guardados, 1);
    assert.equal(oci.puts.length, 1);
    assert.equal(eventos.filter(e => "final" in e).length, 1);
    assert.equal(rutas, caso === "normal" || caso === "error_ruta" ? 1 : 0);
    assert.equal(lecturas, caso === "rechazo" ? 0 : 1);
    assert.equal(clasificaciones, caso === "rechazo" || caso === "error_lectura" ? 0 : 1);
    assert.equal(extracciones, caso === "rechazo" || caso === "error_lectura" || caso === "error_clasificacion" ? 0 : 1);
    if (caso !== "rechazo") assert.ok(resultado.clasificacion);
    assert.doesNotMatch(JSON.stringify(resultado), /SECRETO/);
    assert.deepEqual(resultadoInterfaz(resultado).json_final, resultado);
  }
});

test("el lector procesa eventos fragmentados y rechaza un stream sin confirmación final", async () => {
  const evento = { fase: "listo", final: true, resultado: { ingesta: { nombre_original: "sintético" } } };
  const bytes = new TextEncoder().encode(JSON.stringify(evento) + "\n");
  const stream = new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } });
  const recibidos: EventoFlujo[] = [];
  await recibirEventos(new Response(stream), e => recibidos.push(e));
  assert.deepEqual(recibidos, [evento]);
  await assert.rejects(recibirEventos(new Response(JSON.stringify({ ...evento, final: false }) + "\n"), () => {}), /sin confirmar/);
});
