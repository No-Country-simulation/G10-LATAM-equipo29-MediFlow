import { createHash } from "node:crypto";

import {
  ConfigFileAuthenticationDetailsProvider,
  NoRetryConfigurationDetails,
  Region,
  SimpleAuthenticationDetailsProvider,
} from "oci-common";

import { ObjectStorageClient } from "oci-objectstorage";

import { DOC_ID_PATTERN, type MetadatoDocumento } from "./types";

export const BUCKET_DOCUMENTOS = "mediflow-documentos-clinicos";

export class ErrorAlmacenamiento extends Error {
  constructor(public readonly status: number, mensaje: string) {
    super(mensaje);
  }
}

type ClienteEscritura = Pick<
  ObjectStorageClient,
  "putObject" | "deleteObject"
>;

type ClienteLectura = Pick<ObjectStorageClient, "getObject">;

type ClienteStorage = ClienteEscritura & ClienteLectura;

type Conexion<Cliente = ClienteStorage> = {
  cliente: Cliente;
  namespace: string;
};

let conexion: Conexion | undefined;

function requerida(nombre: string): string {
  const valor = process.env[nombre]?.trim();

  if (!valor) {
    throw new ErrorAlmacenamiento(
      503,
      `Falta configurar la variable ${nombre}.`,
    );
  }

  return valor;
}

/**
 * Inicialización diferida: compila sin credenciales
 * y nunca usa disco como fallback.
 */
export function obtenerConexionOci(): Conexion {
  if (conexion) return conexion;

  try {
    const namespace = requerida("OCI_NAMESPACE");

    const region = Region.fromRegionId(
      requerida("OCI_REGION"),
    );

    const modo = process.env.OCI_AUTH_MODE ?? "api_key";

    if (modo !== "api_key" && modo !== "config_file") {
      throw new Error(`Modo OCI inválido: ${modo}`);
    }

    const provider =
      modo === "config_file"
        ? new ConfigFileAuthenticationDetailsProvider(
            process.env.OCI_CONFIG_FILE || undefined,
            process.env.OCI_CONFIG_PROFILE || "DEFAULT",
          )
        : new SimpleAuthenticationDetailsProvider(
            requerida("OCI_TENANCY_OCID"),
            requerida("OCI_USER_OCID"),
            requerida("OCI_FINGERPRINT"),
            requerida("OCI_PRIVATE_KEY").replace(/\\n/g, "\n"),
            process.env.OCI_PRIVATE_KEY_PASSPHRASE || null,
            region,
          );

    const cliente = new ObjectStorageClient({
      authenticationDetailsProvider: provider,
    });

    cliente.region = region;

    conexion = {
      cliente,
      namespace,
    };

    return conexion;
  } catch (error) {
    console.error("ERROR OCI REAL:", error);

    throw new ErrorAlmacenamiento(
      503,
      error instanceof Error
        ? `OCI: ${error.message}`
        : "El almacenamiento OCI no está configurado correctamente.",
    );
  }
}

/**
 * Invocar después de validarArchivo:
 * nombre y MIME se derivan de la firma validada.
 */
export function formatoOriginal(
  bytes: Uint8Array,
): { extension: string; contentType: string } {
  if (bytes[0] === 0x25) {
    return { extension: "pdf", contentType: "application/pdf" };
  }

  if (bytes[0] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }

  if (bytes[0] === 0x89) {
    return { extension: "png", contentType: "image/png" };
  }

  if (bytes[0] === 0x49 || bytes[0] === 0x4d) {
    return { extension: "tiff", contentType: "image/tiff" };
  }

  if (bytes[0] === 0x52) {
    return { extension: "webp", contentType: "image/webp" };
  }

  throw new Error("Formato sin validar");
}

interface EntradaPersistencia {
  contenido: Uint8Array | string;
  extension: string;
  contentType: string;
  metadato: MetadatoDocumento;
}

