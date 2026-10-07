/**
 * POST /api/classify — Clasifica por categoría un documento ya ingerido.
 * application/json: { documento_id, ruta_objeto } (salida de la ingesta).
 *
 * Lee el original desde OCI Object Storage, lo envía a Gemini y guarda el
 * resultado en procesados/ sin modificar el original.
 */
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { clasificarDocumento, ErrorClasificacion } from "@/lib/clasificacion";
import {
  ErrorAlmacenamiento,
  leerDocumentoRecibido,
  persistirResultadoProcesado,
} from "@/lib/storage";
import { ClasificarEntradaSchema } from "@/lib/types";
import { MAX_BYTES_LECTURA } from "@/lib/validators";

export const runtime = "nodejs";
// La llamada a Gemini puede tardar varios segundos con PDFs o imágenes.
export const maxDuration = 30;

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

  const parseo = ClasificarEntradaSchema.safeParse(cuerpo);
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
  const { documento_id: documentoId, ruta_objeto: rutaObjeto } = parseo.data;

  try {
    const original = await leerDocumentoRecibido(
      documentoId,
      rutaObjeto,
      MAX_BYTES_LECTURA,
    );

    const clasificacion = await clasificarDocumento({
      contenido: original.contenido,
      extension: original.extension,
    });

    const clasificadoEn = new Date().toISOString();

    const resultado = {
      documento_id: documentoId,
      ...clasificacion,
      clasificado_en: clasificadoEn,
    };

    const almacenamientoResultado = await persistirResultadoProcesado(
      documentoId,
      original.ruta,
      "clasificacion",
      resultado,
    );

    return NextResponse.json(
      {
        status: "clasificado",
        ...resultado,
        resultado_oci: almacenamientoResultado,
      },
      { status: 200 },
    );
  } catch (error) {
    if (
      error instanceof ErrorAlmacenamiento ||
      error instanceof ErrorClasificacion
    ) {
      return NextResponse.json(
        { status: "rechazado", detalle: error.message },
        { status: error.status },
      );
    }
    console.error("Error inesperado en /api/classify:", error);
    return NextResponse.json(
      { status: "rechazado", detalle: "Error interno al clasificar el documento." },
      { status: 500 },
    );
  }
}
