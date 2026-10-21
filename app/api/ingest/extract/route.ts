import { NextResponse } from "next/server";
import { ErrorClasificacion } from "@/lib/clasificacion";
import { extraerDocumento, ErrorExtraccion } from "@/lib/extraccion";
import { formatoOriginal } from "@/lib/storage";
import { DOC_ID_PATTERN } from "@/lib/types";
import { revisionPorValidacion } from "@/lib/decision-enrutamiento";
import { validarRecepcionArchivo as recibirArchivo } from "@/lib/recepcion-archivo";
import { validarRecepcionTexto as recibirTexto } from "@/lib/recepcion-texto";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let documentoIdValidado: string | undefined;
  try {
    // Reutiliza los controles de recepción. No se almacena ni se relee desde OCI.
    const multipart = request.headers.get("content-type")?.startsWith("multipart/form-data");
    const recepcion = await (multipart ? recibirArchivo : recibirTexto)(request.clone());
    if (!recepcion.ok) return recepcion;
    const metadatos = await recepcion.json();
    let documento_id: unknown;
    let contenido: Uint8Array;
    let extension: string;
    if (multipart) {
      const form = await request.formData();
      documento_id = form.get("documento_id");
      const archivo = form.get("archivo") as File; // Validado por recepción.
      contenido = new Uint8Array(await archivo.arrayBuffer());
      extension = metadatos.tipo_archivo_detectado === "JSON" ? "json" : formatoOriginal(contenido).extension;
    } else {
      contenido = new Uint8Array(await request.arrayBuffer());
      documento_id = JSON.parse(new TextDecoder().decode(contenido)).documento_id;
      extension = "json";
    }
    if (typeof documento_id !== "string" || !DOC_ID_PATTERN.test(documento_id)) {
      return NextResponse.json({ status: "rechazado", detalle: "Se requiere un documento_id válido." }, { status: 422 });
    }
    documentoIdValidado = documento_id;
    const extraccion = await extraerDocumento({ contenido, extension });
    return NextResponse.json({ status: "extraido", documento_id, ...extraccion, extraido_en: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ErrorExtraccion && error.validacion && documentoIdValidado) {
      return NextResponse.json({
        status: "revision_humana", documento_id: documentoIdValidado,
        validacion: error.validacion, ...revisionPorValidacion(),
      });
    }
    if (error instanceof ErrorExtraccion || error instanceof ErrorClasificacion) {
      return NextResponse.json({ status: "rechazado", detalle: error.message,
        ...(error instanceof ErrorExtraccion && error.validacion ? { validacion: error.validacion } : {}),
      }, { status: error.status });
    }
    console.error("Error inesperado en /api/ingest/extract");
    return NextResponse.json({ status: "rechazado", detalle: "Error interno al extraer el documento." }, { status: 500 });
  }
}

