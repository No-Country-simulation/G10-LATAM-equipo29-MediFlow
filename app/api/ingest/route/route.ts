import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { EnrutarEntradaSchema, enrutarDocumento } from "@/lib/enrutamiento";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json(
      { status: "rechazado", detalle: "El body no es un JSON válido." },
      { status: 400 },
    );
  }

  const parseo = EnrutarEntradaSchema.safeParse(cuerpo);
  if (!parseo.success) {
    return NextResponse.json(
      {
        status: "rechazado",
        detalle: (parseo.error as ZodError).issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 422 },
    );
  }

  const resultado = enrutarDocumento(parseo.data);
  return NextResponse.json(resultado, { status: 200 });
}
