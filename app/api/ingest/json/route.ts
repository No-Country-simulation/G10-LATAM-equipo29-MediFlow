/**
 * POST /api/ingest/json — Ingiere un documento clínico como JSON/texto.
 * Conserva el cuerpo JSON original junto a los metadatos de recepción.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import {
  DocumentoClinicoEntradaSchema,
  generarDocumentoId,
  MetadatoDocumento,
  ResultadoIngesta,
} from "@/lib/types";
import { ErrorAlmacenamiento, persistirDocumentoRecibido } from "@/lib/storage";
import {
  ArchivoDemasiadoGrandeError,
  FormatoNoSoportadoError,
  TAMANO_MAXIMO_BYTES,
  validarTextoJson,
} from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let cuerpo: unknown;
  let contenidoOriginal: Uint8Array;
  try {
    contenidoOriginal = new Uint8Array(await request.arrayBuffer());
    cuerpo = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contenidoOriginal));
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
    validarTextoJson(payload.documento_texto);
    let esJson = false;
    try {
      JSON.parse(payload.documento_texto);
      esJson = true;
    } catch {
      // El contenido que no es JSON puede recibirse con la opción TEXTO.
    }
    if (payload.tipo_archivo === "JSON" && !esJson) {
      throw new FormatoNoSoportadoError("documento_texto debe contener un JSON válido cuando tipo_archivo es JSON.");
    }
    if (payload.tipo_archivo === "TEXTO" && esJson) {
      throw new FormatoNoSoportadoError("El contenido es JSON válido. Seleccione la opción JSON en lugar de TEXTO.");
    }
    if (contenidoOriginal.byteLength > TAMANO_MAXIMO_BYTES) {
      throw new ArchivoDemasiadoGrandeError("El cuerpo JSON excede el máximo de 15 MiB.");
    }
    const tamanoBytes = contenidoOriginal.byteLength;

    const documentoId = payload.documento_id ?? generarDocumentoId();
    const nombreGuardado = `${documentoId}.json`;
    const recibidoEn = new Date().toISOString();

    const metadato: MetadatoDocumento = {
      documento_id: documentoId,
      canal_origen: payload.canal_origen,
      tipo_archivo_detectado: payload.tipo_archivo,
      tamano_bytes: tamanoBytes,
      recibido_en: recibidoEn,
      nombre_original: nombreGuardado,
    };
    const almacenamiento = await persistirDocumentoRecibido({
      contenido: contenidoOriginal, extension: "json", contentType: "application/json", metadato,
    });

    const resultado: ResultadoIngesta = {
      status: "recibido",
      documento_id: documentoId,
      tipo_archivo_detectado: payload.tipo_archivo,
      tamano_bytes: tamanoBytes,
      canal_origen: payload.canal_origen,
      recibido_en: recibidoEn,
      almacenamiento_oci: almacenamiento,
    };

    return NextResponse.json(resultado, { status: 201 });
  } catch (error) {
    if (error instanceof ErrorAlmacenamiento) {
      return NextResponse.json({ status: "rechazado", detalle: error.message }, { status: error.status });
    }
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
