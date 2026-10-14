
"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSession } from "@/lib/auth";
import { guarded, ActionError } from "@/lib/action-utils";
import { clientIp, rateLimit, LIMITS } from "@/lib/rate-limit";
import { text, email as emailField, ValidationError } from "@/lib/validation";
import { safeRedirectPath } from "@/lib/url-safety";
import { siteUrl } from "@/lib/site";
import { logAudit } from "@/lib/audit";
import { acceptPendingInvitations } from "@/lib/services/invitations";
import { classifyAuthError, classifyDbError, AUTH_MESSAGES, DB_MESSAGES } from "@/lib/auth-errors";

function password(fd: FormData): string {
  const p = String(fd.get("password") ?? "");

  if (p.length < 10) {
    throw new ValidationError("Password must be at least 10 characters.");
  }

  if (p.length > 128) {
    throw new ValidationError("Password must be at most 128 characters.");
  }

  return p;
}

// Removes a newly created Auth account if its setup fails.
// Existing accounts and accounts with organization memberships are protected.
async function rollbackNewAccount(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  createdAt: string | undefined,
  orgId: string | null
) {
  try {
    if (orgId) {
      const { error } = await admin
        .from("organizations")
        .delete()
        .eq("id", orgId);

      if (error) {
        console.error("[signUp rollback] organization:", error.message);
      }
    }

    const createdTime = createdAt
      ? new Date(createdAt).getTime()
      : Number.NaN;

    const justCreated =
      Number.isFinite(createdTime) &&
      Date.now() >= createdTime &&
      Date.now() - createdTime < 5 * 60_000;

    if (!justCreated) return;

    const { data: memberships, error: membershipError } = await admin
      .from("organization_members")
      .select("user_id")
      .eq("user_id", userId)
      .limit(1);

    // Fail safely if we cannot verify membership status.
    if (membershipError) {
      console.error(
        "[signUp rollback] membership check:",
        membershipError.message
      );
      return;
    }

    if (memberships && memberships.length > 0) return;

    const { error: deleteError } =
      await admin.auth.admin.deleteUser(userId);

    if (deleteError) {
      console.error("[signUp rollback]", deleteError.message);
    }
  } catch (e) {
    console.error(
      "[signUp rollback]",
      e instanceof Error ? e.message : "unknown"
    );
  }
}

