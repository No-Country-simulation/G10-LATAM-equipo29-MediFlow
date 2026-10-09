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
App Router sí es 100% nativo de Vercel: los _Route Handlers_ usan la Web
API `Request`/`Response` estándar y `request.formData()` para manejar
`multipart/form-data` sin librerías adicionales (`formidable`, `busboy`,
etc.).

## Estructura

```
app/
  page.tsx                    → pantalla de envío (React)
  api/ingest/file/route.ts    → POST — sube PDF, IMAGEN o JSON (multipart/form-data)
  api/ingest/json/route.ts    → POST — envía JSON/texto (application/json)
  api/ingest/salud/route.ts   → GET  — healthcheck
  api/classify/route.ts       → POST — clasifica por categoría un documento ya ingerido (Gemini)
lib/
  types.ts                    → enums, esquema Zod, contrato ResultadoIngesta
  validators.ts                → validación en 3 capas (extensión + MIME + firma binaria)
  storage.ts                    → persistencia real con el SDK de OCI Object Storage
  clasificacion.ts              → clasificación multimodal con Gemini (categorías, prompt, validación)
```

## Ejecutar localmente

```bash
npm install
# Copiar .env.example a .env.local y completar configuración OCI (ver abajo).
npm run dev
# abre http://localhost:3000
```

## Desplegar en Vercel

```bash
npm i -g vercel   # si no lo tenés
vercel             # sigue el flujo interactivo (o conecta el repo desde vercel.com)
```

Configurar las variables de `.env.example` como variables del servidor en
Vercel. No usar el prefijo `NEXT_PUBLIC_`. No hay almacenamiento temporal ni
modo demo: sin configuración OCI, las cargas devuelven `503`.

## Configurar OCI Object Storage

Requiere Node.js >=20.9.0 y un bucket privado existente llamado
`mediflow-documentos-clinicos`. Esta integración no crea buckets ni políticas IAM.

1. Copiar `.env.example` a `.env.local`, si todavía no existe.
2. Completar `OCI_REGION` y `OCI_NAMESPACE`.
3. Elegir autenticación:
   - `OCI_AUTH_MODE=api_key`: completar `OCI_TENANCY_OCID`, `OCI_USER_OCID`,
     `OCI_FINGERPRINT` y `OCI_PRIVATE_KEY` (PEM completo). La clave pública
     correspondiente debe estar registrada como API Key del usuario OCI.
     `OCI_PRIVATE_KEY_PASSPHRASE` es opcional. La clave admite saltos reales
     entre comillas o secuencias literales `\n`.
   - `OCI_AUTH_MODE=config_file`: usar el archivo local `~/.oci/config`, o
     `OCI_CONFIG_FILE` para otra ruta; `OCI_CONFIG_PROFILE` selecciona el perfil
     (por defecto `DEFAULT`). En este modo no se requieren variables de API key.
4. El usuario OCI debe tener permisos de creación de objetos en ese bucket y
   eliminación para revertir metadatos cuando una carga es rechazada. Limitar
   las políticas al bucket y compartimento correspondientes.
5. Reiniciar `npm run dev` después de cambiar la configuración.

`.env.local`, archivos PEM y claves están excluidos de Git. Nunca pegar claves
privadas en el código, README ni respuestas de la API. La configuración se carga
en el servidor, bajo demanda; la compilación no necesita credenciales.

## Organización de los objetos recibidos

```text
mediflow-documentos-clinicos/
└── recibidos/2026/09/DOC-CLIN-2026-1U0FNJ/
    ├── DOC-CLIN-2026-1U0FNJ.jpg
    └── DOC-CLIN-2026-1U0FNJ.metadata.json
```

Año y mes se toman de la fecha de recepción en UTC, no del identificador.
El archivo binario conserva exactamente sus bytes; extensión y MIME se derivan
de su firma validada (JPEG se normaliza a `.jpg` y TIFF a `.tiff`). El nombre
original se guarda únicamente en los metadatos. Para JSON/texto se conserva
el cuerpo JSON original de la petición, sin reformatearlo, como `<id>.json`.
El ID generado para una petición JSON sin identificador queda en los metadatos
y en la respuesta; no se modifica el original para insertarlo.

`<documento_id>.metadata.json` utiliza la misma estructura para archivos y JSON/texto:
`documento_id`, `canal_origen`, `tipo_archivo_detectado`, `tamano_bytes`,
`recibido_en`, `nombre_original` y `almacenamiento_oci`, que contiene `bucket`
y `ruta_objeto`. No incluye `content_type` ni `sha256`.

### Organización provisional de prefijos en OCI

