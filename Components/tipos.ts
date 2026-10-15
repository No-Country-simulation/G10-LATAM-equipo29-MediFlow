export type Resultado = {
  ok: boolean;
  body: unknown;
  clasificacion?: Resultado;
  enrutamiento?: Resultado;
};

/** Etapa del flujo que se está ejecutando en este momento. */
export type Fase =
  | "reposo"
  | "ingesta"
  | "clasificacion"
  | "enrutamiento"
  | "listo"
  | "error";

/** Lee un cuerpo de respuesta desconocido como un objeto parcial. */
export function leer<T extends object>(cuerpo: unknown): Partial<T> {
  return cuerpo && typeof cuerpo === "object" ? (cuerpo as Partial<T>) : {};
}
