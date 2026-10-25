import { permanentRedirect } from "next/navigation";

// The Authority Audit now lives at /check (no account needed).
export default function AuthorityAuditRedirect() {
  permanentRedirect("/check");
}
