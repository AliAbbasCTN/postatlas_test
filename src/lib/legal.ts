// Shared facts for the legal pages. Dates and the governing law are set here once so the three documents never disagree.
// BEFORE LAUNCH: have a qualified lawyer review all three pages and confirm LEGAL.governingLaw and the operator details.
export const LEGAL = {
  operator: "PostAtlas",
  effectiveDate: "October 17, 2026",
  governingLaw: "the laws of Pakistan",
  contactPath: "/contact"
} as const;
