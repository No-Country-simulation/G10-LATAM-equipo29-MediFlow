# MediFlow — Servicio de Ingesta (Next.js, listo para Vercel)

Cubre el requisito del MVP del hackathon:

> "1. Ingerir el documento clínico en los formatos soportados (PDF / Imagen / JSON)"

Recepción y **validación estricta** de documentos clínicos antes de que
entren al grafo de decisión (clasificación → extracción → enrutamiento).
Formatos aceptados: **PDF, IMAGEN (jpg/png/webp) y JSON/TEXTO**.
PDF e imágenes admiten hasta **14 MiB (14 680 064 bytes)**, tanto en recepción como
en procesamiento. TIFF se rechaza en recepción, antes de guardar el original en OCI.
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
  api/ingest/classify/route.ts → POST — clasifica un documento ya ingerido (Gemini)
  api/ingest/extract/route.ts  → POST — extrae y valida entidades clínicas (Gemini)
lib/
  types.ts                    → enums, esquema Zod, contrato ResultadoIngesta
  validators.ts                → validación en 3 capas (extensión + MIME + firma binaria)
  storage.ts                    → persistencia real con el SDK de OCI Object Storage
  clasificacion.ts              → clasificación multimodal con Gemini (categorías, prompt, validación)
  extraccion.ts                → prompt, esquema clínico y reglas de consistencia documental
```

## Ejecutar localmente

```bash
npm install
# Copiar .env.example a .env.local y configurar OCI y GEMINI_API_KEY.
npm run dev
# abre http://localhost:3000
```

## Desplegar en Vercel

```bash
npm i -g vercel   # si no lo tenés
vercel             # sigue el flujo interactivo (o conecta el repo desde vercel.com)
```

Configurar las variables de `.env.example` como variables del servidor en
Vercel. No usar el prefijo `NEXT_PUBLIC_`. OCI está activo: se requieren credenciales para conservar el original y el JSON final.

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

## Organización de originales recibidos

```text
mediflow-documentos-clinicos/
└── recibidos/2026/09/DOC-CLIN-2026-1U0FNJ/
    ├── DOC-CLIN-2026-1U0FNJ.jpg
    └── DOC-CLIN-2026-1U0FNJ.metadata.json
