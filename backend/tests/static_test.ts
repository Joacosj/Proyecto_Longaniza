import assert from "node:assert/strict";
import { withStatic } from "../src/http/static.ts";

async function setup() {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/assets`);
  await Deno.writeTextFile(`${dir}/index.html`, "<!doctype html><title>Longanizator</title>");
  await Deno.writeTextFile(`${dir}/assets/app-abc.js`, "console.log(1)");
  const seen: string[] = [];
  const handler = withStatic((req) => {
    seen.push(new URL(req.url).pathname);
    return new Response("api");
  }, dir);
  return { handler, seen };
}

Deno.test("producción: /api va a la API y lo demás es el frontend", async () => {
  const { handler, seen } = await setup();
  assert.equal(await (await handler(new Request("http://x/api/health"))).text(), "api");
  assert.deepEqual(seen, ["/api/health"]);

  const home = await handler(new Request("http://x/"));
  assert.match(home.headers.get("Content-Type")!, /text\/html/);
  assert.match(await home.text(), /Longanizator/);

  const js = await handler(new Request("http://x/assets/app-abc.js"));
  assert.match(js.headers.get("Content-Type")!, /javascript/);
  assert.match(js.headers.get("Cache-Control")!, /immutable/);

  // Rutas desconocidas entregan la app; nunca se sale de la carpeta.
  assert.match(await (await handler(new Request("http://x/proyectos/1"))).text(), /Longanizator/);
  assert.equal((await handler(new Request("http://x/assets/..%2f..%2fetc%2fpasswd"))).status, 400);
  assert.match(
    await (await handler(new Request("http://x/%2e%2e/etc/passwd"))).text(),
    /Longanizator/,
  );
  assert.equal((await handler(new Request("http://x/", { method: "POST" }))).status, 405);
});
