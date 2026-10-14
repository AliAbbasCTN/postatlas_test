"use client";

import { useFormStatus } from "react-dom";

// Disables itself while the form is submitting (prevents double orders/payments) and tells the person something
// is happening, which matters most for the website check that can take up to half a minute.
export function SubmitButton({ children, pendingText = "Working...", className = "btn-primary", note }: { children: React.ReactNode; pendingText?: string; className?: string; note?: string }) {
  const { pending } = useFormStatus();
  return (
    <span className="inline-flex flex-col gap-2">
      <button type="submit" disabled={pending} aria-disabled={pending} className={`${className} disabled:opacity-70 disabled:cursor-wait`}>
        {pending && <span aria-hidden className="mr-2 inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />}
        {pending ? pendingText : children}
      </button>
      {pending && note && <span role="status" className="text-xs text-inksoft max-w-[46ch]">{note}</span>}
    </span>
  );
}
