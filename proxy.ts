import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { configuracionAuth, opcionesCookieAuth } from "./lib/auth-config";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const config = configuracionAuth();
  if (config) {
    const client = createServerClient(config.url, config.key, {
      cookieOptions: opcionesCookieAuth,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: valores => {
          valores.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          valores.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    });
    try { await client.auth.getUser(); } catch { /* La página/API deniega acceso si Auth no responde. */ }
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// La carga y el procesamiento públicos no pasan por autenticación.
export const config = { matcher: ["/admin/:path*", "/api/admin/:path*", "/login"] };
