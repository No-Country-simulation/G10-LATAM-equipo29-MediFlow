import { listarObjetosAdmin, errorAdmin } from "@/lib/admin-oci";
import { protegerApiAdmin } from "@/lib/auth";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const denegado = await protegerApiAdmin();
  if (denegado) return denegado;
  const q = new URL(request.url).searchParams;
  try { return Response.json(await listarObjetosAdmin(q.get("prefijo") ?? "", q.get("inicio") ?? undefined, q.get("recursivo") !== "1"), { headers: { "Cache-Control": "no-store" } }); }
  catch (e) { return errorAdmin(e); }
}