El bucket `mediflow-documentos-clinicos` se organizará con los siguientes prefijos:

| Prefijo       | Contenido previsto                                                | Estado                                           |
| ------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| `recibidos/`  | Documentos originales y metadatos de recepción.                   | Implementado                                     |
| `procesados/` | Resultados de clasificación y extracción vinculados al documento. | Clasificación implementada; extracción pendiente |
| `auditoria/`  | Registros de revisiones y decisiones humanas.                     | Pendiente de implementación                      |
| `errores/`    | Detalles de fallos de procesamiento vinculados al documento.      | Pendiente de implementación                      |

Esta distribución es una propuesta de organización para las siguientes etapas.
Solo se utiliza `recibidos/` actualmente; los demás prefijos se incorporarán cuando
existan los procesos que generen su contenido. En OCI son prefijos de los nombres
de los objetos, por lo que no es necesario crear carpetas vacías previamente.

El original permanecerá en `recibidos/`. Las etapas posteriores generarán archivos
separados, relacionados mediante `documento_id`, sin mover ni modificar el original.
El estado del procesamiento se registrará explícitamente cuando se implemente el
seguimiento; no se deducirá únicamente del prefijo donde se encuentre el documento.

### Confirmación, duplicados y fallos parciales

La API devuelve `201` únicamente tras confirmar ambas escrituras. Se reserva
primero `<documento_id>.metadata.json` mediante `If-None-Match: *` y después se escribe el
original con la misma condición. Reutilizar un ID en el mismo período de
recepción devuelve `409`, incluso si cambia el formato. No hay un índice global:
el mismo ID enviado en otro mes puede crear otra carpeta. Los IDs generados
usan un sufijo aleatorio de exactamente 6 caracteres alfanuméricos en mayúsculas,
por ejemplo `DOC-CLIN-2026-1D5E63`. Los IDs suministrados en la entrada JSON deben
respetar ese mismo formato. Un conflicto devuelve `409` sin sobrescribir objetos.

Las dos escrituras no son una transacción. Si OCI rechaza definitivamente el
original, se intenta eliminar solo la reserva de esta operación, condicionada
por su ETag. Ante timeout o error de servidor, se conserva la reserva porque
el original podría haberse escrito. No se realizan reintentos automáticos de
escritura. Una interrupción o fallo de limpieza puede dejar objetos parciales:
se deben comprobar original y metadata antes de reintentar; no se devuelve
éxito y se registra solo el ID para conciliación. Esta versión no incluye
conciliación automática ni debe activar procesamiento por la sola aparición
de `<documento_id>.metadata.json`.

Errores: `503` configuración ausente/inválida; `502` fallo o resultado incierto
de OCI; `409` conflicto. No se exponen mensajes internos del SDK ni credenciales.
`/api/ingest/salud` comprueba la aplicación, no la conexión con OCI.

## Verificación

```bash
npm test
npm run typecheck
npm run build
```

Las pruebas usan un cliente OCI simulado y no suben información real.
Para una comprobación real, configurar credenciales, cargar un documento
sintético desde la interfaz y verificar en la consola OCI ambos objetos,
el contenido original, `document_id`, tamaño y SHA-256 del metadata.

## Límite importante de Vercel

Las funciones serverless en el plan Hobby tienen un límite de **~4.5 MB**
de body por request. Para estudios de imagen más pesados, la ruta
recomendada es subir directo a OCI Object Storage desde el cliente con
una URL prefirmada, y que esta API solo reciba la metadata — está fuera
del alcance del MVP pero conviene tenerlo en cuenta para la demo.

## Endpoints

