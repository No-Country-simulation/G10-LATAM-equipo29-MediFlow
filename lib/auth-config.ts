export function configuracionAuth() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  return url && key ? { url, key } : null;
}

export const opcionesCookieAuth = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

// app_metadata solo puede modificarse mediante administración de Supabase.
// Nunca tomar permisos de user_metadata, editable por el usuario.
export function esAdministrador(user: { app_metadata?: Record<string, unknown> } | null) {
  return user?.app_metadata?.rol === "administrador" && user.app_metadata.activo === true;
}
