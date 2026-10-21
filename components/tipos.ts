import type { AlmacenamientoOci, JsonFlujo } from "@/lib/resultado-flujo";
export type Resultado = {
  ok: boolean;
  body: unknown;
  clasificacion?: Resultado;
  extraccion?: Resultado;
  enrutamiento?: Resultado;
  almacenamiento_oci?: AlmacenamientoOci;
  json_final?: JsonFlujo;
};

/** Etapa del flujo que se está ejecutando en este momento. */
export type Fase =
  | "reposo"
  | "ingesta"
  | "clasificacion"
  | "extraccion"
  | "enrutamiento"
  | "almacenamiento"
  | "listo"
  | "error";

/** Lee un cuerpo de respuesta desconocido como un objeto parcial. */
export function leer<T extends object>(cuerpo: unknown): Partial<T> {
  return cuerpo && typeof cuerpo === "object" ? (cuerpo as Partial<T>) : {};
}
