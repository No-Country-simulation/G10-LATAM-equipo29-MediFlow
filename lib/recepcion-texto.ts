/** Recepción JSON/texto sin persistencia; devuelve los metadatos de esta solicitud. */
import { NextResponse } from "next/server";
import { DocumentoClinicoEntradaSchema, generarDocumentoId, type ResultadoIngesta } from "@/lib/types";
import { ArchivoDemasiadoGrandeError, FormatoNoSoportadoError, TAMANO_MAXIMO_BYTES, validarTextoJson } from "@/lib/validators";



export async function validarRecepcionTexto(request: Request) {
  let cuerpo: unknown;
  let contenidoOriginal: Uint8Array;
  try {
    contenidoOriginal = new Uint8Array(await request.arrayBuffer());
    cuerpo = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contenidoOriginal));
  } catch {
    return NextResponse.json({ status: "rechazado", detalle: "El body no es un JSON válido." }, { status: 400 });
  }
  const parseo = DocumentoClinicoEntradaSchema.safeParse(cuerpo);
  if (!parseo.success) return NextResponse.json({ status: "rechazado", detalle: parseo.error.issues
    .map(i => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 422 });
  const payload = parseo.data;
  try {
    validarTextoJson(payload.documento_texto);
    let esJson = false;
    try { JSON.parse(payload.documento_texto); esJson = true; } catch { /* Puede ser texto plano. */ }
    if (payload.tipo_archivo === "JSON" && !esJson) {
      throw new FormatoNoSoportadoError("documento_texto debe contener un JSON válido cuando tipo_archivo es JSON.");
    }
    if (payload.tipo_archivo === "TEXTO" && esJson) {
      throw new FormatoNoSoportadoError("El contenido es JSON válido. Seleccione la opción JSON en lugar de TEXTO.");
    }
    if (contenidoOriginal.byteLength > TAMANO_MAXIMO_BYTES) {
      throw new ArchivoDemasiadoGrandeError("El cuerpo JSON excede el máximo de 15 MiB.");
    }
    const documentoId = payload.documento_id ?? generarDocumentoId();
    const resultado: ResultadoIngesta = {
      status: "recibido", documento_id: documentoId, tipo_archivo_detectado: payload.tipo_archivo,
      tamano_bytes: contenidoOriginal.byteLength, canal_origen: payload.canal_origen,
      recibido_en: new Date().toISOString(), nombre_original: `${documentoId}.json`, almacenamiento: "deshabilitado",
    };
    return NextResponse.json(resultado, { status: 201 });
  } catch (error) {
    if (error instanceof FormatoNoSoportadoError || error instanceof ArchivoDemasiadoGrandeError) {
      return NextResponse.json({ status: "rechazado", detalle: error.message },
        { status: error instanceof ArchivoDemasiadoGrandeError ? 413 : 422 });
    }
    console.error("Error inesperado en /api/ingest/json");
    return NextResponse.json({ status: "rechazado", detalle: "Error interno al procesar el documento." }, { status: 500 });
  }
}

