import { Hono } from "hono";
import { isProjectRole, isUuid, type ProjectEnv, requireProjectRole } from "../auth/roles.ts";
import { type AuthDeps, type AuthEnv, requireUser } from "../auth/session.ts";
import { generateToken, hashToken } from "../auth/tokens.ts";
import { EMAIL_PATTERN, readJsonObject, Validator } from "../http/body.ts";
import { ApiError } from "../http/errors.ts";
import { auditRepo } from "../repositories/audit.ts";
import { type InvitationRole, invitationsRepo } from "../repositories/invitations.ts";
import { membersRepo } from "../repositories/members.ts";
import { inTransaction } from "../repositories/tx.ts";

export const INVITATION_TTL_DAYS = 7;

function memberIdParam(value: string | undefined): string {
  if (!value || !isUuid(value)) throw new ApiError("BAD_REQUEST", "Identificador inválido");
  return value;
}

const LAST_OWNER = "El proyecto debe conservar al menos un owner";

/**
 * Rutas de miembros e invitaciones dentro de un proyecto. Se registran sobre el router de
 * proyectos, que ya aplica `requireUser` a todo.
 */
export function registerMemberRoutes(r: Hono<ProjectEnv>, deps: AuthDeps) {
  r.get("/:id/members", requireProjectRole(deps, "viewer"), async (c) => {
    return c.json({ members: await membersRepo(deps.sql).list(c.get("projectId")) });
  });

  r.patch("/:id/members/:userId", requireProjectRole(deps, "owner"), async (c) => {
    const projectId = c.get("projectId");
    const targetId = memberIdParam(c.req.param("userId"));

    const body = await readJsonObject(c);
    const v = new Validator(body);
    if (!isProjectRole(body.role)) v.fail("role", "Debe ser owner, editor o viewer");
    v.done();
    const role = body.role as "owner" | "editor" | "viewer";

    const member = await inTransaction(deps.sql, async (tx) => {
      const members = membersRepo(tx);
      const owners = await members.lockOwners(projectId);
      const current = await members.find(projectId, targetId);
      if (!current) throw new ApiError("NOT_FOUND", "Esa persona no es miembro del proyecto");
      if (current.role === role) return current;

      if (current.role === "owner" && owners.length <= 1) {
        throw new ApiError("CONFLICT", LAST_OWNER);
      }
      await members.setRole(projectId, targetId, role);
      await auditRepo(tx).log({
        projectId,
        userId: c.get("user").id,
        action: "member.role_changed",
        entityType: "member",
        entityId: targetId,
        detail: { from: current.role, to: role, name: current.name },
      });
      return { ...current, role };
    });

    return c.json({ member });
  });

  r.delete("/:id/members/:userId", requireProjectRole(deps, "owner"), async (c) => {
    const projectId = c.get("projectId");
    const targetId = memberIdParam(c.req.param("userId"));

    await inTransaction(deps.sql, async (tx) => {
      const members = membersRepo(tx);
      const owners = await members.lockOwners(projectId);
      const current = await members.find(projectId, targetId);
      if (!current) throw new ApiError("NOT_FOUND", "Esa persona no es miembro del proyecto");
      if (current.role === "owner" && owners.length <= 1) {
        throw new ApiError("CONFLICT", LAST_OWNER);
      }
      await members.remove(projectId, targetId);
      await auditRepo(tx).log({
        projectId,
        userId: c.get("user").id,
        action: "member.removed",
        entityType: "member",
        entityId: targetId,
        detail: { role: current.role, name: current.name },
      });
    });

    return c.body(null, 204);
  });

  /** Invitaciones pendientes (para la pantalla de miembros). Solo owner. */
  r.get("/:id/invitations", requireProjectRole(deps, "owner"), async (c) => {
    return c.json({ invitations: await invitationsRepo(deps.sql).listPending(c.get("projectId")) });
  });

  r.post("/:id/invitations", requireProjectRole(deps, "owner"), async (c) => {
    const projectId = c.get("projectId");
    const body = await readJsonObject(c);
    const v = new Validator(body);
    const email = v.string("email", {
      max: 254,
      pattern: EMAIL_PATTERN,
      patternMsg: "Correo inválido",
    }).toLowerCase();
    if (body.role !== "editor" && body.role !== "viewer") {
      v.fail("role", "Debe ser editor o viewer");
    }
    v.done();
    const role = body.role as InvitationRole;

    const token = generateToken();
    const tokenHash = await hashToken(token, deps.sessionSecret);
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await inTransaction(deps.sql, async (tx) => {
      if (await membersRepo(tx).isMemberByEmail(projectId, email)) {
        throw new ApiError("CONFLICT", "Esa persona ya es miembro del proyecto");
      }
      const invitations = invitationsRepo(tx);
      // Reenviar reemplaza la invitación anterior: solo el último enlace sirve.
      await invitations.revokePendingFor(projectId, email);
      const created = await invitations.create({
        projectId,
        email,
        role,
        tokenHash,
        invitedBy: c.get("user").id,
        expiresAt,
      });
      await auditRepo(tx).log({
        projectId,
        userId: c.get("user").id,
        action: "invitation.created",
        entityType: "invitation",
        entityId: created.id,
        detail: { email, role },
      });
      return created;
    });

    // No hay envío de correo: el owner comparte el enlace. El token solo se muestra aquí.
    return c.json({ invitation, token, acceptPath: `/invitations/${token}` }, 201);
  });
}

