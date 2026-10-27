import Link from "next/link";
import { redirect } from "next/navigation";
import { accesoAdmin } from "@/lib/auth";
import { configuracionAuth } from "@/lib/auth-config";
import { iniciarSesion, cerrarSesion } from "./actions";
export const dynamic = "force-dynamic";

const MENSAJES: Record<string, string> = {
  credenciales: "No se pudo iniciar sesión. Compruebe su correo y contraseña.",
  permisos: "La cuenta no tiene acceso administrativo habilitado. Contacte al administrador del sistema.",
  configuracion: "El acceso administrativo aún no está configurado.",
  servicio: "No se pudo conectar con el servicio de autenticación. Inténtelo nuevamente.",
  intentos: "Demasiados intentos. Espere unos minutos antes de volver a intentarlo.",
  cierre: "No se pudo confirmar el cierre de sesión. Vuelva a intentarlo.",
};
export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; salida?: string }> }) {
  const params = await searchParams;
  const acceso = await accesoAdmin();
  if (acceso.status === 200 && params.error !== "cierre") redirect("/admin");
  const configurado = !!configuracionAuth();
  return <main className="admin login"><Link className="marca" href="/">MediFlow</Link>
    <section className="admin-detalle login-tarjeta"><p className="admin-eyebrow">PANEL DE ADMINISTRACIÓN</p>
      <h1>Iniciar sesión</h1><p>Ingrese con la cuenta que le asignó el administrador.</p>
      {!configurado && <p role="alert">El acceso administrativo aún no está configurado. La carga de documentos sigue disponible.</p>}
      {params.error && MENSAJES[params.error] && <p role="alert">{MENSAJES[params.error]}</p>}
      {params.salida === "1" && <p role="status">Sesión cerrada.</p>}
      <form action={iniciarSesion} className="login-formulario">
        <label>Correo electrónico<input type="email" name="email" autoComplete="username" required maxLength={254} disabled={!configurado} /></label>
        <label>Contraseña<input type="password" name="password" autoComplete="current-password" required maxLength={1024} disabled={!configurado} /></label>
        <button className="boton" type="submit" disabled={!configurado}>Ingresar al panel</button>
      </form>
      {params.error === "cierre" && <form action={cerrarSesion}><button className="boton">Reintentar cierre de sesión</button></form>}
      <p>No hay registro público. Solicite su acceso al administrador del sistema.</p>
      <Link href="/">← Volver a cargar documentos sin iniciar sesión</Link>
    </section></main>;
}