```

Año y mes se toman de la fecha de recepción en UTC, no del identificador.
El archivo binario conserva exactamente sus bytes; extensión y MIME se derivan
de su firma validada (JPEG se normaliza a `.jpg`). El nombre
original se guarda únicamente en los metadatos. Para JSON/texto se conserva
el cuerpo JSON original de la petición, sin reformatearlo, como `<id>.json`.
El ID generado para una petición JSON sin identificador queda en los metadatos
y en la respuesta; no se modifica el original para insertarlo.

`<documento_id>.metadata.json` utiliza la misma estructura para archivos y JSON/texto:
`documento_id`, `canal_origen`, `tipo_archivo_detectado`, `tamano_bytes`,
`recibido_en`, `nombre_original` y `almacenamiento_oci`, que contiene `bucket`
y `ruta_objeto`. No incluye `content_type` ni `sha256`.

### Almacenamiento activo por resultado del flujo

En `/api/process`, después de clasificar y antes de extraer, se aplica la política
de ambigüedad. Una categoría específica con confianza mayor o igual al umbral
continúa. Una confianza inferior o categoría `OTRO` deriva a `auditoria_humana/`.
El umbral inicial es 0.85, configurable mediante `UMBRAL_CLASIFICACION` (0 a 1);
es independiente del score de confianza de extracción y requiere calibración con
documentos revisados. Una configuración inválida o fallo del modelo es un error técnico.

`clasificacion.evaluacion` registra `umbral`, `estado` y `motivos`. En una salida
ambigua, los bloques raíz `decision_enrutamiento` y `prioridad_urgencia` registran
la auditoría pendiente de entrega y prioridad `no_evaluada`, con `urgente: null`.
No se ejecutan ni se inventan extracción, validación, confianza o enrutamiento normal.
La revisión humana debe considerar la posible urgencia que aún no fue evaluada.
Los endpoints de etapas individuales siguen siendo herramientas independientes;
la política de interrupción pertenece al flujo completo `/api/process`.

La interfaz envía una sola solicitud a `POST /api/process`. El servidor coordina
recepción, clasificación, extracción, validación, confianza, prioridad, enrutamiento
normal y guardado final. Envía avances como NDJSON para mantener el indicador de etapas.
No acepta un JSON final calculado por el navegador ni una ruta de almacenamiento del cliente.

Después de confirmar la recepción, el servidor lee el original desde OCI una sola vez,
validando que la ruta corresponda al documento y respetando el límite de lectura.
Clasificación, extracción y cotejo de confianza utilizan esos mismos bytes descargados.
Si falla la lectura, el flujo termina por la ruta `errores/` y conserva el reporte
si OCI permite escribirlo; no utiliza el archivo de la solicitud como alternativa.

| Prefijo | Contenido |
| --- | --- |
| `recibidos/AAAA/MM/<id>/` | Original intacto y metadatos de recepción. |
| `procesados/normales/<id>.json` | Resultado normal, incluyendo asignación de cola. |
| `procesados/urgentes/<id>.json` | Resultado urgente y alerta preparada. |
| `auditoria_humana/<id>.json` | Validación inválida, confianza insuficiente o prioridad no evaluable. |
| `rechazados/<id>.json` | Rechazos de entrada/formato (errores HTTP 4xx, excepto 429). |
| `errores/<id>.json` | Fallos técnicos, proveedor o enrutamiento; conserva etapas completadas. |

Cada ejecución termina con un único JSON consolidado, con los bloques disponibles
en orden: `ingesta`, `clasificacion`, `extraccion`, `enrutamiento`, `almacenamiento_oci`.
Las etapas no ejecutadas no se inventan. No se guardan archivos separados de clasificación
ni extracción. En un rechazo de entrada se conserva el reporte, no el binario inválido.
Si JSON Schema falla, se conservan las inconsistencias y no se almacena la salida inválida del modelo.

`almacenamiento_oci` contiene `bucket`, `ruta_objeto` y `status_backup`.
El archivo final incluye su propia ubicación y es idéntico al JSON final mostrado.
`exito` se devuelve solo después de confirmar el PUT; `error` indica fallo definitivo,
y `no_confirmado` timeout o resultado incierto. Ante un fallo, la ubicación mostrada
es la ruta intentada, no prueba de que exista el objeto. Si OCI no está disponible,
no es posible guardar allí el reporte de ese mismo fallo; la interfaz lo informa.

### Confirmación y duplicados

La recepción confirma `201` tras guardar original y metadata. La validación compartida
con clasificación y extracción no repite escrituras. Se mantiene la reserva de metadata
con `If-None-Match: *`, protección del original y reversión condicionada por ETag ante
rechazos definitivos. Un timeout puede dejar una reserva parcial y exige conciliación.
El resultado final también usa `If-None-Match: *`; nunca sobrescribe un archivo existente.
No hay reintentos automáticos de escrituras inciertas. Los IDs generados tienen seis
caracteres alfanuméricos; una nueva carga normal genera otro ID.

La desconexión de la interfaz no cancela voluntariamente el guardado en el servidor.
No hay cola de trabajos duradera: un cierre del proceso o timeout del alojamiento puede
interrumpirlo. `/api/process` declara un máximo de 300 segundos, sujeto a los límites
reales del despliegue. `/api/ingest/salud` comprueba solo la aplicación.

Los endpoints individuales siguen disponibles: recepción guarda el original;
clasificación, extracción y enrutamiento devuelven su etapa. Para obtener persistencia
terminal de cualquier rama debe utilizarse `/api/process`, como hace la interfaz.
Los endpoints individuales de clasificación y extracción siguen aceptando contenido
directo para uso independiente; la interfaz utiliza el original de OCI mediante `/api/process`.

## Verificación

```bash
npm test
npm run typecheck
npm run build
```

Las pruebas automáticas simulan Gemini/OCI y verifican todas las rutas terminales,
errores de escritura, preservación del original y el JSON consolidado.
`npx tsx scripts/verificar-oci.ts` realiza una prueba real con un documento sintético:
crea objetos en OCI y los vuelve a leer para comprobar original y resultado. No los elimina.

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
| POST   | `/api/ingest/classify` | `multipart/form-data`: `documento_id`, `archivo`; o JSON: `documento_id`, `tipo_archivo`, `documento_texto` — clasifica directamente con Gemini, sin OCI |
| POST   | `/api/ingest/extract` | `multipart/form-data`: `documento_id`, `archivo`, `canal_origen?`; o JSON: `documento_id`, `tipo_archivo`, `documento_texto`, `canal_origen?` — extrae el contenido enviado sin OCI |
| POST   | `/api/ingest/route`    | `application/json`: `{ documento_id, categoria }` — asigna la cola por categoría exclusivamente para la ruta normal |
| POST   | `/api/process` | Archivo multipart o JSON/texto; ejecuta el flujo completo, emite avances NDJSON y guarda el resultado terminal en OCI. |

### Ejemplo de respuesta exitosa (`201`)

```json
{
  "status": "recibido",
  "documento_id": "DOC-CLIN-2026-A1B2C3",
  "tipo_archivo_detectado": "PDF",
  "tamano_bytes": 48213,
  "canal_origen": "Guardia_Emergencias",
  "recibido_en": "2026-09-26T21:27:25.262Z",
  "nombre_original": "documento.pdf",
  "almacenamiento_oci": {
    "bucket": "mediflow-documentos-clinicos",
    "ruta_objeto": "recibidos/2026/09/DOC-CLIN-2026-A1B2C3/DOC-CLIN-2026-A1B2C3.pdf",
    "status_backup": "exito"
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

`POST /api/ingest/classify` recibe `documento_id` y el contenido original por multipart o JSON,
lo envía a Gemini (multimodal: PDF, imagen o texto/JSON) y devuelve la categoría,
confianza de clasificación y justificación.
El servidor lo ejecuta después de la ingesta y espera su éxito antes de extraer. Si falla, guarda el resultado parcial en la ruta terminal. La clasificación se muestra incluso si luego falla la extracción.

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
  "clasificado_en": "2026-10-05T21:30:00.000Z"
}
```

- La salida de Gemini se fuerza a JSON con esquema y se vuelve a validar con
  Zod; una respuesta inválida devuelve `502` sin exponer su contenido.
- La confianza es declarada por el modelo. La decisión de revisión humana
  corresponde a etapas posteriores; clasificación no devuelve ese campo ni el modelo utilizado.
- Se revalida el contenido y el ID. Ya no se aceptan rutas OCI como entrada.
- El resultado se incorpora al JSON consolidado guardado al finalizar `/api/process`. El endpoint individual no escribe un archivo separado.
- El contenido del documento se trata como datos: el prompt indica ignorar
  instrucciones incluidas dentro del documento.
- Errores: `413` documento demasiado grande
  (máximo 14 MiB para enviarlo a Gemini); `415` TIFF (Gemini no lo admite;
  convertir a PDF/PNG/JPEG); `502` fallo de Gemini; `503` configuración ausente.
- El documento se envía a la API de Gemini. Usar solo documentos sintéticos
  hasta definir las condiciones de privacidad para datos reales de pacientes.

## Extracción clínica estructurada

Flujo activo: ingesta → clasificación con Gemini → extracción con Gemini → validación estructural local → confianza → decisión de suficiencia → prioridad y destino propuesto. El servidor ejecuta el enrutador solo después de obtener prioridad NORMAL y destino provisional Ruta_Normal; utiliza la categoría ya obtenida.

Se guardan el original y sus metadatos al recibirlo, y un JSON consolidado al terminar la rama. Los objetos anteriores no se eliminan.

`POST /api/ingest/extract` recibe directamente el archivo multipart o el JSON/texto junto con `documento_id`. Revalida el contenido y llama a Gemini sin consultar OCI.
Utiliza `GEMINI_API_KEY`, `GEMINI_MODEL` y el prompt versionado en `lib/extraccion.ts`.
El flujo realiza hasta cuatro llamadas al modelo: clasificación, extracción, cotejo y prioridad. La validación estructural se ejecuta localmente después de extraer; solo si pasa se realiza el cotejo. La prioridad se evalúa únicamente con confianza suficiente, dentro de la misma solicitud de extracción. Estas evaluaciones añaden latencia y consumo de Gemini.

El contrato de `datos_extraidos` (prompt `3.1`) cubre diferentes documentos clínicos:

| Sección | Información |
| --- | --- |
| `paciente` | Nombre, identificación, edad y unidad, nacimiento, sexo y contacto |
| `profesionales` | Todos los profesionales, matrícula, especialidad y rol |
| `documento` | Título, fecha e identificador |
| `motivo_consulta`, `sintomas`, `exploracion_fisica` | Información de consulta y exploración |
| `antecedentes`, `alergias` | Descripción, reacción y estado documentados |
| `signos_vitales` | Valores, unidades y fechas |
| `diagnosticos` | Todos los diagnósticos, estado, tipo y CIE-10 escrito |
| `medicamentos` | Nombre, concentración, presentación, dosis, vía, frecuencia, duración, cantidad, indicaciones y estado |
| `estudios` | Nombre, estado, fecha, región, técnica, hallazgos y conclusión |
| `resultados_laboratorio` | Prueba, resultado, unidad, rango, indicador, muestra y fecha |
| `procedimientos`, `evolucion_clinica` | Intervenciones, resultados y evolución detallada |
| `indicaciones`, `seguimiento` | Cuidados, reposo, dieta, controles y derivaciones |
| `urgencia` | Solo la urgencia expresamente documentada, sin triaje |
| `institucion` | Nombre, teléfono, dirección, correo electrónico y sitio web del centro emisor |

Los campos ausentes o ilegibles son `null` y las listas sin datos son `[]`.
Se mantienen resultados normales y negativos, tablas y registros de distintas fechas.
El prompt conserva detalles clínicos narrativos y extrae los contactos del centro en `institucion`. Se elimina `otros_datos`; se omiten publicidad, créditos de terceros y datos administrativos que no correspondan al esquema. Los campos institucionales ausentes quedan en `null`; no se confunden con los contactos del paciente o del profesional.

Se sustituye el contrato reducido: `medico_solicitante` pasa a `profesionales` con rol;
`estudio_realizado` a `estudios`; `diagnostico_principal` y `cie10_sugerido` a
`diagnosticos` con tipo y código explícitos. `paciente.nombre` se mantiene.
La interfaz recorre todas las secciones, incluyendo listas clínicas y datos institucionales.

La extracción intenta cubrir toda la información legible; no garantiza exhaustividad
ni exactitud del LLM. Se conservan los límites de entrada descritos abajo y los del
proveedor. No se infieren códigos, dosis, diagnósticos, edades, fechas ni urgencias.

No se solicita ni devuelve evidencia, confianza de extracción, inconsistencias,
validación clínica o decisión de revisión humana. Solo se comprueba técnicamente
el JSON mediante JSON Schema Draft 7 con Ajv (claves, tipos y ausencia de campos extra).
La confianza de clasificación no representa una validación de los datos extraídos.
La decisión de revisión humana queda para etapas posteriores.

La respuesta `200` incluye `status: "extraido"`, `documento_id`, `datos_extraidos`,
`version_prompt`, `extraido_en` y `validacion`, sin `modelo` ni `resultado_oci`.
La interfaz muestra las entidades; una extracción fallida detiene el flujo.

Errores: `400/422` entrada inválida; `413` más de 14 MiB
binarios o 50.000 caracteres de texto; `415` formato no compatible; `502` fallo
externo; `503` configuración, acceso o cuota de Gemini.
La extracción no trunca texto. Las pruebas simulan Gemini y OCI y verifican
que clasificación y extracción no escriban objetos.

## Validación rigurosa de estructura y tipos

`lib/esquema-clinico.ts` define un único contrato con Zod y genera el JSON Schema
Draft 7 (`ESQUEMA_CLINICO`) con `zod-to-json-schema`. Ese mismo contrato genera el
subconjunto de estructura enviado a Gemini, evitando mantener dos esquemas distintos.
`lib/validacion-clinica.ts` compila el esquema con Ajv y valida localmente cada respuesta.
No se pide al LLM que decida si su propia respuesta es válida.

Reglas actuales:

- Todas las claves del contrato son obligatorias, incluso las que permiten `null`.
- Objetos, arrays, cadenas, números y booleanos deben tener el tipo exacto.
- No se permiten propiedades adicionales en ningún nivel (incluidos `otros_datos` y `evidencia`).
- Los textos deben contener al menos un carácter no blanco; si no consta un dato, se usa `null`.
- La edad debe ser un número finito no negativo o `null`; admite decimales y conserva su unidad.
- Las listas vacías son válidas. Fechas, dosis, resultados y unidades siguen siendo texto literal.
- No hay coerción, valores predeterminados, eliminación de propiedades ni modificación del original.

Una respuesta válida incluye, fuera de `datos_extraidos`:

```json
"validacion": {
  "valido": true,
  "estado": "valido",
  "alcance": "estructura_y_tipos",
  "version_esquema": "1.0",
  "total_errores": 0,
  "errores": []
}
```

Si el JSON generado tiene sintaxis inválida o incumple el esquema, la API devuelve `200`
con `status: "revision_humana"`, el `documento_id`, `validacion.valido: false` y
`decision_enrutamiento.destino_principal: "Cola_Auditoria_Humana"`.
La decisión requiere auditoría y queda pendiente de entrega. Se omiten el cálculo
de confianza y la prioridad (`estado: "omitida"`, score nulo), sin más llamadas a Gemini.
Este `200` confirma la decisión del flujo, no la validez del documento ni una entrega real.
La interfaz muestra rutas JSON Pointer (por ejemplo
`/paciente/edad`), reglas y mensajes controlados. No devuelve el contenido inválido,
los valores clínicos rechazados ni los nombres de propiedades desconocidas.
Se informa el total y se muestran hasta 50 errores.

`valido: true` significa que cumple el contrato, no que sea clínicamente correcto,
completo o fiel al documento. Un contrato con datos ausentes expresados mediante
`null` puede ser válido. No se verifica todavía coherencia entre campos, fechas
reales, dosificación, códigos contra catálogos ni autenticidad.

Opciones de referencia: [documentación de Ajv](https://ajv.js.org/options.html).
Clasificación, persistencia OCI y enrutamiento normal están activos en `/api/process`.

## Confianza de la extracción clínica

`lib/confianza-extraccion.ts` implementa el algoritmo versionado `1.0`. La respuesta
incluye `extraccion.confianza_documento`, independiente de `clasificacion.confianza`.
Gemini coteja el original completo con cada campo extraído y devuelve observaciones
estructuradas; el servidor valida ese informe y calcula el puntaje, no lo solicita al LLM.

| Factor | Cálculo | Peso |
| --- | --- | --- |
| Legibilidad | Unidades legibles / unidades totales del original | 20 % |
| Correspondencia | Campos respaldados por el original / campos extraídos | 40 % |
| Cobertura | Campos respaldados / (campos respaldados + omisiones relevantes) | 25 % |
| Consistencia | 1 − campos contradictorios / campos extraídos; máximo 0.5 si el original presenta conflictos | 15 % |

El score es la media ponderada, en escala de 0 a 1. Se limita a 0.59 si hay
contradicciones o algún factor inferior a 0.5. Nivel alto: desde 0.85; medio:
desde 0.60; bajo: inferior a 0.60. La interfaz lo presenta sobre 100.
Los campos ausentes del original o no aplicables no se penalizan por ser `null`.
Las omisiones se estiman respecto al contrato clínico, no respecto a publicidad
ni información ajena al esquema.

`requiere_revision_humana` es verdadero ante contenido ilegible, omisiones,
campos sin respaldo, contradicciones o puntaje inferior a 0.85, incluso si
la media resulta alta. La bandera informa; todavía no envía documentos a una cola.
Se incluyen factores, motivos y rutas de campos observados, sin citas de evidencia.

Si el evaluador falla, su respuesta es inválida o incompleta, o no hay datos
clínicos evaluables, se conserva la extracción estructuralmente válida y se devuelve
`estado: "no_evaluable"`, `score: null` y revisión humana requerida. Si falla el
JSON Schema, se deriva a auditoría humana antes de llamar al evaluador.

Este es un indicador heurístico con pesos y umbrales provisionales: `calibrado: false`.
El cotejo utiliza el mismo modelo Gemini configurado para extraer, por lo que puede
repetir sus errores. No es una probabilidad de exactitud, no certifica autenticidad
ni valida diagnósticos o tratamientos. Requiere calibración con documentos anotados
y revisión humana antes de usarlo para decisiones operativas. Se incluye en el resultado final almacenado en OCI.

## Siguiente paso en el pipeline

La persistencia está activa y devuelve ubicaciones confirmadas en almacenamiento_oci.

El flujo activo cubre **ingesta, clasificación, extracción estructurada, validación
JSON Schema, confianza, prioridad, enrutamiento y persistencia OCI**.
Quedan pendientes calibración de confianza, validación clínica del triaje, entrega operativa,
resolución de revisión humana y persistencia del historial. El flujo sigue coordinado
por el servidor mediante `/api/process`.

## Decisión posterior a la confianza

La extracción devuelve `evaluacion_confianza`, `prioridad_urgencia` y
`decision_enrutamiento`. El umbral es `0.85` (inclusive), definido en
`lib/confianza-extraccion.ts`. Se requiere estado evaluado, puntaje suficiente
y ausencia de motivos, campos observados o señal de revisión humana.
En caso contrario se propone `Cola_Auditoria_Humana`, con prioridad omitida
y notificación nula, sin llamar al evaluador de prioridad.

Con confianza suficiente, Gemini propone prioridad URGENTE, NORMAL o NO_DETERMINADA
a partir de los datos cotejados. Una salida inválida, fallo del proveedor,
prioridad indeterminada o contradicción entre NORMAL y urgencia explícita
deriva a auditoría. No se utiliza una lista de diagnósticos con umbrales clínicos.
Esta propuesta no es un triaje clínico validado.

URGENTE selecciona `Cola_Emergencia_Medica` y prepara `notificacion_generada`
con canal `Alerta_Guardia_Medica`, mensaje sin identificadores solicitados y
estado `pendiente_envio`. NORMAL devuelve Ruta_Normal. El enrutador posterior asigna la cola por categoría mediante reglas fijas, sin llamadas adicionales a Gemini.
Todas las decisiones tienen estado `pendiente_entrega`: no se publican mensajes
en colas ni se envían alertas externas. La interfaz muestra prioridad y destino.


## Enrutamiento de la ruta normal

`lib/enrutamiento.ts` recibe únicamente `documento_id` y `categoria`. No evalúa
confianza, revisión humana, urgencia ni disponibilidad de destinos. La selección
se activa desde el servidor después de prioridad NORMAL; las ramas de emergencia
y auditoría terminan sin llamar a este endpoint. No se repite clasificación.

| Categoría | Cola |
| --- | --- |
| RECETA_MEDICA | cola_farmacia |
| RESULTADO_LABORATORIO | cola_laboratorio |
| INFORME_IMAGENOLOGIA | cola_imagenologia |
| HISTORIA_CLINICA | cola_historia_clinica |
| RESUMEN_ALTA | cola_resumen_alta |
| ORDEN_MEDICA | cola_ordenes_medicas |
| CERTIFICADO_MEDICO | cola_certificados |
| CONSENTIMIENTO_INFORMADO | cola_consentimientos |
| DOCUMENTO_ADMINISTRATIVO | cola_administrativa |
| OTRO | cola_area_correspondiente |

El servidor agrega `enrutamiento` como bloque independiente después de `extraccion` y actualiza
`extraccion.decision_enrutamiento.destino_principal` con esa misma cola.
`status: enrutado` significa asignación lógica; la entrega sigue pendiente.
Un fallo de esta llamada muestra error y conserva los datos extraídos; no deriva
el documento nuevamente a auditoría. Los consumidores directos de la API deben
utilizar `/api/process` para el flujo completo: el endpoint individual de rutas no comprueba etapas previas.

