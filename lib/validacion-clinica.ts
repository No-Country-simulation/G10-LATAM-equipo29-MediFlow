import Ajv, { type ErrorObject } from "ajv";
import { ESQUEMA_CLINICO, VERSION_ESQUEMA_CLINICO, type DatosClinicos } from "./esquema-clinico";

export interface ErrorEstructura { ruta: string; regla: string; mensaje: string }
export interface ValidacionEstructural {
  valido: boolean;
  estado: "valido" | "invalido";
  alcance: "estructura_y_tipos";
  version_esquema: string;
  total_errores: number;
  errores: ErrorEstructura[];
}
const ajv = new Ajv({ strict: true, allErrors: true, coerceTypes: false, useDefaults: false,
  removeAdditional: false, verbose: false });
const comprobar = ajv.compile<DatosClinicos>(ESQUEMA_CLINICO);
const mensajes: Record<string, string> = {
  required: "Falta un campo obligatorio; use null si el dato no consta y el campo lo permite.",
  type: "El tipo del valor no corresponde al esquema.",
  additionalProperties: "El objeto contiene campos no permitidos.",
  minLength: "El texto no puede estar vacío; use null si el dato no consta.",
  pattern: "El texto no puede contener únicamente espacios.",
  minimum: "El número está por debajo del mínimo permitido.",
};
function resumir(error: ErrorObject): ErrorEstructura {
  // No devolver valores ni nombres de propiedades desconocidas aportados por el modelo.
  const campo = error.keyword === "required" ? String(error.params.missingProperty).replace(/~/g, "~0").replace(/\//g, "~1") : null;
  return { ruta: `${error.instancePath}${campo ? `/${campo}` : ""}` || "/",
    regla: error.keyword, mensaje: mensajes[error.keyword] ?? "El valor no cumple el esquema." };
}
function resultado(errores: ErrorEstructura[]): ValidacionEstructural {
  return { valido: errores.length === 0, estado: errores.length ? "invalido" : "valido",
    alcance: "estructura_y_tipos", version_esquema: VERSION_ESQUEMA_CLINICO,
    total_errores: errores.length, errores: errores.slice(0, 50) };
}
export function validarDatosClinicos(datos: unknown): ValidacionEstructural {
  const valido = comprobar(datos);
  return resultado(valido ? [] : (comprobar.errors ?? []).map(resumir));
}
export function validacionJsonInvalido(): ValidacionEstructural {
  return resultado([{ ruta: "/", regla: "json", mensaje: "La respuesta no contiene un JSON con sintaxis válida." }]);
}