| Método | Ruta                   | Descripción                                                                                                                                                                         |
| ------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/ingest/file`     | `multipart/form-data`: `archivo` (File), `canal_origen` (opcional)                                                                                                                  |
| POST   | `/api/ingest/json`     | `application/json`: `{ tipo_archivo, documento_texto, canal_origen? }`                                                                                                              |
| GET    | `/api/ingest/salud`    | Healthcheck                                                                                                                                                                         |
| POST   | `/api/ingest/classify` | `application/json`: `{ documento_id, ruta_objeto }` — clasifica el documento con Gemini                                                                                             |
| POST   | `/api/ingest/route`    | `application/json`: `{ documento_id, categoria, confianza, requiere_revision_humana, canal_origen?, destinos_no_disponibles? }` — aplica grafo de decisión, enrutamiento y fallback |

### Ejemplo de respuesta exitosa (`201`)

```json
{
  "status": "recibido",
  "documento_id": "DOC-CLIN-2026-A1B2C3",
  "tipo_archivo_detectado": "PDF",
  "tamano_bytes": 48213,
  "canal_origen": "Guardia_Emergencias",
  "recibido_en": "2026-09-26T21:27:25.262Z",
  "almacenamiento_oci": {
    "bucket": "mediflow-documentos-clinicos",
    "ruta_objeto": "recibidos/2026/09/DOC-CLIN-2026-A1B2C3/DOC-CLIN-2026-A1B2C3.pdf"
  }
}
```

### Ejemplo de rechazo (`415`)

```json
{
  "status": "rechazado",
  "detalle": "El contenido del archivo no corresponde a ningún formato soportado (PDF, IMAGEN, JSON).",
  "formatos_soportados": ["PDF", "IMAGEN", "JSON"]
}
```

## Clasificación con Gemini

`POST /api/ingest/classify` toma la salida de la ingesta (`documento_id` y
`almacenamiento_oci.ruta_objeto`), lee el original desde OCI Object Storage,
lo envía a Gemini (multimodal: PDF, imagen o texto/JSON) y devuelve la categoría.
La pantalla de recepción lo invoca automáticamente después de cada ingesta exitosa.

Configuración (solo servidor, nunca `NEXT_PUBLIC_`):

| Variable         | Descripción                                                 |
| ---------------- | ----------------------------------------------------------- |
| `GEMINI_API_KEY` | Clave de Google AI Studio. Sin ella, la API devuelve `503`. |
| `GEMINI_MODEL`   | Opcional. Por defecto `gemini-3.5-flash-lite`.              |

Categorías (`CATEGORIAS_DOCUMENTO` en `lib/clasificacion.ts`; para agregar o
cambiar una basta editar ese arreglo y su descripción, el prompt se genera de ahí):
`RECETA_MEDICA`, `RESULTADO_LABORATORIO`, `INFORME_IMAGENOLOGIA`,
`HISTORIA_CLINICA`, `RESUMEN_ALTA`, `ORDEN_MEDICA`, `CERTIFICADO_MEDICO`,
`CONSENTIMIENTO_INFORMADO`, `DOCUMENTO_ADMINISTRATIVO` y `OTRO`.

Ejemplo de respuesta (`200`):

```json
{
  "status": "clasificado",
  "documento_id": "DOC-CLIN-2026-A1B2C3",
  "categoria": "RECETA_MEDICA",
  "confianza": 0.93,
  "justificacion": "Contiene prescripción de medicamentos con dosis.",
  "requiere_revision_humana": false,
  "modelo": "gemini-3.5-flash-lite",
  "clasificado_en": "2026-10-05T21:30:00.000Z",
  "resultado_oci": {
    "bucket": "mediflow-documentos-clinicos",
    "ruta_objeto": "procesados/2026/09/DOC-CLIN-2026-A1B2C3/DOC-CLIN-2026-A1B2C3.clasificacion.json"
  }
}
```

- La salida de Gemini se fuerza a JSON con esquema y se vuelve a validar con
  Zod; una respuesta inválida devuelve `502` sin exponer su contenido.
- `requiere_revision_humana` es `true` si `confianza < 0.7` o la categoría es
  `OTRO` (casos ambiguos para el flujo con revisión humana).
- `ruta_objeto` debe ser exactamente el original recibido de ese `documento_id`
  (`recibidos/AAAA/MM/<id>/<id>.<ext>`); cualquier otra ruta se rechaza con `422`
  antes de tocar OCI, para no leer objetos arbitrarios del bucket.
- El resultado se guarda en `procesados/AAAA/MM/<id>/<id>.clasificacion.json`.
  El original no se modifica. Reclasificar sobrescribe ese archivo.
- El contenido del documento se trata como datos: el prompt indica ignorar
  instrucciones incluidas dentro del documento.
- Errores: `404` el original no existe; `413` documento demasiado grande
  (máximo 14 MiB para enviarlo a Gemini); `415` TIFF (Gemini no lo admite;
  convertir a PDF/PNG/JPEG); `502` fallo de Gemini u OCI; `503` configuración ausente.
- El documento se envía a la API de Gemini. Usar solo documentos sintéticos
  hasta definir las condiciones de privacidad para datos reales de pacientes.

## Siguiente paso en el pipeline

Las ubicaciones persistentes se devuelven en `almacenamiento_oci`.

Cubre **ingesta + validación + persistencia OCI + clasificación por LLM**. Las
salidas (`documento_id`, `almacenamiento_oci.ruta_objeto`, `categoria`,
`requiere_revision_humana`) son el punto de entrada de la siguiente etapa:
extracción estructurada → grafo de decisión condicional → enrutamiento.
