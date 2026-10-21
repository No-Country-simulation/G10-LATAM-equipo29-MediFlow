import { recibirDocumento } from "@/lib/recepcion";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return recibirDocumento(request, "archivo");
}
