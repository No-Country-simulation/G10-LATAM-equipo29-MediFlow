"use client";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import VistaResultado from "@/components/VistaResultado";
import { resultadoInterfaz } from "@/lib/cliente-flujo";
import type { JsonFlujo } from "@/lib/resultado-flujo";
import { formatearTamano } from "@/components/etiquetas";

type Objeto = { ruta: string; tamano: number; modificado: string | null; archivo: string | null };
type Listado = { bucket: string; carpetas: string[]; objetos: Objeto[]; siguiente: string | null };
const ESTADOS = [["auditoria_humana/", "Revisión humana"], ["procesados/normales/", "Normales"], ["procesados/urgentes/", "Urgentes"], ["errores/", "Errores"], ["rechazados/", "Rechazados"]];
class DetalleSeguro extends Component<{ children: ReactNode }, { fallo: boolean }> {
  state = { fallo: false };
  static getDerivedStateFromError() { return { fallo: true }; }
  render() { return this.state.fallo ? <p>Este resultado no es compatible con la vista estructurada. Consulte el JSON original abajo.</p> : this.props.children; }
}
function esResultado(valor: unknown): valor is JsonFlujo {
  return !!valor && typeof valor === "object" && "ingesta" in valor && !!valor.ingesta && typeof valor.ingesta === "object" && !Array.isArray(valor.ingesta);
}
export default function Administracion() {
  const [modo, setModo] = useState<"resultados" | "carpetas">("resultados");
  const [prefijo, setPrefijo] = useState("auditoria_humana/");
  const [inicio, setInicio] = useState(""); const [historial, setHistorial] = useState<string[]>([]);
  const [listado, setListado] = useState<Listado | null>(null);
  const [busqueda, setBusqueda] = useState(""); const [recarga, setRecarga] = useState(0);
  const [cargando, setCargando] = useState(false); const [error, setError] = useState("");
  const [seleccion, setSeleccion] = useState<Objeto | null>(null);
  const [contenido, setContenido] = useState<unknown>(null); const [texto, setTexto] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null); const [errorDetalle, setErrorDetalle] = useState("");
  const [leyendo, setLeyendo] = useState(false); const titulo = useRef<HTMLHeadingElement>(null);
  function navegar(ruta: string, vista = modo) { setPrefijo(ruta); setModo(vista); setInicio(""); setHistorial([]); setBusqueda(""); }
  useEffect(() => {
    const control = new AbortController(); setCargando(true); setError(""); setListado(null);
    const q = new URLSearchParams({ prefijo, inicio, recursivo: modo === "resultados" ? "1" : "0" });
    fetch(`/api/admin/objetos?${q}`, { signal: control.signal, cache: "no-store" }).then(async r => {
      const body = await r.json(); if (!r.ok) throw new Error(body.detalle); if (!control.signal.aborted) setListado(body);
    }).catch(e => { if (!control.signal.aborted) setError(e.message || "No se pudo cargar el listado."); })
      .finally(() => { if (!control.signal.aborted) setCargando(false); });
    return () => control.abort();
  }, [prefijo, inicio, modo, recarga]);
  useEffect(() => {
    setContenido(null); setTexto(null); setPreview(null); setErrorDetalle("");
    if (!seleccion) return;
    titulo.current?.focus();
    const control = new AbortController(); let url: string | null = null; setLeyendo(true);
    fetch(`/api/admin/archivo?${new URLSearchParams({ ruta: seleccion.ruta })}`, { signal: control.signal, cache: "no-store" }).then(async r => {
      if (!r.ok) { const error = await r.json(); throw new Error(error.detalle); }
      if (/\.(json|txt)$/i.test(seleccion.ruta)) {
        const t = await r.text(); if (control.signal.aborted) return; setTexto(t);
        if (/\.json$/i.test(seleccion.ruta)) { try { setContenido(JSON.parse(t)); } catch { setErrorDetalle("El archivo no contiene JSON válido. Puede consultar el texto original."); } }
      } else if (/\.(pdf|png|jpe?g|webp)$/i.test(seleccion.ruta)) {
        const blob = await r.blob(); if (control.signal.aborted) return; url = URL.createObjectURL(blob); setPreview(url);
      } else { await r.body?.cancel(); setErrorDetalle("Este formato solo está disponible para descarga."); }
    }).catch(e => { if (!control.signal.aborted) setErrorDetalle(e.message || "No se pudo abrir el archivo."); })
      .finally(() => { if (!control.signal.aborted) setLeyendo(false); });
    return () => { control.abort(); if (url) URL.revokeObjectURL(url); };
  }, [seleccion]);
  const objetos = listado?.objetos.filter(o => o.ruta.toLowerCase().includes(busqueda.toLowerCase())) ?? [];
  const carpetas = listado?.carpetas.filter(c => c.toLowerCase().includes(busqueda.toLowerCase())) ?? [];
  const original = esResultado(contenido) ? contenido.ingesta.almacenamiento_oci as { ruta_objeto?: unknown } | undefined : undefined;
  const rutaOriginal = typeof original?.ruta_objeto === "string" ? original.ruta_objeto : null;
  const id = seleccion?.ruta.match(/DOC-CLIN-\d{4}-[A-Z0-9]{6}/)?.[0];
  return <main className="admin">
    <header className="admin-barra"><Link className="marca" href="/">MediFlow</Link><Link href="/">← Volver al inicio</Link></header>
    <div className="admin-titulo"><div><p className="admin-eyebrow">DOCUMENTOS · OCI</p><h1>Panel de administración</h1><p>Consulte originales, resultados y observaciones del procesamiento.</p></div><span className="admin-insignia">Acceso de consulta</span></div>
    <div className="admin-aviso">Acceso administrativo autorizado. Las operaciones disponibles son de consulta y descarga.</div>
    {seleccion ? <section className="admin-detalle">
      <button className="boton" onClick={() => setSeleccion(null)}>← Volver al listado</button>
      <h2 ref={titulo} tabIndex={-1}>{id ?? seleccion.ruta.split("/").pop()}</h2>
      <p className="admin-ruta">{seleccion.ruta}</p>
      <p>{formatearTamano(seleccion.tamano)} · <a href={`/api/admin/archivo?${new URLSearchParams({ ruta: seleccion.ruta, descargar: "1" })}`}>Descargar archivo</a></p>
      {esResultado(contenido) && typeof contenido.ingesta.nombre_original === "string" && <p>Nombre original: {contenido.ingesta.nombre_original}</p>}
      {rutaOriginal && <button className="boton" onClick={() => setSeleccion({ ruta: rutaOriginal, tamano: typeof (contenido as JsonFlujo).ingesta.tamano_bytes === "number" ? (contenido as JsonFlujo).ingesta.tamano_bytes as number : 0, modificado: null, archivo: null })}>Abrir documento original</button>}
      {leyendo && <p role="status">Abriendo archivo…</p>}
      {errorDetalle && <p role="alert">{errorDetalle}</p>}
      {preview && (/\.pdf$/i.test(seleccion.ruta) ? <iframe className="admin-preview" src={preview} title="Documento PDF original" sandbox="" /> : <img className="admin-imagen" src={preview} alt="Documento original" />)}
      {esResultado(contenido) && <DetalleSeguro key={seleccion.ruta}><VistaResultado resultado={resultadoInterfaz(contenido)} /></DetalleSeguro>}
      {texto !== null && <details className="crudo" open={!esResultado(contenido)}><summary>Contenido original del archivo</summary><pre>{contenido ? JSON.stringify(contenido, null, 2) : texto}</pre></details>}
    </section> : <>
    <nav className="admin-vistas" aria-label="Vistas del panel">
      <button aria-pressed={modo === "resultados"} onClick={() => navegar("auditoria_humana/", "resultados")}>Bandeja de resultados</button>
      <button aria-pressed={modo === "carpetas"} onClick={() => navegar("", "carpetas")}>Explorador de OCI</button>
    </nav>
    <div className="admin-mesa"><aside className="admin-carpetas"><h2>{modo === "resultados" ? "Estado del proceso" : "Accesos rápidos"}</h2>
      {modo === "carpetas" && <button onClick={() => navegar("")}>Todos los objetos</button>}
      {(modo === "resultados" ? ESTADOS : [["recibidos/", "Originales recibidos"], ...ESTADOS]).map(([ruta, nombre]) => <button key={ruta} aria-current={prefijo === ruta ? "page" : undefined} onClick={() => navegar(ruta)}>{nombre}</button>)}
      <p>Bucket del proyecto<br/><strong>{listado?.bucket ?? "OCI Object Storage"}</strong></p>
    </aside><section className="admin-listado" aria-label="Archivos almacenados">
      <div className="admin-herramientas"><label>Filtrar esta página<input value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="ID o nombre del objeto" /></label><button className="boton" disabled={cargando} onClick={() => setRecarga(n => n + 1)}>Actualizar</button></div>
      <nav className="admin-migas" aria-label="Carpeta actual"><button onClick={() => navegar("", "carpetas")}>Bucket</button>{prefijo.split("/").filter(Boolean).map((p, i, partes) => <span key={i}> / <button onClick={() => navegar(partes.slice(0, i + 1).join("/") + "/", "carpetas")}>{p}</button></span>)}</nav>
      {cargando && <p role="status">Consultando OCI…</p>}{error && <p className="resultado__error" role="alert">{error}</p>}
      {!cargando && !error && <>
        <div className="admin-tabla"><table><thead><tr><th>Documento / objeto</th><th>Tamaño</th><th>Última modificación</th><th>Acciones</th></tr></thead><tbody>
          {carpetas.map(c => <tr key={c}><td><button className="admin-enlace" onClick={() => navegar(c)}>▸ {c.slice(prefijo.length)}</button></td><td>Carpeta</td><td>—</td><td>—</td></tr>)}
          {objetos.map(o => <tr key={o.ruta}><td><button className="admin-enlace" onClick={() => setSeleccion(o)}>{o.ruta.match(/DOC-CLIN-\d{4}-[A-Z0-9]{6}/)?.[0] ?? o.ruta.split("/").pop()}</button><small>{o.ruta.slice(prefijo.length)}{o.archivo ? ` · ${o.archivo}` : ""}</small></td><td>{formatearTamano(o.tamano)}</td><td>{o.modificado ? new Date(o.modificado).toLocaleString("es-SV") : "—"}</td><td><button className="admin-enlace" onClick={() => setSeleccion(o)}>Abrir</button></td></tr>)}
        </tbody></table></div>
        {!objetos.length && !carpetas.length && <p className="vacio">{busqueda ? "No hay coincidencias en esta página." : "No hay objetos en esta ubicación."}</p>}
        <div className="admin-paginacion"><button disabled={!historial.length} onClick={() => { setInicio(historial.at(-1)!); setHistorial(h => h.slice(0, -1)); }}>Anterior</button><span>Página {historial.length + 1} · {listado?.objetos.length ?? 0} archivos cargados</span><button disabled={!listado?.siguiente} onClick={() => { setHistorial(h => [...h, inicio]); setInicio(listado!.siguiente!); }}>Siguiente</button></div>
      </>}
    </section></div></>}
  </main>;
}
