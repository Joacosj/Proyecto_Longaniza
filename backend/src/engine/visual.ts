/**
 * Diseñador visual: dibuja cómo se vería una pantalla como un documento HTML autocontenido.
 *
 * Usa dos skills (sistema de diseño y patrones de interfaz) y una tool en código, el validador
 * de HTML seguro: sin scripts, sin manejadores de eventos y sin recursos externos. La interfaz
 * además lo muestra dentro de un iframe aislado, así que aunque algo se colara no podría ejecutarse.
 */
import type { FrontendArtifact } from "../contracts/artifacts.ts";
import type { JsonCompleter } from "./definition.ts";
import { PATRONES_INTERFAZ } from "./skills/patrones_interfaz.ts";
import { SISTEMA_DISENO } from "./skills/sistema_diseno.ts";
import type { ProjectContext } from "./types.ts";
import { obj, str } from "./validate.ts";

export const MAX_HTML = 40_000;

/** Tool "Validador de HTML seguro". Devuelve el motivo del rechazo o null. */
export function unsafeHtmlReason(html: string): string | null {
  if (html.length > MAX_HTML) return `supera ${MAX_HTML} caracteres`;
  if (!/<html[\s>]/i.test(html) && !/<body[\s>]/i.test(html) && !/<div[\s>]/i.test(html)) {
    return "no parece un documento HTML";
  }
  const rules: [RegExp, string][] = [
    [/<script\b/i, "contiene <script>"],
    [/\son[a-z]+\s*=/i, "contiene manejadores de eventos (on…=)"],
    [/<(iframe|object|embed|link|base|frame)\b/i, "contiene iframes, objetos o enlaces externos"],
    [/<meta[^>]+http-equiv/i, "contiene meta http-equiv"],
    [/javascript:/i, "contiene javascript:"],
    [/@import/i, "contiene @import"],
    [/(https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i, "contiene URLs externas"],
    [/<form[^>]+action\s*=/i, "contiene formularios con action"],
  ];
  for (const [re, why] of rules) if (re.test(html)) return why;
  return null;
}

function screenOf(context: ProjectContext, screenId: string) {
  const screen = context.stages.frontend?.screens.find((s) => s.id === screenId);
  if (!screen) throw new Error(`La pantalla ${screenId} no existe`);
  return screen;
}

export async function designScreen(
  complete: JsonCompleter,
  input: { context: ProjectContext; screenId: string },
): Promise<{ html: string }> {
  const { context } = input;
  const screen = screenOf(context, input.screenId);
  const endpoints = (context.stages.backend?.endpoints ?? []).filter((e) =>
    screen.actions.some((a) => a.endpointId === e.id)
  );
  const roles = (context.stages.definition?.userTypes ?? []).filter((r) =>
    screen.visibleToRoleIds.includes(r.id)
  );
  const system =
    `Eres el Diseñador visual de Ideator.\n\n${SISTEMA_DISENO}\n\n${PATRONES_INTERFAZ}\n\n` +
    'Responde solo JSON: { "html": "<!doctype html>…" }';
  const user = [
    `# Proyecto: ${context.projectName}`,
    `## Pantalla a dibujar\n${JSON.stringify(screen)}`,
    `## Roles que la ven\n${JSON.stringify(roles)}`,
    `## Endpoints que usa (para los campos y datos)\n${JSON.stringify(endpoints)}`,
    `## Modelo de datos (para datos de ejemplo)\n${
      JSON.stringify(context.stages.database?.entities ?? [])
    }`,
  ].join("\n\n");

  return await complete({
    system,
    messages: [{ role: "user", content: user }],
    validate: (v) => {
      const html = str(obj(v, "respuesta").html, "html");
      const reason = unsafeHtmlReason(html);
      if (reason) throw new Error(`el HTML no cumple el sistema de diseño: ${reason}`);
      return { html };
    },
  });
}

/** Vista previa determinista (sin IA) a partir del layout: la usa el motor falso. */
export function sketchScreen(frontend: FrontendArtifact, screenId: string): string {
  const s = frontend.screens.find((x) => x.id === screenId);
  if (!s) throw new Error(`La pantalla ${screenId} no existe`);
  const esc = (t: string) =>
    t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const blocks = s.layout.map((b) =>
    `<section class="c"><h3>${esc(b.label)}</h3>${
      (b.fields ?? []).map((f) => `<div class="f">${esc(f)}</div>`).join("")
    }</section>`
  ).join("");
  const actions = s.actions.map((a) => `<span class="b">${esc(a.label)}</span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:system-ui;background:#f7f8fa;color:#1b2430;margin:0}
header{background:#fff;border-bottom:1px solid #e3e6ea;padding:14px 24px;font-weight:700}
main{max-width:960px;margin:24px auto;padding:0 16px;display:grid;gap:16px}
.c{background:#fff;border:1px solid #e3e6ea;border-radius:10px;padding:16px}
.c h3{margin:0 0 10px;font-size:15px}.f{padding:8px 10px;border:1px solid #e3e6ea;border-radius:6px;margin:6px 0;color:#5b6672}
.b{display:inline-block;margin:4px 6px 0 0;padding:8px 14px;border-radius:8px;background:#2563eb;color:#fff;font-size:14px}
</style></head><body><header>${
    esc(s.name)
  }</header><main>${blocks}<section>${actions}</section></main></body></html>`;
}