export async function signUp(formData: FormData) {
  return guarded(async () => {
    // 1. Rate-limit signup attempts.
    const ip = await clientIp();

    await rateLimit(
      `signup:${ip}`,
      LIMITS.signup.window,
      LIMITS.signup.max
    );

    // 2. Validate the required signup fields.
    // Public signup never accepts a platform role from the form.
    // The database trigger must assign the default role: "user".
    const next = safeRedirectPath(formData.get("next"));
    const email = emailField(formData, "email");
    const pw = password(formData);
    const fullName = text(formData, "full_name", "Name", {
      max: 100,
    });

    const admin = createAdminClient();

    // Check for a pending invitation. An organization name is not required.
    const { data: invite, error: inviteError } = await admin
      .from("organization_invitations")
      .select("id")
      .ilike("email", email)
      .eq("status", "PENDING")
      .limit(1)
      .maybeSingle();

    if (inviteError) {
      const kind = classifyDbError(inviteError);
      console.error("[signUp] invitation lookup:", kind, inviteError.code ?? "no-code");

      throw new ActionError(
        kind === "other" ? "Account registration is temporarily unavailable. Please try again." : DB_MESSAGES[kind]
      );
    }

    // 3. Create the Supabase Auth account.
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase.auth.signUp({
      email,
      password: pw,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      const kind = classifyAuthError(error);

      if (kind === "already_registered" || kind === "weak_password" || kind === "rate_limited" || kind === "email_rate_limited") {
        throw new ActionError(AUTH_MESSAGES[kind]);
      }

      console.error("[signUp]", kind, error.status ?? "no-status", error.code ?? "no-code");

      throw new ActionError(
        "We could not create your account right now. Please try again."
      );
    }

    if (!data.user) {
      throw new ActionError(
        "We could not create your account right now. Please try again."
      );
    }

    // Do not modify an existing account returned without identities.
    if (!data.user.identities || data.user.identities.length === 0) {
      throw new ActionError(
        "An account with this email already exists. Please log in instead."
      );
    }

    const userId = data.user.id;
    const createdAt = data.user.created_at;

    try {
      // 4. Verify the database trigger created the user's profile.
      const { data: profile, error: profileError } = await admin
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (profileError || !profile) {
        console.error(
          "[signUp] profile lookup:",
          profileError?.message ?? "Profile was not created"
        );

        throw new ActionError(
          "Account setup could not be completed. Please try again."
        );
      }

      // Synchronize the profile email with the validated signup email.
      const { error: profileUpdateError } = await admin
        .from("profiles")
        .update({ email })
        .eq("id", userId);

      if (profileUpdateError) {
        console.error(
          "[signUp] profile update:",
          profileUpdateError.message
        );

        throw new ActionError(
          "Account setup could not be completed. Please try again."
        );
      }

      // 5. Preserve invitation handling.
      // Users without invitations do not receive an organization automatically.
      if (invite) {
        await acceptPendingInvitations(
          userId,
          email,
          !!data.user.email_confirmed_at
        );
      }
    } catch (e) {
      // Organization membership is optional for customer signup.
      await rollbackNewAccount(admin, userId, createdAt, null);
      await supabase.auth.signOut().catch(() => undefined);

      if (e instanceof ActionError) throw e;

      console.error(
        "[signUp] setup failed:",
        e instanceof Error ? e.message : "unknown"
      );

      throw new ActionError(
        "Account setup could not be completed. Please try again."
      );
    }

    // 6. Audit successful signup.
    await logAudit({
      actorId: userId,
      action: "auth.signup",
      resourceType: "user",
      resourceId: userId,
    });

    // 7. If email confirmation is enabled, tell the customer honestly.
    const { data: sessionData } = await supabase.auth.getSession();

    if (!sessionData.session) {
      return {
        ok: true as const,
        message: "Check your email to confirm your address, then log in.",
      };
    }

    redirect(next);
  });
}

export async function signIn(formData: FormData) {
  return guarded(async () => {
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 254);

    const pw = String(formData.get("password") ?? "").slice(0, 200);
    const next = safeRedirectPath(formData.get("next"));

    if (!email || !pw) {
      throw new ActionError("Email and password are required.");
    }

    const ip = await clientIp();

    await rateLimit(
      `login:ip:${ip}`,
      LIMITS.login.window,
      LIMITS.login.max * 3
    );

    await rateLimit(
      `login:acct:${email}`,
      LIMITS.login.window,
      LIMITS.login.max
    );

    const supabase = await createServerSupabaseClient();

    let result;

    try {
      result = await supabase.auth.signInWithPassword({
        email,
        password: pw,
      });
    } catch (e) {
      console.error("[signIn] request failed:", e instanceof Error ? e.message.slice(0, 120) : "unknown");
      throw new ActionError(AUTH_MESSAGES.network);
    }

    const { data, error } = result;

    if (error) {
      const kind = classifyAuthError(error);

      if (kind === "invalid_credentials") {
        await logAudit({
          actorId: null,
          action: "auth.login_failed",
          resourceType: "user",
          metadata: { reason: "invalid_credentials" },
        });
      } else {
        console.error("[signIn]", kind, error.status ?? "no-status", error.code ?? "no-code");
      }

      throw new ActionError(AUTH_MESSAGES[kind]);
    }

    if (!data.user || !data.session) {
      throw new ActionError("Sign-in failed. Please try again.");
    }

    // Accept eligible pending invitations after successful sign-in.
    await acceptPendingInvitations(
      data.user.id,
      data.user.email,
      !!data.user.email_confirmed_at
    );

    // Confirm the account has a usable profile and is not disabled.
    const session = await getSession();

    if (!session) {
      await supabase.auth.signOut();

      throw new ActionError(
        "This account cannot sign in right now. Please contact support."
      );
    }

    await logAudit({
      actorId: data.user.id,
      action: "auth.login",
      resourceType: "user",
      resourceId: data.user.id,
    });

    redirect(next);
  });
}

export async function signOut() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(formData: FormData) {
  return guarded(async () => {
    const ip = await clientIp();

    await rateLimit(
      `reset:${ip}`,
      LIMITS.reset.window,
      LIMITS.reset.max
    );

    const raw = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase()
      .slice(0, 254);

    if (raw) {
      const supabase = await createServerSupabaseClient();

      const { error } = await supabase.auth.resetPasswordForEmail(raw, {
        redirectTo: `${siteUrl()}/auth/callback?next=/update-password`,
      });

      if (error) {
        console.error("[requestPasswordReset]", error.message);
      }
    }

    // Return the same message whether or not the account exists.
    return {
      ok: true as const,
      message:
        "If an account exists for that email, a reset link has been sent.",
    };
  });
}

export async function updatePassword(formData: FormData) {
  return guarded(async () => {
    const session = await getSession();

    if (!session) {
      throw new ActionError(
        "Your reset link has expired. Please request a new one."
      );
    }

    const pw = password(formData);
    const supabase = await createServerSupabaseClient();

    const { error } = await supabase.auth.updateUser({
      password: pw,
    });

    if (error) {
      throw new ActionError(
        "Could not update your password. Your reset link may have expired - request a new one."
      );
    }

    await logAudit({
      actorId: session.user.id,
      action: "auth.password_changed",
      resourceType: "user",
      resourceId: session.user.id,
    });

    redirect("/dashboard");
  });
}
