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

type ClienteStorage = Pick<
  ObjectStorageClient,
  "putObject" | "deleteObject"
>;

type Conexion = {
  cliente: ClienteStorage;
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
  obtenerConexion: () => Conexion = obtenerConexionOci,
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