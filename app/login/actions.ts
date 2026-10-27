"use server";
import { redirect } from "next/navigation";
import { clienteAuth } from "@/lib/auth";
import { esAdministrador } from "@/lib/auth-config";

export async function iniciarSesion(form: FormData) {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || email.length > 254 || !password || password.length > 1024) redirect("/login?error=credenciales");
  let destino = "/admin";
  try {
    const client = await clienteAuth();
    if (!client) destino = "/login?error=configuracion";
    else {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error || !data.user) destino = error?.status === 429 ? "/login?error=intentos" : "/login?error=credenciales";
      else if (!esAdministrador(data.user)) {
        await client.auth.signOut({ scope: "local" });
        destino = "/login?error=permisos";
      }
    }
  } catch { destino = "/login?error=servicio"; }
  redirect(destino);
}

export async function cerrarSesion() {
  let fallo = false;
  try {
    const client = await clienteAuth();
    if (client) { const { error } = await client.auth.signOut({ scope: "local" }); fallo = !!error; }
  } catch { fallo = true; }
  redirect(fallo ? "/login?error=cierre" : "/login?salida=1");
}
