import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    cwd: process.cwd(),
    namespaceExiste: Boolean(process.env.OCI_NAMESPACE),
    namespaceLongitud: process.env.OCI_NAMESPACE?.length ?? 0,
    regionExiste: Boolean(process.env.OCI_REGION),
    authMode: process.env.OCI_AUTH_MODE ?? null,
  });
}