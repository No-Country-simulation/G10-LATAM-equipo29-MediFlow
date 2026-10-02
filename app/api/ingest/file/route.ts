/**
 * POST /api/ingest/file — Ingiere un documento clínico en PDF, IMAGEN o JSON.
 * multipart/form-data con campos: archivo (File), canal_origen (opcional).
 *
 * Usa el runtime Node.js de Vercel (no Edge) porque necesitamos Buffer y
 * el SDK de OCI Object Storage.
 */
import { NextResponse } from "next/server";

import { generarDocumentoId, MetadatoDocumento, ResultadoIngesta, validarCanalOrigen } from "@/lib/types";
import { ErrorAlmacenamiento, formatoOriginal, persistirDocumentoRecibido } from "@/lib/storage";
import {
  ArchivoDemasiadoGrandeError,
  ArchivoInconsistenteError,
  FormatoNoSoportadoError,
  validarArchivo,
} from "@/lib/validators";

export const runtime = "nodejs";
// Nota: en el plan Hobby de Vercel el body de las funciones serverless
// está limitado a ~4.5 MB; si necesitas subir archivos más grandes,
// sube directo a OCI/S3 desde el cliente con una URL prefirmada en vez
// de pasar por esta función.

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { status: "rechazado", detalle: "No se pudo interpretar el multipart/form-data." },
      { status: 400 },
    );
  }

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File)) {
    return NextResponse.json(
      {
        status: "rechazado",
        detalle: "Falta el campo 'archivo' (PDF, IMAGEN o JSON) en el form-data.",
        formatos_soportados: ["PDF", "IMAGEN", "JSON"],
      },
      { status: 422 },
    );
  }

  const canalOrigenCrudo = formData.get("canal_origen") as string | null;
  const canalOrigen = validarCanalOrigen(canalOrigenCrudo);
  if (canalOrigen === null) {
    return NextResponse.json(
      {
        status: "rechazado",
        detalle: `canal_origen '${canalOrigenCrudo}' no es válido.`,
        canales_soportados: [
          "Guardia_Emergencias",
          "Consultorio_Externo",
          "Laboratorio",
          "Farmacia",
          "Portal_Paciente",
          "Otro",
        ],
      },
      { status: 422 },
    );
  }

  try {
    const contenido = new Uint8Array(await archivo.arrayBuffer());
    const { tipoDetectado, tamanoBytes } = validarArchivo(
      archivo.name,
      archivo.type,
      contenido,
    );

    const documentoId = generarDocumentoId();
    const recibidoEn = new Date().toISOString();

    const metadato: MetadatoDocumento = {
      documento_id: documentoId,
      canal_origen: canalOrigen,
      tipo_archivo_detectado: tipoDetectado,
      tamano_bytes: tamanoBytes,
      recibido_en: recibidoEn,
      nombre_original: archivo.name,
    };
    const formato = tipoDetectado === "JSON"
      ? { extension: "json", contentType: "application/json" }
      : formatoOriginal(contenido);
    const almacenamiento = await persistirDocumentoRecibido({
      contenido, ...formato, metadato,
    });

    const resultado: ResultadoIngesta = {
      status: "recibido",
      documento_id: documentoId,
      tipo_archivo_detectado: tipoDetectado,
      tamano_bytes: tamanoBytes,
      canal_origen: canalOrigen,
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
        {
          status: "rechazado",
          detalle: error.message,
          formatos_soportados: ["PDF", "IMAGEN", "JSON"],
        },
        { status: 415 },
      );
    }
    if (error instanceof ArchivoInconsistenteError) {
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
    console.error("Error inesperado en /api/ingest/file:", error);
    return NextResponse.json(
      { status: "rechazado", detalle: "Error interno al procesar el archivo." },
      { status: 500 },
    );
  }
}
