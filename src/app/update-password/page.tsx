import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { redirect } from "next/navigation";
import { updatePassword } from "@/lib/actions/auth";

export const metadata = { title: "Set a new password", robots: { index: false, follow: false } };

export default async function UpdatePasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sp = await searchParams;
  async function action(formData: FormData) {
    "use server";
    const result = await updatePassword(formData);
    if (result?.error) redirect(`/update-password?error=${encodeURIComponent(result.error)}`);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paperdim px-4 py-10">
      <div className="w-full max-w-sm rounded-lg border border-line bg-white p-6 shadow-card sm:p-8">
        <Link href="/" className="flex items-center gap-2 font-serif font-bold text-xl mb-8">
          <BrandMark size={28} /> PostAtlas
        </Link>
        <h1 className="font-serif font-bold text-2xl mb-6">Set a new password</h1>
        {sp.error && <div className="mb-4 border border-redsig bg-[#F4E1DC] text-redsig rounded p-3 text-sm">{sp.error}</div>}
        <form action={action}>
          <div className="mb-5">
            <label htmlFor="password" className="block text-sm mb-1.5">New password</label>
            <input id="password" autoComplete="new-password" type="password" name="password" required minLength={10} maxLength={128} className="w-full border border-line rounded px-3 py-2.5 text-sm" />
          </div>
          <button type="submit" className="btn-primary w-full">Update Password</button>
        </form>
      </div>
    </div>
  );
}
