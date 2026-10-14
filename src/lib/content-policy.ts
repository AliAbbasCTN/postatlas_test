// First-pass content policy scan. It never rejects anything by itself: a flag
// holds the article for human review and tells the customer why. Admins have
// final moderation authority.

export type PolicyCategory = "gambling" | "cbd" | "vape" | "link_scheme" | "adult";
export type PolicyFlag = { category: PolicyCategory; term: string };

export const POLICY_CATEGORY_LABEL: Record<PolicyCategory, string> = {
  gambling: "Casino and gambling",
  cbd: "CBD and cannabis products",
  vape: "Vape and nicotine products",
  link_scheme: "Link networks and link manipulation",
  adult: "Adult content"
};

const TERMS: Record<PolicyCategory, RegExp[]> = {
  gambling: [/\bcasinos?\b/i, /\bonline betting\b/i, /\bsports ?book\b/i, /\bpoker\b/i, /\bslot machines?\b/i, /\bgambling\b/i],
  cbd: [/\bcbd\b/i, /\bcannabidiol\b/i, /\bmarijuana\b/i, /\bhemp oil\b/i],
  vape: [/\bvap(e|es|ing|ors?)\b/i, /\be-?cigarettes?\b/i, /\bnicotine\b/i],
  link_scheme: [/\bprivate blog network\b/i, /\bpbn\b/i, /\bbuy backlinks\b/i, /\blink farm\b/i],
  adult: [/\bporn(ography)?\b/i, /\bescort services?\b/i]
};

export function scanContentPolicy(...texts: (string | null | undefined)[]): PolicyFlag[] {
  const joined = texts.filter(Boolean).join("\n");
  const flags: PolicyFlag[] = [];
  for (const category of Object.keys(TERMS) as PolicyCategory[]) {
    for (const re of TERMS[category]) {
      const m = joined.match(re);
      if (m) { flags.push({ category, term: m[0].toLowerCase() }); break; }
    }
  }
  return flags;
}

export function describeFlags(flags: { category: PolicyCategory }[]): string {
  return flags.map((f) => POLICY_CATEGORY_LABEL[f.category]).join(", ");
}
