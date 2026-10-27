import { redirect } from "next/navigation";
import { accesoAdmin } from "@/lib/auth";
import { cerrarSesion } from "@/app/login/actions";
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const acceso = await accesoAdmin();
  if (acceso.status !== 200) redirect(`/login${acceso.status === 403 ? "?error=permisos" : acceso.status === 503 ? "?error=servicio" : ""}`);
  return <><div className="admin-sesion"><span>{acceso.email} · Administrador</span><form action={cerrarSesion}><button className="boton" type="submit">Cerrar sesión</button></form></div>{children}</>;
}
