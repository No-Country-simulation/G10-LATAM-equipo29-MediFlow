import { clasificarDocumento, ErrorClasificacion, type CategoriaDocumento, type EntradaClasificacion } from "./clasificacion";
import { extraerDocumento, ErrorExtraccion } from "./extraccion";
import { revisionPorValidacion } from "./decision-enrutamiento";

export type DocumentoProcesable = EntradaClasificacion & { documento_id: string; categoria?: CategoriaDocumento };

/** Etapas internas del servidor: reciben los bytes del original leído desde OCI. */
export async function clasificarOriginal(documento: DocumentoProcesable): Promise<Response> {
  try {
    const clasificacion = await clasificarDocumento(documento);
    return Response.json({ status: "clasificado", documento_id: documento.documento_id,
      ...clasificacion, clasificado_en: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ErrorClasificacion) return Response.json({ status: "rechazado", detalle: error.message }, { status: error.status });
    throw error;
  }
}

export async function extraerOriginal(documento: DocumentoProcesable): Promise<Response> {
  try {
    const extraccion = await extraerDocumento(documento, undefined, documento.categoria);
    return Response.json({ status: "extraido", documento_id: documento.documento_id,
      ...extraccion, extraido_en: new Date().toISOString() });
  } catch (error) {
    if (error instanceof ErrorExtraccion && error.validacion) {
      return Response.json({ status: "revision_humana", documento_id: documento.documento_id,
        validacion: error.validacion, ...revisionPorValidacion() });
    }
    if (error instanceof ErrorExtraccion || error instanceof ErrorClasificacion) {
      return Response.json({ status: "rechazado", detalle: error.message }, { status: error.status });
    }
    throw error;
  }
}
