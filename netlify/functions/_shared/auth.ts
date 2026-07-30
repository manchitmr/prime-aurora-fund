import { getUser } from "@netlify/identity";

export type Editor = { id: string; email: string; name?: string };

/**
 * Authorise a write.
 *
 * Two independent conditions must both hold: a valid Identity session, and the
 * `editor` role on that user. The role is what makes this safe — if Identity
 * registration is ever left Open by mistake, a stranger can create an account
 * but still cannot write, because roles are assigned only from the dashboard.
 *
 * Returns the editor, or a Response to return verbatim. Callers must treat any
 * Response as terminal — never fall through to the mutation.
 */
export async function requireEditor(): Promise<Editor | Response> {
  let user;
  try {
    user = await getUser();
  } catch {
    // Identity not enabled on the site yet, or the token could not be verified.
    // Fail closed: an unconfigured auth layer must never mean "allow".
    return json({ error: "Authentication is not available." }, 503);
  }

  if (!user) return json({ error: "Please sign in." }, 401);

  const roles: string[] =
    (user as any)?.app_metadata?.roles ?? (user as any)?.appMetadata?.roles ?? [];

  if (!roles.includes("editor")) {
    return json(
      { error: "Your account does not have edit access. Ask an owner to grant the 'editor' role." },
      403,
    );
  }

  return { id: user.id, email: user.email, name: (user as any).user_metadata?.full_name };
}

/** Identify the caller for read-only purposes; null when signed out. */
export async function currentUser(): Promise<Editor | null> {
  try {
    const user = await getUser();
    if (!user) return null;
    return { id: user.id, email: user.email, name: (user as any).user_metadata?.full_name };
  } catch {
    return null;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
