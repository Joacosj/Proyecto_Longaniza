/**
 * Producción: un solo servicio entrega el frontend compilado y la API.
 *
 * - /api/... va a la API (que ya usa ese prefijo), igual que con el proxy de Vite en desarrollo.
 * - Lo demás se busca en `dir`. Si no existe, se entrega index.html (la app usa rutas con #).
 */
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  json: "application/json",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
};

type Fetch = (req: Request) => Response | Promise<Response>;

export function withStatic(api: Fetch, dir: string): Fetch {
  const root = dir.replace(/\/+$/, "");
  return async (req) => {
    const url = new URL(req.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return api(req);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Método no permitido", { status: 405 });
    }
    // Sin "..", sin barras invertidas ni bytes nulos: nunca se sale de `dir`.
    let path: string;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Ruta inválida", { status: 400 });
    }
    if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
      return new Response("Ruta inválida", { status: 400 });
    }
    if (path.endsWith("/")) path += "index.html";
    const file = await read(`${root}${path}`) ?? await read(`${root}/index.html`);
    if (!file) return new Response("Frontend no compilado", { status: 404 });
    const ext = file.path.split(".").pop() ?? "";
    const headers = new Headers({
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      // Los archivos de assets/ llevan un hash en el nombre: se pueden guardar para siempre.
      "Cache-Control": file.path.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
    });
    return new Response(req.method === "HEAD" ? null : file.body, { headers });
  };
}

async function read(path: string): Promise<{ path: string; body: Uint8Array<ArrayBuffer> } | null> {
  try {
    const info = await Deno.stat(path);
    if (!info.isFile) return null;
    return { path, body: await Deno.readFile(path) };
  } catch {
    return null;
  }
}
