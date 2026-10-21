/** Contrato compartido; sin SDK ni credenciales para poder usarlo en la interfaz. */
export type RutaFinal = "procesados/normales" | "procesados/urgentes" | "auditoria_humana" | "rechazados" | "errores";
export interface AlmacenamientoOci {
  bucket: string;
  ruta_objeto: string;
  status_backup: "exito" | "error" | "no_confirmado";
}
export interface JsonFlujo {
  ingesta: Record<string, unknown>;
  clasificacion?: Record<string, unknown>;
  extraccion?: Record<string, unknown>;
  enrutamiento?: Record<string, unknown>;
  almacenamiento_oci?: AlmacenamientoOci;
}
