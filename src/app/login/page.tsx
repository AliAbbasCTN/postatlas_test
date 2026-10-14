import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { redirect } from "next/navigation";
import { signIn } from "@/lib/actions/auth";
import { safeRedirectPath } from "@/lib/url-safety";
import { getSession } from "@/lib/auth";
import { FormFeedback } from "@/components/FormFeedback";
import { SubmitButton } from "@/components/SubmitButton";

export const metadata = { title: "Log in", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = safeRedirectPath(sp.next);
  if (await getSession()) redirect(next);

  async function action(formData: FormData) {
    "use server";
    const result = await signIn(formData); // on success signIn redirects itself
    if (result?.error) redirect(`/login?error=${encodeURIComponent(result.error)}&next=${encodeURIComponent(safeRedirectPath(formData.get("next")))}`);
    // No error and no redirect can only mean something unexpected: never fall through to a protected page.
    redirect("/login?error=" + encodeURIComponent("Sign-in did not complete. Please try again."));
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-2 font-serif font-bold text-xl mb-8"><BrandMark size={28} /> PostAtlas</Link>
        <h1 className="font-serif font-bold text-2xl mb-6">Log in to your account</h1>
        <FormFeedback error={sp.error} />
        <form action={action}>
          <input type="hidden" name="next" value={next} />
          <div className="mb-4"><label htmlFor="email" className="label">Email</label><input id="email" type="email" name="email" required autoComplete="email" className="input" /></div>
          <div className="mb-2"><label htmlFor="password" className="label">Password</label><input id="password" type="password" name="password" required autoComplete="current-password" className="input" /></div>
          <div className="mb-5 text-right"><Link href="/reset-password" className="text-sm text-verdigrisdark">Forgot password?</Link></div>
          <SubmitButton pendingText="Signing in..." className="btn-primary w-full">Log in</SubmitButton>
        </form>
        <p className="mt-6 text-sm text-inksoft">No account yet? <Link href={`/signup?next=${encodeURIComponent(next)}`} className="text-verdigrisdark">Create one</Link></p>
      </div>
    </div>
  );
}
