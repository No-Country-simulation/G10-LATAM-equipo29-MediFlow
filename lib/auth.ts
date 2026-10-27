import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { configuracionAuth, esAdministrador, opcionesCookieAuth } from "./auth-config";

export async function clienteAuth() {
  const config = configuracionAuth();
  if (!config) return null;
  const jar = await cookies();
  return createServerClient(config.url, config.key, {
    cookieOptions: opcionesCookieAuth,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: valores => {
        // En componentes de servidor la renovación corresponde a proxy.ts.
        try { valores.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch {}
      },
    },
  });
}

export async function accesoAdmin(crear = clienteAuth) {
  if (!configuracionAuth()) return { status: 503, detalle: "El acceso administrativo todavía no tiene configurado Supabase." } as const;
  try {
    const client = (await crear())!;
    // Consulta al servidor de Auth: no confiar en una sesión leída de la cookie.
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return { status: 401, detalle: "Inicie sesión para acceder al panel." } as const;
    if (!esAdministrador(data.user)) return { status: 403, detalle: "La cuenta no tiene acceso administrativo habilitado." } as const;
    return { status: 200, detalle: "", email: data.user.email } as const;
  } catch {
    return { status: 503, detalle: "No se pudo verificar el acceso. Inténtelo nuevamente." } as const;
  }
}

export async function protegerApiAdmin() {
  const acceso = await accesoAdmin();
  return acceso.status === 200 ? null : Response.json({ detalle: acceso.detalle }, {
    status: acceso.status, headers: { "Cache-Control": "private, no-store" },
  });
}
