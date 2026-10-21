import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const texto = z.string().min(1).regex(/\S/, "Debe contener texto o null").nullable();
// Solo contrato técnico. No evalúa la consistencia ni la corrección clínica.
export const ExtraccionModeloSchema = z.object({
  paciente: z.object({ nombre: texto, identificacion: texto, edad: z.number().finite().min(0).nullable(),
    unidad_edad: texto, fecha_nacimiento: texto, sexo: texto, contacto: texto }).strict(),
  profesionales: z.array(z.object({ nombre: texto, matricula: texto, especialidad: texto, rol: texto }).strict()),
  documento: z.object({ titulo: texto, fecha: texto, identificador: texto }).strict(),
  institucion: z.object({ nombre: texto, telefono: texto, direccion: texto,
    correo_electronico: texto, sitio_web: texto }).strict(),
  motivo_consulta: texto,
  antecedentes: z.array(z.object({ tipo: texto, descripcion: texto }).strict()),
  alergias: z.array(z.object({ sustancia: texto, reaccion: texto, estado: texto }).strict()),
  sintomas: z.array(z.object({ descripcion: texto, inicio: texto, evolucion: texto }).strict()),
  exploracion_fisica: texto,
  signos_vitales: z.array(z.object({ nombre: texto, valor: texto, unidad: texto, fecha: texto }).strict()),
  diagnosticos: z.array(z.object({ descripcion: texto, cie10: texto, estado: texto, tipo: texto }).strict()),
  medicamentos: z.array(z.object({ nombre: texto, concentracion: texto, presentacion: texto,
    dosis: texto, via: texto, frecuencia: texto, duracion: texto, cantidad: texto, indicaciones: texto, estado: texto }).strict()),
  estudios: z.array(z.object({ nombre: texto, estado: texto, fecha: texto, region_anatomica: texto,
    tecnica: texto, hallazgos: texto, conclusion: texto }).strict()),
  resultados_laboratorio: z.array(z.object({ prueba: texto, resultado: texto, unidad: texto,
    rango_referencia: texto, indicador: texto, muestra: texto, fecha: texto }).strict()),
  procedimientos: z.array(z.object({ nombre: texto, fecha: texto, descripcion: texto, resultado: texto }).strict()),
  evolucion_clinica: texto,
  indicaciones: z.array(texto),
  seguimiento: z.array(z.object({ descripcion: texto, fecha: texto, servicio: texto }).strict()),
  urgencia: z.object({ declarada: z.boolean().nullable(), descripcion: texto }).strict(),
}).strict();
export type DatosClinicos = z.infer<typeof ExtraccionModeloSchema>;

export const VERSION_ESQUEMA_CLINICO = "1.0";
export const ESQUEMA_CLINICO = zodToJsonSchema(ExtraccionModeloSchema, {
  target: "jsonSchema7", $refStrategy: "none",
});

// Gemini recibe solo el subconjunto de estructura y tipos compatible con el modelo.
// Las restricciones completas se aplican localmente con Ajv.
function paraGemini(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(paraGemini);
  if (valor && typeof valor === "object") return Object.fromEntries(
    Object.entries(valor).filter(([clave]) => !["$schema", "minimum", "minLength", "pattern"].includes(clave))
      .map(([clave, contenido]) => [clave, paraGemini(contenido)]),
  );
  return valor;
}
export const ESQUEMA_EXTRACCION = paraGemini(ESQUEMA_CLINICO) as Record<string, unknown>;