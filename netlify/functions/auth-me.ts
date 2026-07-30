import type { Config } from "@netlify/functions";
import { getUser } from "@netlify/identity";
import { json } from "./_shared/auth.ts";

/**
 * Who am I, and may I edit? Lets the editor page render the right state without
 * having to provoke a 401/403 from a real endpoint.
 */
export default async () => {
  try {
    const user = await getUser();
    if (!user) return json({ signedIn: false, canEdit: false }, 200, { "cache-control": "no-store" });

    const roles: string[] =
      (user as any)?.app_metadata?.roles ?? (user as any)?.appMetadata?.roles ?? [];

    return json(
      {
        signedIn: true,
        canEdit: roles.includes("editor"),
        email: user.email,
        name: (user as any).user_metadata?.full_name ?? null,
        roles,
      },
      200,
      { "cache-control": "no-store" },
    );
  } catch {
    // Identity not enabled yet — report it plainly instead of looking signed out.
    return json(
      { signedIn: false, canEdit: false, identityUnavailable: true },
      200,
      { "cache-control": "no-store" },
    );
  }
};

export const config: Config = { path: "/api/auth/me" };
