# MediFlow — Servicio de Ingesta (Next.js, listo para Vercel)

Cubre el requisito del MVP del hackathon:

> "1. Ingerir el documento clínico en los formatos soportados (PDF / Imagen / JSON)"

Recepción y **validación estricta** de documentos clínicos antes de que
entren al grafo de decisión (clasificación → extracción → enrutamiento).
Formatos aceptados: **PDF, IMAGEN (jpg/png/tiff/webp) y JSON/TEXTO**.
Cualquier otro formato se rechaza con `415`, incluso si el nombre del
archivo o el `Content-Type` intentan simular uno soportado (ver
`lib/validators.ts`).

## Por qué Next.js y no FastAPI + Streamlit

Vercel ejecuta **funciones serverless**: cada request instancia (y luego
destruye) el proceso. Streamlit necesita un proceso persistente con
WebSockets abierto, lo que **no es compatible con Vercel**. Next.js con
App Router sí es 100% nativo de Vercel: los *Route Handlers* usan la Web
API `Request`/`Response` estándar y `request.formData()` para manejar
`multipart/form-data` sin librerías adicionales (`formidable`, `busboy`,
etc.).

## Estructura

```
app/
  page.tsx                    → pantalla de envío (React)
  api/ingest/file/route.ts    → POST — sube PDF o IMAGEN (multipart/form-data)
  api/ingest/json/route.ts    → POST — envía JSON/texto (application/json)
  api/ingest/salud/route.ts   → GET  — healthcheck
lib/
  types.ts                    → enums, esquema Zod, contrato ResultadoIngesta
  validators.ts                → validación en 3 capas (extensión + MIME + firma binaria)
  storage.ts                    → stub de persistencia (TODO: reemplazar por OCI SDK)
```

## Ejecutar localmente

```bash
npm install
npm run dev
# abre http://localhost:3000
```

## Desplegar en Vercel

```bash
npm i -g vercel   # si no lo tenés
vercel             # sigue el flujo interactivo (o conecta el repo desde vercel.com)
```

No requiere variables de entorno para funcionar en modo demo (usa `/tmp`
como almacenamiento temporal). Cuando conectes OCI Object Storage, agregá
las credenciales como Environment Variables del proyecto en Vercel y
reemplazá `lib/storage.ts` por el SDK real (ver el comentario `TODO(OCI)`
dentro del archivo).

## Límite importante de Vercel

Las funciones serverless en el plan Hobby tienen un límite de **~4.5 MB**
de body por request. Para estudios de imagen más pesados, la ruta
recomendada es subir directo a OCI Object Storage desde el cliente con
una URL prefirmada, y que esta API solo reciba la metadata — está fuera
del alcance del MVP pero conviene tenerlo en cuenta para la demo.

## Endpoints

| Método | Ruta                  | Descripción                                  |
|--------|-----------------------|-----------------------------------------------|
| POST   | `/api/ingest/file`    | `multipart/form-data`: `archivo` (File), `canal_origen` (opcional) |
| POST   | `/api/ingest/json`    | `application/json`: `{ tipo_archivo, documento_texto, canal_origen? }` |
| GET    | `/api/ingest/salud`   | Healthcheck                                    |

### Ejemplo de respuesta exitosa (`201`)

```json
{
  "status": "recibido",
  "documento_id": "DOC-CLIN-2026-A1B2C3",
  "tipo_archivo_detectado": "PDF",
  "tamano_bytes": 48213,
  "canal_origen": "Guardia_Emergencias",
  "recibido_en": "2026-09-26T21:27:25.262Z",
  "ruta_objeto_temporal": "mediflow-documentos-clinicos/recibidos/DOC-CLIN-2026-A1B2C3_informe.pdf"
}
```

### Ejemplo de rechazo (`415`)

```json
{
  "status": "rechazado",
  "detalle": "El contenido del archivo no corresponde a ningún formato soportado (PDF, IMAGEN). Formatos aceptados: PDF, IMAGEN, JSON, TEXTO.",
  "formatos_soportados": ["PDF", "IMAGEN", "JSON", "TEXTO"]
}
```

## Siguiente paso en el pipeline

Este servicio solo cubre **ingesta + validación**. La salida
(`documento_id`, `ruta_objeto_temporal`) es el punto de entrada de la
siguiente etapa: clasificación por LLM → extracción estructurada → grafo
de decisión condicional → enrutamiento.
