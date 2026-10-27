import assert from "node:assert/strict";
import { test } from "node:test";
import { esAdministrador } from "../lib/auth-config";
import { GET as listar } from "../app/api/admin/objetos/route";
import { GET as descargar } from "../app/api/admin/archivo/route";
import { accesoAdmin, clienteAuth } from "../lib/auth";

test("auth: permisos solo desde app_metadata, con rol y estado explícitos", () => {
  assert.equal(esAdministrador(null), false);
  assert.equal(esAdministrador({}), false);
  assert.equal(esAdministrador({ app_metadata: { rol: "administrador" } }), false);
  assert.equal(esAdministrador({ app_metadata: { rol: "administrador", activo: false } }), false);
  assert.equal(esAdministrador({ app_metadata: { rol: "lector", activo: true } }), false);
  assert.equal(esAdministrador({ app_metadata: { rol: "administrador", activo: "true" } }), false);
  const editable = { user_metadata: { rol: "administrador", activo: true }, app_metadata: {} };
  assert.equal(esAdministrador(editable), false);
  assert.equal(esAdministrador({ app_metadata: { rol: "administrador", activo: true } }), true);
});

test("auth: verifica la identidad remota y deniega sesión inválida, rol ausente y fallos", async () => {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_PUBLISHABLE_KEY = "test";
  const crear = (user: unknown, error: unknown = null) => async () => ({ auth: {
    getUser: async () => ({ data: { user }, error }),
  } }) as unknown as NonNullable<Awaited<ReturnType<typeof clienteAuth>>>;
  try {
    assert.equal((await accesoAdmin(crear(null))).status, 401);
    assert.equal((await accesoAdmin(crear({ app_metadata: { rol: "administrador", activo: true } }, { message: "invalid token" }))).status, 401);
    assert.equal((await accesoAdmin(crear({ app_metadata: {} }))).status, 403);
    assert.equal((await accesoAdmin(crear({ app_metadata: { rol: "administrador", activo: true }, email: "admin@example.test" }))).status, 200);
    assert.equal((await accesoAdmin(async () => { throw new Error("network"); })).status, 503);
  } finally {
    if (url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url;
    if (key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = key;
  }
});

test("auth: las dos APIs fallan cerradas sin configuración, antes de tocar OCI", async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    for (const handler of [listar, descargar]) {
      const response = await handler(new Request("http://localhost/api/admin/archivo?ruta=recibidos/a.pdf"));
      assert.equal(response.status, 503);
      assert.match(response.headers.get("cache-control")!, /no-store/);
      assert.match(await response.text(), /Supabase/);
    }
  } finally {
    if (url !== undefined) process.env.SUPABASE_URL = url;
    if (key !== undefined) process.env.SUPABASE_PUBLISHABLE_KEY = key;
  }
});