export async function persistirDocumentoRecibido(
  entrada: EntradaPersistencia,
  obtenerConexion: () => Conexion<ClienteEscritura> = obtenerConexionOci,
) {
  const { metadato, extension, contentType } = entrada;

  if (
    !DOC_ID_PATTERN.test(metadato.documento_id) ||
    !/^(pdf|jpg|png|tiff|webp|json)$/.test(extension)
  ) {
    throw new Error("Identificador o extensión inválidos para almacenamiento");
  }

  const fecha = new Date(metadato.recibido_en);

  if (Number.isNaN(fecha.getTime())) {
    throw new Error("Fecha de recepción inválida");
  }

  const anio = fecha.getUTCFullYear();
  const mes = String(fecha.getUTCMonth() + 1).padStart(2, "0");

  const prefijo =
    `recibidos/${anio}/${mes}/${metadato.documento_id}`;

  const rutaObjeto =
    `${prefijo}/${metadato.documento_id}.${extension}`;

  const rutaMetadatos =
    `${prefijo}/${metadato.documento_id}.metadata.json`;

  const contenido = Buffer.from(entrada.contenido);

  const almacenamiento = {
    bucket: BUCKET_DOCUMENTOS,
    ruta_objeto: rutaObjeto,
  };

  const metadata = {
    ...metadato,
    tamano_bytes: contenido.byteLength,
    almacenamiento_oci: almacenamiento,
  };

  const { cliente, namespace } = obtenerConexion();

  const base = {
    namespaceName: namespace,
    bucketName: BUCKET_DOCUMENTOS,
    retryConfiguration: NoRetryConfigurationDetails,
  };

  /**
   * Reservar la carpeta con <documento_id>.metadata.json
   * impide sobrescrituras entre formatos.
   */
  let etagMetadata: string | undefined;

  try {
    const cuerpoMetadata = Buffer.from(
      JSON.stringify(metadata, null, 2),
    );

    const reserva = await cliente.putObject({
      ...base,
      objectName: rutaMetadatos,
      putObjectBody: cuerpoMetadata,
      contentLength: cuerpoMetadata.byteLength,
      contentType: "application/json",
      ifNoneMatch: "*",
    });

    etagMetadata = reserva.eTag;

    await cliente.putObject({
      ...base,
      objectName: rutaObjeto,
      putObjectBody: contenido,
      contentLength: contenido.byteLength,
      contentType,
      contentMD5: createHash("md5")
        .update(new Uint8Array(contenido))
        .digest("base64"),
      ifNoneMatch: "*",
    });
  } catch (error) {
    const codigo = (error as { statusCode?: number })?.statusCode;

    /**
     * Solo revertir un rechazo definitivo.
     * Un timeout/5xx puede ocultar una escritura exitosa.
     */
    if (
      etagMetadata &&
      codigo &&
      codigo >= 400 &&
      codigo < 500 &&
      codigo !== 408
    ) {
      try {
        await cliente.deleteObject({
          ...base,
          objectName: rutaMetadatos,
          ifMatch: etagMetadata,
        });
      } catch {
        console.error(
          "OCI: revisar carga incompleta",
          metadato.documento_id,
        );
      }
    } else if (!codigo || codigo >= 500 || codigo === 408) {
      console.error(
        "OCI: verificar resultado incierto de carga",
        metadato.documento_id,
      );
    }

    if (codigo === 412) {
      throw new ErrorAlmacenamiento(
        409,
        "Ya existe una carga con este identificador en el período de recepción.",
      );
    }

    throw new ErrorAlmacenamiento(
      502,
      "No se pudo confirmar la persistencia del documento en OCI.",
    );
  }

  return almacenamiento;
}
/**
 * Ruta de un original recibido:
 * recibidos/AAAA/MM/<id>/<id>.<extensión>
 * El ID de la carpeta y el del archivo deben coincidir.
 */
const RUTA_RECIBIDO =
  /^recibidos\/(\d{4})\/(\d{2})\/(DOC-CLIN-\d{4}-[A-Z0-9]{6})\/(DOC-CLIN-\d{4}-[A-Z0-9]{6})\.(pdf|jpg|png|tiff|webp|json)$/;

export interface RutaRecibido {
  anio: string;
  mes: string;
  extension: string;
}

/**
 * Valida que `rutaObjeto` apunte al original de `documentoId`.
 * Evita que la API lea objetos arbitrarios del bucket.
 */
