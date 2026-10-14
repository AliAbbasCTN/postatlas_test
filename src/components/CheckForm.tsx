import { startSiteCheck } from "@/lib/actions/public-check";
import { SubmitButton } from "@/components/SubmitButton";
import { NICHES } from "@/lib/niches";

// The website checker. No account is needed to use it.
export function CheckForm({ defaultDomain = "", defaultCategory = "", id = "check" }: { defaultDomain?: string; defaultCategory?: string; id?: string }) {
  return (
    <form action={startSiteCheck} className="w-full" aria-label="Check your website">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <label htmlFor={`${id}-domain`} className="label">Your website</label>
          <input id={`${id}-domain`} name="domain" required maxLength={300} defaultValue={defaultDomain} placeholder="yourwebsite.com" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} className="input !py-3.5 !text-base" />
        </div>
        <div>
          <label htmlFor={`${id}-category`} className="label">What is it about?</label>
          <select id={`${id}-category`} name="category" required defaultValue={defaultCategory} className="input !py-3.5 !text-base sm:w-56">
            <option value="" disabled>Choose a topic</option>
            {NICHES.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
      </div>
      <div aria-hidden="true" className="absolute -left-[9999px]"><label>Leave empty<input tabIndex={-1} autoComplete="off" name="company_website_hp" /></label></div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        <SubmitButton pendingText="Checking your website..." className="btn-primary !px-7 !py-3.5 !text-base" note="Reading your public pages. This usually takes 10 to 30 seconds - please keep this page open.">Check my website - free</SubmitButton>
        <span className="text-sm text-inksoft">No account needed. Takes about 30 seconds.</span>
      </div>
    </form>
  );
}
