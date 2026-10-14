import { redirect } from "next/navigation";
import { ValidationError } from "./validation.ts";

// Errors whose message is safe to show to the user.
export class ActionError extends Error {
  constructor(message: string) { super(message); this.name = "ActionError"; }
}

export type ActionResult<T = object> = ({ ok: true } & T) | { ok?: false; error: string };

function isFrameworkSignal(e: unknown): boolean {
  const digest = (e as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

// Wraps a server action body: expected errors become { error }, framework
// redirect/not-found signals pass through, anything else is logged server-side
// and replaced with a generic message (no stack traces or DB details leak).
export async function guarded<T extends object>(fn: () => Promise<T>): Promise<(T & { error?: undefined }) | { error: string; ok?: undefined }> {
  try {
    return (await fn()) as T & { error?: undefined };
  } catch (e) {
    if (isFrameworkSignal(e)) throw e;
    if (e instanceof ActionError || e instanceof ValidationError) return { error: e.message };
    console.error("[action]", e instanceof Error ? e.message : "unknown error");
    return { error: "Something went wrong. Please try again." };
  }
}

// For form actions that finish by redirecting (pages that show ?error=... banners).
// Expected errors become a redirect back with a message; framework signals pass through.
export async function withRedirect(failPath: string, fn: () => Promise<void>): Promise<never> {
  try {
    await fn();
  } catch (e) {
    if (isFrameworkSignal(e)) throw e;
    const msg = e instanceof ActionError || e instanceof ValidationError ? e.message : "Something went wrong. Please try again.";
    if (!(e instanceof ActionError || e instanceof ValidationError)) console.error("[action]", e instanceof Error ? e.message : "unknown error");
    const sep = failPath.includes("?") ? "&" : "?";
    redirect(`${failPath}${sep}error=${encodeURIComponent(msg)}`);
  }
  throw new Error("withRedirect: action body must end with redirect()");
}
