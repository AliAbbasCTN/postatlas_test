import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { redirect } from "next/navigation";
import { requestPasswordReset } from "@/lib/actions/auth";

export const metadata = { title: "Reset password", robots: { index: false, follow: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  const sp = await searchParams;
  async function action(formData: FormData) {
    "use server";
    await requestPasswordReset(formData);
    redirect("/reset-password?sent=1");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-6">
      <div className="w-full max-w-sm">
        <Link href="/" className="flex items-center gap-2 font-serif font-bold text-xl mb-8">
          <BrandMark size={28} /> PostAtlas
        </Link>
        <h1 className="font-serif font-bold text-2xl mb-3">Reset your password</h1>
        <p className="text-sm text-inksoft mb-6">Enter your account email and we&apos;ll send a reset link if it matches an account.</p>
        {sp.sent && <p role="status" className="mb-4 text-sm text-verdigrisdark">If an account exists for that email, a reset link has been sent.</p>}
        <form action={action}>
          <div className="mb-5"><label htmlFor="email" className="block text-sm mb-1.5">Email</label><input id="email" type="email" name="email" required maxLength={254} className="w-full border border-line rounded px-3 py-2.5 text-sm" /></div>
          <button type="submit" className="w-full py-2.5 bg-ink text-paper rounded text-sm">Send Reset Link</button>
        </form>
      </div>
    </div>
  );
}