export function analizarRutaRecibido(
  documentoId: string,
  rutaObjeto: string,
): RutaRecibido {
  const coincidencia = RUTA_RECIBIDO.exec(rutaObjeto);

  if (
    !coincidencia ||
    coincidencia[3] !== documentoId ||
    coincidencia[4] !== documentoId
  ) {
    throw new ErrorAlmacenamiento(
      422,
      "ruta_objeto no corresponde al original recibido de este documento_id.",
    );
  }

  return {
    anio: coincidencia[1],
    mes: coincidencia[2],
    extension: coincidencia[5],
  };
}

async function leerFlujo(
  flujo: unknown,
  limiteBytes: number,
): Promise<Uint8Array> {
  const partes: Uint8Array[] = [];
  let total = 0;

  const acumular = (parte: Uint8Array) => {
    total += parte.byteLength;

    if (total > limiteBytes) {
      throw new ErrorAlmacenamiento(
        413,
        "El documento almacenado excede el tamaño máximo permitido.",
      );
    }

    partes.push(parte);
  };

  if (flujo && typeof (flujo as ReadableStream).getReader === "function") {
    const lector = (flujo as ReadableStream<Uint8Array>).getReader();

    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      acumular(value);
    }
  } else {
    for await (const parte of flujo as AsyncIterable<Uint8Array | string>) {
      acumular(typeof parte === "string" ? Buffer.from(parte) : parte);
    }
  }

  return Buffer.concat(partes);
}

/**
 * Lee el original recibido desde OCI. No modifica nada en el bucket.
 */
export async function leerDocumentoRecibido(
  documentoId: string,
  rutaObjeto: string,
  limiteBytes: number,
  obtenerConexion: () => Conexion<ClienteLectura> = obtenerConexionOci,
): Promise<{ contenido: Uint8Array; extension: string; ruta: RutaRecibido }> {
  const ruta = analizarRutaRecibido(documentoId, rutaObjeto);
  const { cliente, namespace } = obtenerConexion();

  try {
    const respuesta = await cliente.getObject({
      namespaceName: namespace,
      bucketName: BUCKET_DOCUMENTOS,
      objectName: rutaObjeto,
      retryConfiguration: NoRetryConfigurationDetails,
    });

    if (respuesta.contentLength > limiteBytes) {
      throw new ErrorAlmacenamiento(
        413,
        "El documento almacenado excede el tamaño máximo permitido.",
      );
    }

    const contenido = await leerFlujo(respuesta.value, limiteBytes);

    return { contenido, extension: ruta.extension, ruta };
  } catch (error) {
    if (error instanceof ErrorAlmacenamiento) throw error;

    const codigo = (error as { statusCode?: number })?.statusCode;

    if (codigo === 404) {
      throw new ErrorAlmacenamiento(
        404,
        "No existe un documento recibido con esa ruta.",
      );
    }

    console.error("OCI: fallo al leer documento", documentoId);

    throw new ErrorAlmacenamiento(
      502,
      "No se pudo leer el documento desde OCI.",
    );
  }
}

/**
 * Guarda el resultado de una etapa posterior en `procesados/`, junto al
 * mismo AAAA/MM del original. El original no se toca. Se permite
 * sobrescribir para poder reclasificar un documento.
 */
export async function persistirResultadoProcesado(
  documentoId: string,
  ruta: RutaRecibido,
  sufijo: "clasificacion",
  resultado: unknown,
  obtenerConexion: () => Conexion<Pick<ObjectStorageClient, "putObject">> =
    obtenerConexionOci,
) {
  const rutaObjeto =
    `procesados/${ruta.anio}/${ruta.mes}/${documentoId}/` +
    `${documentoId}.${sufijo}.json`;

  const cuerpo = Buffer.from(JSON.stringify(resultado, null, 2));
  const { cliente, namespace } = obtenerConexion();

  try {
    await cliente.putObject({
      namespaceName: namespace,
      bucketName: BUCKET_DOCUMENTOS,
      objectName: rutaObjeto,
      putObjectBody: cuerpo,
      contentLength: cuerpo.byteLength,
      contentType: "application/json",
      retryConfiguration: NoRetryConfigurationDetails,
    });
  } catch {
    console.error("OCI: no se pudo guardar resultado", documentoId, sufijo);

    throw new ErrorAlmacenamiento(
      502,
      "No se pudo confirmar el guardado del resultado en OCI.",
    );
  }

  return { bucket: BUCKET_DOCUMENTOS, ruta_objeto: rutaObjeto };
}
