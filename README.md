# MediFlow

Agente de triaje y extracción de documentos clínicos. Recibe un PDF, una imagen o un texto, lo clasifica con IA, extrae sus datos clínicos en un JSON estructurado y lo envía a la cola que corresponde. Los casos dudosos o urgentes no se resuelven solos: pasan a revisión humana.

Proyecto del Hackathon ONE, grupo 10 (Oracle Next Education y Alura). Aplicación Next.js lista para desplegar en Vercel, con almacenamiento en OCI Object Storage y modelos Gemini.

> **Aviso.** MediFlow es un prototipo de hackathon. No es un dispositivo médico, no valida diagnósticos ni tratamientos y su prioridad de urgencia no es un triaje clínico. Los documentos se envían a la API de Gemini: usar solo documentos sintéticos hasta definir las condiciones de privacidad para datos reales de pacientes.

## Contenido

- [Qué hace](#qué-hace)
- [Cómo funciona el flujo](#cómo-funciona-el-flujo)
- [Inicio rápido](#inicio-rápido)
- [Variables de entorno](#variables-de-entorno)
- [API](#api)
- [Reglas del flujo](#reglas-del-flujo)
- [Almacenamiento en OCI](#almacenamiento-en-oci)
- [Panel de administración](#panel-de-administración)
- [Estructura del proyecto](#estructura-del-proyecto)
- [Pruebas](#pruebas)
- [Despliegue en Vercel](#despliegue-en-vercel)
- [Limitaciones conocidas](#limitaciones-conocidas)

## Qué hace

- **Recibe** PDF, imágenes (JPG, PNG, WEBP), JSON y texto plano, con validación estricta del formato real del archivo.
- **Clasifica** cada documento en una de 10 categorías (receta, resultado de laboratorio, informe de imagenología, historia clínica, etc.) con Gemini.
- **Extrae** los datos clínicos a un contrato JSON único: paciente, profesionales, diagnósticos, medicamentos, estudios, laboratorio, signos vitales, indicaciones e institución.
- **Valida** la estructura localmente, calcula un puntaje de confianza de la extracción y revisa la suficiencia clínica de los datos.
- **Propone una prioridad** (urgente o normal) y **enruta** el documento a una cola según su categoría.
- **Guarda** el original intacto y un JSON consolidado con todo el recorrido en OCI Object Storage.
- **Muestra** el avance por etapas y el resultado en una interfaz web, y ofrece un panel protegido para consultar lo almacenado.

## Cómo funciona el flujo

La interfaz envía una sola solicitud a `POST /api/process`. El servidor coordina todas las etapas y devuelve el avance como NDJSON, una línea por evento.

```text
Documento ─► Recepción ─► Clasificación ─► Extracción ─► Validación ─► Confianza ─► Suficiencia ─► Prioridad ─► Enrutamiento ─► Guardado en OCI
```

| Etapa | Qué ocurre | Si falla o hay dudas |
| --- | --- | --- |
| Recepción | Valida extensión, tipo MIME y firma binaria. Guarda el original y sus metadatos en OCI. | Formato no soportado: `415`. Se guarda el reporte, no el archivo inválido. |
| Clasificación | Gemini asigna una categoría y una confianza. | Confianza menor al umbral o categoría `OTRO`: pasa a auditoría humana sin extraer. |
| Extracción | Gemini devuelve el JSON clínico. | Un fallo del proveedor termina en `errores/`. |
| Validación | Zod y JSON Schema (Ajv) comprueban claves, tipos y ausencia de campos extra. | JSON inválido: pasa a auditoría humana. |
| Confianza | Gemini coteja el original con lo extraído y el servidor calcula el puntaje. | Puntaje menor a 0.85 o evaluación no disponible: auditoría humana. |
| Suficiencia | Reglas locales y una revisión de Gemini buscan datos faltantes o ambiguos. | Cualquier hallazgo: auditoría humana. |
| Prioridad | Gemini propone `URGENTE`, `NORMAL` o `NO_DETERMINADA`. | Indeterminada o contradictoria: auditoría humana. |
| Enrutamiento | Si la prioridad es normal, asigna la cola según la categoría. | Un fallo se informa y conserva los datos extraídos. |
| Guardado | Escribe el JSON consolidado en el prefijo que corresponde al resultado. | Se informa `exito`, `error` o `no_confirmado`. |

Por documento se hacen hasta cinco llamadas a Gemini (clasificación, extracción, confianza, suficiencia y prioridad), lo que añade latencia y consumo de cuota.

## Inicio rápido

**Requisitos**

- Node.js 20.9 o superior
- Un bucket privado en OCI llamado `mediflow-documentos-clinicos` (la aplicación no crea buckets ni políticas IAM)
- Una clave de [Google AI Studio](https://aistudio.google.com/apikey) para Gemini
- Opcional: un proyecto de Supabase, solo para el panel de administración

**Instalación**

```bash
npm install
cp .env.example .env.local   # completar las variables (ver la tabla siguiente)
npm run dev                  # http://localhost:3000
```

Reiniciar `npm run dev` después de cambiar `.env.local`. La compilación no necesita credenciales: la configuración se carga en el servidor, bajo demanda.

## Variables de entorno

Todas son del servidor. No usar el prefijo `NEXT_PUBLIC_` en ninguna. `.env.local`, los archivos PEM y las claves están excluidos de Git.

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `OCI_REGION` | Sí | Región del bucket, por ejemplo `us-phoenix-1`. |
| `OCI_NAMESPACE` | Sí | Namespace de Object Storage de la tenencia. |
| `OCI_AUTH_MODE` | Sí | `api_key` (local o despliegue) o `config_file` (solo local). |
| `OCI_TENANCY_OCID`, `OCI_USER_OCID`, `OCI_FINGERPRINT`, `OCI_PRIVATE_KEY` | Con `api_key` | Credenciales de la API Key. La clave es el PEM completo y admite saltos de línea reales o secuencias `\n`. |
| `OCI_PRIVATE_KEY_PASSPHRASE` | No | Contraseña de la clave privada. |
| `OCI_CONFIG_FILE`, `OCI_CONFIG_PROFILE` | Con `config_file` | Ruta del archivo (por defecto `~/.oci/config`) y perfil (por defecto `DEFAULT`). |
| `GEMINI_API_KEY` | Sí | Clave de Gemini. Sin ella, las etapas de IA responden `503`. |
| `GEMINI_MODEL` | No | Por defecto `gemini-3.5-flash-lite`. |
| `UMBRAL_CLASIFICACION` | No | De 0 a 1. Por defecto `0.85`. Una confianza menor deriva el documento a auditoría. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | Para el panel | URL del proyecto y clave publicable (o `anon`). Nunca `service_role` ni claves secretas. |

El usuario de OCI necesita permiso para crear objetos en el bucket y para eliminarlos (se usa para revertir los metadatos cuando se rechaza una carga). Para el panel de administración también necesita permiso de listar y leer objetos. Conviene limitar las políticas al bucket y al compartimento.

## API

La recepción y el procesamiento son públicos. Solo el panel de administración exige sesión.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `POST` | `/api/process` | **Flujo completo.** Acepta un archivo (`multipart/form-data`) o JSON/texto, emite avances NDJSON y guarda el resultado terminal en OCI. Es el endpoint que usa la interfaz. |
| `POST` | `/api/ingest/file` | Recepción de un archivo. `multipart/form-data` con `archivo` y `canal_origen` (opcional). |
| `POST` | `/api/ingest/json` | Recepción de JSON o texto: `{ tipo_archivo, documento_texto, canal_origen? }`. |
| `POST` | `/api/ingest/classify` | Clasifica el contenido enviado, sin pasar por OCI. |
| `POST` | `/api/ingest/extract` | Extrae y valida el contenido enviado, sin pasar por OCI. |
| `POST` | `/api/ingest/route` | Asigna la cola de la ruta normal: `{ documento_id, categoria }`. |
| `GET` | `/api/ingest/salud` | Comprobación de que la aplicación responde. No consulta OCI ni Gemini. |
| `GET` | `/api/admin/objetos` | Lista objetos del bucket (requiere sesión de administrador). |
| `GET` | `/api/admin/archivo` | Lee o descarga un objeto (requiere sesión de administrador). |

Los endpoints individuales sirven como herramientas independientes y no comprueban las etapas previas. Para obtener el recorrido completo y su persistencia, usar `/api/process`.

**Canales de origen** (`canal_origen`, por defecto `Otro`): `Guardia_Emergencias`, `Consultorio_Externo`, `Laboratorio`, `Farmacia`, `Portal_Paciente` y `Otro`.

**Ejemplo de recepción exitosa (`201`)**

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

**Ejemplo de rechazo (`415`)**

```json
{
  "status": "rechazado",
  "detalle": "El contenido del archivo no corresponde a ningún formato soportado (PDF, IMAGEN, JSON).",
  "formatos_soportados": ["PDF", "IMAGEN", "JSON"]
}
```

**Errores frecuentes:** `400` o `422` entrada inválida; `413` documento demasiado grande; `415` formato no soportado; `502` fallo del proveedor externo; `503` configuración ausente o cuota agotada.

## Reglas del flujo

### Formatos y límites

- PDF e imágenes (JPG, PNG, WEBP): hasta **14 MiB** (14 680 064 bytes), tanto en recepción como en procesamiento.
- JSON y texto: hasta **50 000 caracteres**. La extracción no trunca el texto.
- **TIFF se rechaza** en recepción, antes de guardar nada en OCI, porque Gemini no lo admite. Convertir a PDF, PNG o JPEG.
- Cualquier otro formato recibe `415`, aunque el nombre o el `Content-Type` intenten simular uno válido. La validación usa tres capas: extensión, MIME y firma binaria (`lib/validators.ts`).

### Clasificación

Categorías (`CATEGORIAS_DOCUMENTO` en `lib/clasificacion.ts`): `RECETA_MEDICA`, `RESULTADO_LABORATORIO`, `INFORME_IMAGENOLOGIA`, `HISTORIA_CLINICA`, `RESUMEN_ALTA`, `ORDEN_MEDICA`, `CERTIFICADO_MEDICO`, `CONSENTIMIENTO_INFORMADO`, `DOCUMENTO_ADMINISTRATIVO` y `OTRO`. Para agregar o cambiar una categoría basta editar ese arreglo y su descripción: el prompt se genera a partir de ahí.

- La salida de Gemini se fuerza a JSON con esquema y se vuelve a validar con Zod.
- El contenido del documento se trata como datos: el prompt indica ignorar cualquier instrucción incluida dentro de él.
- Una confianza menor a `UMBRAL_CLASIFICACION` (0.85 por defecto) o la categoría `OTRO` marcan la clasificación como ambigua. El flujo se detiene, guarda el resultado en `auditoria_humana/` y **no extrae**. La prioridad queda como `no_evaluada`, así que la revisión humana debe considerar una posible urgencia no evaluada.
- Este umbral es independiente de la confianza de la extracción y requiere calibración con documentos revisados.

### Extracción y validación

El contrato de `datos_extraidos` cubre `paciente`, `profesionales`, `documento`, `motivo_consulta`, `sintomas`, `exploracion_fisica`, `antecedentes`, `alergias`, `signos_vitales`, `diagnosticos`, `medicamentos`, `estudios`, `resultados_laboratorio`, `procedimientos`, `evolucion_clinica`, `indicaciones`, `seguimiento`, `urgencia` e `institucion`. Los campos ausentes o ilegibles son `null` y las listas sin datos son `[]`. No se infieren códigos, dosis, diagnósticos, edades, fechas ni urgencias.

`lib/esquema-clinico.ts` define un único contrato con Zod y genera de él el JSON Schema Draft 7, tanto para Gemini como para la validación local con Ajv. Todas las claves son obligatorias, los tipos deben ser exactos, no se permiten propiedades adicionales y no se corrige ni se fuerza ningún valor. Si el JSON es inválido, el documento va a `Cola_Auditoria_Humana` y se omiten la confianza y la prioridad. Los errores se informan con rutas JSON Pointer (por ejemplo `/paciente/edad`), sin devolver el contenido rechazado.

`valido: true` significa que cumple el contrato, no que sea clínicamente correcto ni completo.

### Confianza de la extracción

`lib/confianza-extraccion.ts` implementa el algoritmo versionado `1.2`. Gemini coteja el original con cada campo extraído y devuelve observaciones estructuradas; el servidor calcula el puntaje, no el modelo.

| Factor | Cálculo | Peso |
| --- | --- | --- |
| Legibilidad | Unidades legibles sobre unidades totales del original | 20 % |
| Correspondencia | Campos respaldados por el original sobre campos extraídos | 40 % |
| Cobertura | Campos respaldados sobre respaldados más omisiones relevantes | 25 % |
| Consistencia | 1 menos campos contradictorios sobre campos extraídos | 15 % |

El puntaje va de 0 a 1 y se limita a 0.59 si hay contradicciones o algún factor inferior a 0.5. Nivel alto: desde 0.85. Medio: desde 0.60. Bajo: menos de 0.60. Se exige revisión humana ante contenido ilegible, omisiones, campos sin respaldo, contradicciones o un puntaje menor a 0.85, aunque la media sea alta. Si la evaluación falla, el estado es `no_evaluable`, el puntaje es `null` y se conserva la extracción.

Es un indicador heurístico con pesos provisionales (`calibrado: false`). Usa el mismo modelo que extrajo los datos, por lo que puede repetir sus errores. No es una probabilidad de exactitud.

### Suficiencia clínica

Una etapa aparte, independiente del esquema y de la confianza, revisa si los datos alcanzan para actuar sobre ellos. Las reglas locales detectan, entre otros casos, falta de nombre o identificador del paciente, medicamentos sin nombre o con etiquetas genéricas (`Medicamento 1`) y, en recetas, ausencia de profesional o de medicamentos. Una llamada a Gemini añade observaciones sobre nombres ambiguos, pautas incompletas y contexto faltante. No hay un catálogo farmacológico conectado: no se verifica la existencia de un fármaco, la seguridad de una dosis ni las interacciones. Cualquier hallazgo bloquea la prioridad automática y propone auditoría humana.

### Prioridad y destino

Si la confianza es suficiente (0.85 o más, inclusive), Gemini propone la prioridad a partir de los datos cotejados. No se usa una lista de diagnósticos con umbrales clínicos.

| Resultado | Destino propuesto |
| --- | --- |
| `URGENTE` | `Cola_Emergencia_Medica`, con una notificación preparada (`Alerta_Guardia_Medica`, estado `pendiente_envio`). |
| `NORMAL` | `Ruta_Normal`, que el enrutador convierte en la cola de su categoría. |
| Cualquier otro caso o fallo | `Cola_Auditoria_Humana`. |

Todas las decisiones quedan en estado `pendiente_entrega`: **no se publican mensajes en colas reales ni se envían alertas**. Las colas son una asignación lógica registrada en el JSON.

### Enrutamiento de la ruta normal

`lib/enrutamiento.ts` aplica reglas fijas, sin llamadas a Gemini:

| Categoría | Cola |
| --- | --- |
| `RECETA_MEDICA` | `cola_farmacia` |
| `RESULTADO_LABORATORIO` | `cola_laboratorio` |
| `INFORME_IMAGENOLOGIA` | `cola_imagenologia` |
| `HISTORIA_CLINICA` | `cola_historia_clinica` |
| `RESUMEN_ALTA` | `cola_resumen_alta` |
| `ORDEN_MEDICA` | `cola_ordenes_medicas` |
| `CERTIFICADO_MEDICO` | `cola_certificados` |
| `CONSENTIMIENTO_INFORMADO` | `cola_consentimientos` |
| `DOCUMENTO_ADMINISTRATIVO` | `cola_administrativa` |
| `OTRO` | `cola_area_correspondiente` |

## Almacenamiento en OCI

El bucket es fijo en el código (`mediflow-documentos-clinicos`). Cada documento deja un original intacto y un único JSON consolidado:

```text
mediflow-documentos-clinicos/
├── recibidos/AAAA/MM/<id>/
│   ├── <id>.<ext>              original, con sus bytes exactos
│   └── <id>.metadata.json      metadatos de recepción
├── procesados/normales/<id>.json
├── procesados/urgentes/<id>.json
├── auditoria_humana/<id>.json
├── rechazados/<id>.json
└── errores/<id>.json
```

| Prefijo | Contenido |
| --- | --- |
| `recibidos/AAAA/MM/<id>/` | Original y metadatos. Año y mes salen de la fecha de recepción en UTC. El nombre original solo se guarda en los metadatos. |
| `procesados/normales/` | Resultado normal, con la cola asignada. |
| `procesados/urgentes/` | Resultado urgente y alerta preparada. |
| `auditoria_humana/` | Clasificación ambigua, validación inválida, confianza o suficiencia insuficientes, o prioridad no evaluable. |
| `rechazados/` | Rechazos de entrada o formato (errores `4xx`, salvo `429`). |
| `errores/` | Fallos técnicos, del proveedor o de enrutamiento. Conserva las etapas completadas. |

El JSON final incluye, en este orden y solo si se ejecutaron, los bloques `ingesta`, `clasificacion`, `extraccion`, `enrutamiento` y `almacenamiento_oci`. Las etapas no ejecutadas no se inventan. `almacenamiento_oci` informa `bucket`, `ruta_objeto` y `status_backup` (`exito`, `error` o `no_confirmado`).

**Garantías de escritura**

- La recepción confirma `201` solo después de guardar original y metadatos.
- Los metadatos de recepción y el JSON final se escriben con `If-None-Match: *`: nunca se sobrescribe un objeto existente. Los objetos anteriores no se eliminan.
- El servidor lee el original de OCI una sola vez y reutiliza esos bytes en la clasificación, la extracción y el cotejo.
- No hay reintentos automáticos de escrituras inciertas. Un timeout puede dejar una reserva parcial que exige conciliación.
- Si OCI no está disponible, no se puede guardar el reporte de ese mismo fallo; la interfaz lo informa.

## Panel de administración

Disponible en `/admin` (con acceso desde la barra superior de la página principal). Es de **consulta**: bandeja de resultados por estado, explorador de carpetas del bucket, paginación de 50 objetos, filtro por ID o nombre en la página cargada, vista estructurada de resultados, JSON original, previsualización de PDF e imágenes y descarga. No permite eliminar, mover, editar, reprocesar ni resolver auditorías.

- El acceso requiere una cuenta de Supabase Auth con `app_metadata.rol = "administrador"` y `app_metadata.activo = true`. La carga y el procesamiento siguen siendo públicos.
- El servidor consulta `getUser()` en cada petición administrativa. Una cuenta autenticada sin permiso recibe `403`; sin configuración de Supabase el acceso falla cerrado (`503`).
- Las sesiones usan cookies `HttpOnly`, `SameSite=Lax` y `Secure` en producción (desplegar con HTTPS). No hay cliente de Supabase en el navegador ni tokens en `localStorage`.
- El bucket es fijo; el navegador no puede enviar credenciales, URLs ni otros buckets. Los archivos tienen un límite de 20 MiB y las respuestas no se guardan en caché.

**Configurar el inicio de sesión**

1. Crear un proyecto en Supabase. En Authentication, desactivar *Allow new users to sign up*, el acceso anónimo y los proveedores sociales que no se usen.
2. Copiar la URL y la clave **publishable** a `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY`, en `.env.local` y en las variables del despliegue.
3. En Authentication → Users, crear la cuenta con correo y contraseña (creación manual, no invitación). No publicar la contraseña ni subirla al repositorio.
4. Autorizar al usuario desde el SQL Editor, con el UUID exacto que aparece en Authentication → Users:

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || '{"rol":"administrador","activo":true}'::jsonb
where id = 'UUID-DEL-USUARIO'::uuid;
```

Verificar que se actualizó exactamente una fila. Los permisos van en `app_metadata`, nunca en `user_metadata`, porque el usuario puede modificar este último. Para retirar el acceso, cambiar `activo` a `false` con el mismo procedimiento.

No hay registro público, recuperación de contraseña por correo ni gestión de usuarios dentro de MediFlow: se administran desde Supabase.

## Estructura del proyecto

```text
app/
  page.tsx                      interfaz de recepción y resultados
  login/                        inicio de sesión del panel
  admin/                        panel de administración
  api/process/                  flujo completo (NDJSON, máximo 300 s)
  api/ingest/                   file, json, classify, extract, route, salud
  api/admin/                    objetos, archivo
components/                     escena 3D, etapas, resultado, confianza, extracción, suficiencia
lib/
  recepcion*.ts, validators.ts  recepción y validación de formato
  clasificacion.ts              categorías, prompt y conexión con Gemini
  politica-clasificacion.ts     umbral de clasificación ambigua
  extraccion.ts                 prompt y extracción
  esquema-clinico.ts            contrato Zod y JSON Schema
  validacion-clinica.ts         validación local con Ajv
  confianza-extraccion.ts       puntaje de confianza
  suficiencia-clinica.ts        revisión de suficiencia
  decision-enrutamiento.ts      prioridad y destino propuesto
  enrutamiento.ts               cola por categoría
  procesar-flujo.ts             orquestación de todas las etapas
  almacenamiento-final.ts       JSON consolidado en OCI
  storage.ts, admin-oci.ts      acceso a OCI Object Storage
  auth.ts, auth-config.ts       autenticación con Supabase
proxy.ts                        renueva cookies de sesión en login y panel
scripts/verificar-oci.ts        prueba real contra OCI con un documento sintético
tests/                          pruebas automáticas
```

## Pruebas

```bash
npm test            # pruebas automáticas
npm run typecheck   # TypeScript sin emitir
npm run build       # compilación de producción
```

Las pruebas simulan Gemini y OCI y cubren las rutas terminales, los errores de escritura, la preservación del original y el JSON consolidado.

`npx tsx scripts/verificar-oci.ts` hace una prueba **real** con un documento sintético: crea objetos en OCI, los vuelve a leer y comprueba que el original y el resultado coinciden. Requiere credenciales y no elimina lo que crea.

## Despliegue en Vercel

Next.js con App Router es nativo de Vercel: los Route Handlers usan la API estándar `Request` y `Response`. Por eso el proyecto no usa FastAPI ni Streamlit, que necesitan un proceso persistente.

1. Importar el repositorio desde [vercel.com](https://vercel.com) o ejecutar `vercel` con la CLI.
2. Verificar en *Settings → Git* que el proyecto apunta al repositorio y la rama correctos.
3. Cargar en *Settings → Environment Variables* todas las variables de la tabla anterior, sin `NEXT_PUBLIC_`.
4. Usar Node.js 20.9 o superior (*Settings → General → Node.js Version*).
5. Desplegar. Sin credenciales de OCI y Gemini la página carga, pero el procesamiento responde con error.

## Limitaciones conocidas

- **Límite de tamaño en Vercel.** Las funciones de Vercel limitan el cuerpo de cada petición a unos 4,5 MB, menos que los 14 MiB que acepta la aplicación. Los archivos grandes pueden fallar en producción aunque funcionen en local. La alternativa es subir directo a OCI con una URL prefirmada, fuera del alcance del MVP.
- **Duración.** `/api/process` declara un máximo de 300 segundos, sujeto a los límites reales del despliegue. No hay cola de trabajos duradera: un cierre del proceso o un timeout puede interrumpir el guardado.
- **Sin entrega real.** Las colas y las alertas son decisiones registradas; nada se publica ni se envía. Siguen pendientes la calibración de la confianza, la validación clínica de la prioridad, la entrega operativa, la resolución de las revisiones humanas y la persistencia del historial.
- **Calidad del LLM.** La extracción intenta cubrir toda la información legible, pero no garantiza exhaustividad ni exactitud. La confianza y la suficiencia son heurísticas.
- **Privacidad.** Los documentos se envían a Gemini. No usar datos reales de pacientes hasta definir las condiciones de privacidad.
- **Panel de solo lectura.** La bandeja trabaja con resultados almacenados; no es una cola ejecutable.
