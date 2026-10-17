import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { redirect } from "next/navigation";
import { signUp } from "@/lib/actions/auth";
import { FormFeedback } from "@/components/FormFeedback";
import { SubmitButton } from "@/components/SubmitButton";
import { safeRedirectPath } from "@/lib/url-safety";

export const metadata = {
title: "Create your account",
robots: { index: false, follow: false },
};

export default async function SignupPage({
searchParams,
}: {
searchParams: Promise<{
error?: string;
check?: string;
next?: string;
}>;
}) {
const sp = await searchParams;
const next = safeRedirectPath(sp.next);

async function action(formData: FormData) {
"use server";

const result = await signUp(formData);

if (result?.error) {
  redirect(
    `/signup?error=${encodeURIComponent(result.error)}&next=${encodeURIComponent(
      safeRedirectPath(formData.get("next"))
    )}`
  );
}

redirect("/signup?check=1");


}

return ( <div className="flex min-h-screen items-center justify-center bg-paperdim px-4 py-10"> <div className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-card sm:p-8"> <Link
       href="/"
       className="flex items-center gap-2 font-serif font-bold text-xl mb-8"
     > <BrandMark size={28} />
PostAtlas </Link>


    <h1 className="font-serif font-bold text-2xl mb-6">
      Create your account
    </h1>

    <FormFeedback
      error={sp.error}
      success={
        sp.check
          ? "Check your email to confirm your address, then log in."
          : undefined
      }
    />

    {!sp.check && (
      <form action={action}>
        <input type="hidden" name="next" value={next} />

        <div className="mb-4">
          <label htmlFor="full_name" className="label">
            Your name
          </label>
          <input
            id="full_name"
            name="full_name"
            required
            maxLength={100}
            autoComplete="name"
            className="input"
          />
        </div>

        <div className="mb-4">
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            type="email"
            name="email"
            required
            maxLength={254}
            autoComplete="email"
            className="input"
          />
        </div>

        <div className="mb-5">
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            name="password"
            required
            minLength={10}
            maxLength={128}
            autoComplete="new-password"
            className="input"
          />
          <p className="text-xs text-inksoft mt-1">
            At least 10 characters.
          </p>
        </div>

        <SubmitButton
          pendingText="Creating your account..."
          className="btn-primary w-full"
        >
          Create account
        </SubmitButton>
      </form>
    )}

    <p className="mt-6 text-sm text-inksoft">
      Already have an account?{" "}
      <Link
        href={`/login?next=${encodeURIComponent(next)}`}
        className="text-accenttext"
      >
        Log in
      </Link>
    </p>
  </div>
</div>


);
}
