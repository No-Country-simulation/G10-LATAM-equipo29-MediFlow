/**
 * POST /api/ingest/json — Ingiere un documento clínico como JSON/texto.
 * Corresponde 1:1 al ejemplo de solicitud del brief del hackathon.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  DocumentoClinicoEntradaSchema,
  generarDocumentoId,
  MetadatoDocumento,
  ResultadoIngesta,
} from "@/lib/types";
import { persistirEnOciStub, persistirMetadatoStub } from "@/lib/storage";
import {
  ArchivoDemasiadoGrandeError,
  FormatoNoSoportadoError,
  validarTextoJson,
} from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json(
      { status: "rechazado", detalle: "El body no es un JSON válido." },
      { status: 400 },
    );
  }

  const parseo = DocumentoClinicoEntradaSchema.safeParse(cuerpo);
  if (!parseo.success) {
    return NextResponse.json(
      {
        status: "rechazado",
        detalle: (parseo.error as ZodError).issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 422 },
    );
  }
  const payload = parseo.data;

  try {
    const { tamanoBytes } = validarTextoJson(payload.documento_texto);

    const documentoId = payload.documento_id ?? generarDocumentoId();
    const nombreGuardado = `${documentoId}.json`;
    const rutaObjeto = await persistirEnOciStub(
      nombreGuardado,
      JSON.stringify(payload),
    );
    const recibidoEn = new Date().toISOString();

    const metadato: MetadatoDocumento = {
      documento_id: documentoId,
      canal_origen: payload.canal_origen,
      tipo_archivo_detectado: payload.tipo_archivo,
      tamano_bytes: tamanoBytes,
      recibido_en: recibidoEn,
      nombre_original: nombreGuardado,
    };
    await persistirMetadatoStub(nombreGuardado, metadato);

    const resultado: ResultadoIngesta = {
      status: "recibido",
      documento_id: documentoId,
      tipo_archivo_detectado: payload.tipo_archivo,
      tamano_bytes: tamanoBytes,
      canal_origen: payload.canal_origen,
      recibido_en: recibidoEn,
      ruta_objeto_temporal: rutaObjeto,
    };

    return NextResponse.json(resultado, { status: 201 });
  } catch (error) {
    if (error instanceof FormatoNoSoportadoError) {
      return NextResponse.json(
        { status: "rechazado", detalle: error.message },
        { status: 422 },
      );
    }
    if (error instanceof ArchivoDemasiadoGrandeError) {
      return NextResponse.json(
        { status: "rechazado", detalle: error.message },
        { status: 413 },
      );
    }
    console.error("Error inesperado en /api/ingest/json:", error);
    return NextResponse.json(
      { status: "rechazado", detalle: "Error interno al procesar el documento." },
      { status: 500 },
    );
  }
}