/** Rutas fuera de un proyecto: aceptar una invitación con su token. */
export function invitationRoutes(deps: AuthDeps) {
  const r = new Hono<AuthEnv>();

  r.post("/:token/accept", requireUser(deps), async (c) => {
    const user = c.get("user");
    const tokenHash = await hashToken(c.req.param("token"), deps.sessionSecret);

    const result = await inTransaction(deps.sql, async (tx) => {
      const invitations = invitationsRepo(tx);
      const inv = await invitations.findByTokenForUpdate(tokenHash);
      // Inexistente, revocada o vencida: 404, sin distinguir.
      if (
        !inv || inv.status === "revoked" || inv.status === "expired" || inv.expiresAt <= new Date()
      ) {
        throw new ApiError("NOT_FOUND", "La invitación no existe o ya no es válida");
      }
      const sameEmail = inv.email.toLowerCase() === user.email.toLowerCase();
      const members = membersRepo(tx);
      const existing = await members.find(inv.projectId, user.id);

      // Idempotente para su destinatario: si ya la aceptó (doble clic, o vuelve a abrir el
      // enlace) y sigue siendo miembro, responde como si la aceptara de nuevo.
      if (inv.status === "accepted") {
        if (sameEmail && existing) return { projectId: inv.projectId, role: existing.role };
        throw new ApiError("CONFLICT", "Esta invitación ya fue usada");
      }
      if (!sameEmail) {
        throw new ApiError("CONFLICT", "Esta invitación es para otro correo", {
          invitedEmail: inv.email,
        });
      }

      if (existing) {
        // Ya era miembro por otra vía: la invitación queda usada y conserva su rol actual.
        await invitations.setStatus(inv.id, "accepted");
        return { projectId: inv.projectId, role: existing.role };
      }
      await members.add({
        projectId: inv.projectId,
        userId: user.id,
        role: inv.role,
        addedBy: inv.invitedBy,
      });
      await invitations.setStatus(inv.id, "accepted");
      await auditRepo(tx).log({
        projectId: inv.projectId,
        userId: user.id,
        action: "member.added",
        entityType: "member",
        entityId: user.id,
        detail: { role: inv.role, via: "invitation", invitationId: inv.id },
      });
      return { projectId: inv.projectId, role: inv.role };
    });

    return c.json(result);
  });

  return r;
}
