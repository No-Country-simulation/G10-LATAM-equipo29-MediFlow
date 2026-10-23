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
  prioridad_urgencia?: { estado: "no_evaluada"; nivel: "NO_DETERMINADA"; urgente: null };
  decision_enrutamiento?: { destino_principal: string; requiere_auditoria_humana: boolean;
    justificacion_enrutamiento: string; notificacion_generada: null; estado: "pendiente_entrega" };
  extraccion?: Record<string, unknown>;
  enrutamiento?: Record<string, unknown>;
  almacenamiento_oci?: AlmacenamientoOci;
}
