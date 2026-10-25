// Content for the search landing pages. Every statement describes behaviour that exists in the product today (order flow, hour-based
// delivery deadlines, automatic link verification, 24-hour monitoring, replacement requests, the Refund Policy). Nothing here promises
// rankings, traffic, indexing or a link lifetime, and there are no testimonials, ratings or statistics.
// Keyword targeting and the reasoning per page: docs/seo/KEYWORD_PAGE_MAP.md.
export type Block =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: [string, string][] };           // [step title, step detail]
export type Section = { h2: string; blocks: Block[]; sub?: { h3: string; blocks: Block[] }[] };
export type Landing = {
  path: string; kind: "service" | "article";
  metaTitle: string; metaDescription: string;
  h1: string; lead: string; crumb: string;
  serviceType?: string;
  sections: Section[];
  faqs: { q: string; a: string }[];
  related: { href: string; label: string }[];
  cta: { href: string; label: string };
};

export const LANDING_PATHS = ["/buy-guest-posts", "/link-insertion-service", "/backlink-monitoring", "/guest-post-vs-link-insertion"] as const;

const REFUND = { href: "/refund-policy", label: "Refund Policy" };

export const LANDINGS: Record<string, Landing> = {
  "/buy-guest-posts": {
    path: "/buy-guest-posts", kind: "service", crumb: "Buy guest posts", serviceType: "Guest post placement marketplace",
    metaTitle: "Buy guest posts on approved publisher websites",
    metaDescription: "Choose an approved website, see the price and delivery time up front, and order a guest post. PostAtlas verifies the live link and keeps monitoring it.",
    h1: "Buy guest posts on websites our team has approved",
    lead: "A guest post is an article published on someone else's website with a link to your page. On PostAtlas you pick the website yourself, see the price, link type and delivery time before you order, and we check that the link is really live afterwards.",
    sections: [
      { h2: "What you get when you buy a guest post", blocks: [
        { kind: "p", text: "You order a placement on one publisher's website. After your payment is approved you send the article, the publisher accepts the order and publishes it, and the publisher submits the live address. PostAtlas then fetches that page and checks that your link is on it and points to the page you chose." },
        { kind: "p", text: "A placement is a link opportunity on a relevant website. We do not promise rankings, traffic or indexing, and we say so on the order page." }] },
      { h2: "How to choose a website", blocks: [
        { kind: "p", text: "Every listing shows what the publisher stated and what PostAtlas has verified, labelled separately. Compare these before you order:" },
        { kind: "ul", items: ["Topic and language, so the link sits next to content that matches your page.", "Price per guest post, shown in USD before you order (you can choose to pay in PKR at a rate that is shown and locked when you order).", "Link type and the publisher's content requirements.", "Delivery time, stated by the publisher in hours. It becomes the deadline for your order.", "Reviews from customers whose placements were published and verified. Reviewers are not named, and each order can be reviewed once."] },
        { kind: "p", text: "Browse the approved websites on the Explore Sites page, or run the free website check to see publishers that fit your topic." }] },
      { h2: "How ordering works", blocks: [{ kind: "ol", items: [
        ["Pick a website and place the order", "Choose the page on your site you want to link to and the link text. The price you see is the price you pay."],
        ["Pay and wait for our confirmation", "Payment is a manual bank or wallet transfer. Our team confirms it before anything starts."],
        ["Send your article", "We scan the article for topics publishers cannot accept (for example gambling, CBD, vape and nicotine, adult content, link networks). Some articles are held for a person to review."],
        ["The publisher accepts and the timer starts", "The delivery clock starts when the publisher accepts. The deadline is the turnaround in hours the website listed when you ordered, and the order page shows a live countdown."],
        ["Publish, verify, monitor", "The publisher submits the live URL, we verify the link, and we re-check it every 24 hours."]] }] },
      { h2: "If something goes wrong", blocks: [
        { kind: "ul", items: ["The publisher declines your paid order: we arrange another publisher on the same terms or refund you.", "The publisher misses the delivery deadline: you choose a refund or an alternative placement.", "A verified link is removed: you and the publisher are notified, and you can request a replacement, which goes to the original publisher and to our team."] },
        { kind: "p", text: "The exact rules are in the Refund Policy. Nothing is refunded automatically; every refund is reviewed by our team and paid back by manual transfer." }] }
    ],
    faqs: [
      { q: "Can I choose the website for my guest post?", a: "Yes. You browse approved websites and pick one. Each listing shows its price, link type, delivery time in hours and content requirements before you order." },
      { q: "Do I write the article myself?", a: "You send the article after your payment is approved. The publisher can decline an article that does not meet their requirements, and we scan every article for topics publishers cannot accept." },
      { q: "How long does a guest post take?", a: "Each website states its own delivery time in hours. The countdown starts when the publisher accepts your order, and the order page shows the time left." },
      { q: "Will a guest post improve my rankings?", a: "We cannot promise that, and nobody honestly can. A guest post is a link opportunity on a relevant website. We make sure it is published as agreed and keep checking that it stays." },
      { q: "What happens if the link disappears?", a: "We re-check every verified link every 24 hours. If it is confirmed missing, you and the publisher are notified and you can request a replacement. See the Refund Policy for refunds and alternatives." }
    ],
    related: [{ href: "/publishers", label: "Explore Sites" }, { href: "/link-insertion-service", label: "Link insertion service" }, { href: "/backlink-monitoring", label: "Backlink monitoring" }, { href: "/pricing", label: "Pricing" }, REFUND],
    cta: { href: "/publishers", label: "Explore Sites" }
  },

  "/link-insertion-service": {
    path: "/link-insertion-service", kind: "service", crumb: "Link insertion service", serviceType: "Link insertion marketplace",
    metaTitle: "Link insertion service (niche edits) for existing articles",
    metaDescription: "Order a link in an article a publisher has already published (a niche edit). See the price first, then PostAtlas verifies the link and keeps monitoring it.",
    h1: "Link insertions: add your link to an article that is already published",
    lead: "A link insertion, often called a niche edit, adds your link to an existing article on a publisher's website instead of publishing a new one. On PostAtlas it is priced per publisher, shown before you order, and verified and monitored like every other placement.",
    sections: [
      { h2: "What a link insertion is", blocks: [
        { kind: "p", text: "Instead of a new article, the publisher adds your link, with the text you choose, to a page that already exists on their website. You tell the publisher where the link should go, and the publisher confirms the order and makes the change." },
        { kind: "p", text: "Not every publisher offers link insertions. A listing shows a link insertion price only when the publisher has set one." }] },
      { h2: "What to check before you order", blocks: [
        { kind: "ul", items: ["The page is about a topic that really fits the page you are linking to.", "The publisher's stated link type and content requirements.", "The price and the delivery time in hours. The deadline starts when the publisher accepts.", "Whether the publisher has reviews from verified buyers."] },
        { kind: "p", text: "Because the article already exists, a link insertion carries a different risk from a guest post: the surrounding content was not written for your link. Relevance matters more, not less." }] },
      { h2: "Ordering, verification and monitoring", blocks: [{ kind: "ol", items: [
        ["Choose a publisher that offers link insertions", "Open a listing and select the link insertion option. The price is shown before you order."],
        ["Describe where the link should go", "Give the page you want to link to and the link text. The publisher accepts or declines."],
        ["Payment is confirmed by our team", "Payment is a manual transfer that a person on our team approves before work starts."],
        ["We verify the live link", "When the publisher submits the address of the edited page, we check that your link is on it and points to the right page."],
        ["We monitor it", "We re-check every 24 hours. If a verified link is confirmed missing, you and the publisher are notified and you can request a replacement."]] }] }
    ],
    faqs: [
      { q: "What is a niche edit?", a: "A niche edit is another name for a link insertion: your link is added to an article that is already published, rather than in a new article." },
      { q: "Is a link insertion cheaper than a guest post?", a: "Prices are set per publisher. Each listing shows its own guest post and link insertion prices, so you can compare them before you order." },
      { q: "Can I pick the article?", a: "You tell the publisher where the link should go. The publisher confirms the order, and you can see their requirements on the listing before you order." },
      { q: "How do you check that the link is there?", a: "When the publisher submits the live address we fetch the page and look for your link, its destination and its attributes. After that we re-check every 24 hours." }
    ],
    related: [{ href: "/buy-guest-posts", label: "Buy guest posts" }, { href: "/guest-post-vs-link-insertion", label: "Guest post vs link insertion" }, { href: "/backlink-monitoring", label: "Backlink monitoring" }, { href: "/publishers", label: "Explore Sites" }, REFUND],
    cta: { href: "/publishers", label: "Explore Sites" }
  },

  "/backlink-monitoring": {
    path: "/backlink-monitoring", kind: "service", crumb: "Backlink monitoring", serviceType: "Backlink verification and monitoring",
    metaTitle: "Backlink verification and monitoring for every placement",
    metaDescription: "PostAtlas checks each link is live when published, re-checks it every 24 hours, and tells you and the publisher if it is removed. Request a replacement.",
    h1: "Backlink verification and monitoring, built into every order",
    lead: "Buying a link is only half the job; the link has to stay. PostAtlas verifies each placement when it is published, re-checks it every 24 hours, and starts a replacement process if a verified link is removed.",
    sections: [
      { h2: "Verification when the link goes live", blocks: [
        { kind: "p", text: "When the publisher submits the live address, PostAtlas fetches the page and checks that your link is present, points to the page you ordered and carries the expected attributes. A placement counts as verified only after that check finds it. The publisher cannot mark it verified by hand." }] },
      { h2: "Monitoring after that", blocks: [
        { kind: "p", text: "Every verified link is re-checked every 24 hours. A single failed fetch never raises an issue, because a slow server is not a removed link. An issue is raised after repeated confirmed failures." },
        { kind: "ul", items: ["You and the publisher are both notified when a verified link is confirmed missing or changed.", "The publisher is asked to restore it at no extra charge.", "You can ask for a replacement instead. The request goes to the original publisher and to our team, and the publisher has a fresh delivery window in hours.", "The publisher submits the replacement's live address and it is verified automatically in the same way."] }] },
      { h2: "What monitoring does not do", blocks: [
        { kind: "p", text: "Monitoring tells you whether your link is on the page. It does not measure rankings, traffic or authority, and PostAtlas does not show backlink numbers unless a real data source supplies them. Where a figure is not measured, the product says so." }] },
      { h2: "Replacement and refunds", blocks: [
        { kind: "p", text: "A verified replacement does not create a second payout to the publisher. If a publisher does not deliver a replacement in time, you can choose a refund or an alternative placement. Refunds are reviewed by our team and paid back manually; the details are in the Refund Policy." }] }
    ],
    faqs: [
      { q: "How often are links checked?", a: "Verified links are re-checked every 24 hours." },
      { q: "Will I be told if a link is removed?", a: "Yes. When a verified link is confirmed missing or changed, you and the publisher are both notified." },
      { q: "Why was my link not flagged after one failed check?", a: "A single failed fetch can be a slow or unavailable server, so it never raises an issue on its own. An issue is raised after repeated confirmed failures." },
      { q: "Can I get a replacement if the link is removed?", a: "Yes. You can request a replacement while the issue is open. The request goes to the original publisher and to our team." },
      { q: "Do you measure rankings or traffic?", a: "No. Monitoring checks whether your link is present and correct. It does not measure rankings, traffic or authority." }
    ],
    related: [{ href: "/how-it-works", label: "How PostAtlas works" }, { href: "/buy-guest-posts", label: "Buy guest posts" }, { href: "/link-insertion-service", label: "Link insertion service" }, REFUND],
    cta: { href: "/check", label: "Check your website free" }
  },

  "/guest-post-vs-link-insertion": {
    path: "/guest-post-vs-link-insertion", kind: "article", crumb: "Guest post vs link insertion",
    metaTitle: "Guest post vs link insertion: which should you buy?",
    metaDescription: "A plain comparison of guest posts and link insertions (niche edits): what each is, the risks, what to check before ordering, and when each one fits.",
    h1: "Guest post vs link insertion: which should you buy?",
    lead: "Both put a link to your page on someone else's website. They differ in what is published, who writes it and what can go wrong. This guide compares them so you can choose without guessing.",
    sections: [
      { h2: "The short answer", blocks: [
        { kind: "ul", items: ["Choose a guest post when you want a page written around your topic and you can supply a good article.", "Choose a link insertion when a relevant article already exists on the site and you only need your link added to it.", "In both cases, relevance of the website and the surrounding content matters more than any single metric."] }] },
      { h2: "Side by side", blocks: [{ kind: "ul", items: [
        "What is published: a guest post is a new article; a link insertion is an edit to an existing one.",
        "Who writes the content: you (or someone you hire) write a guest post; for a link insertion you only provide the link and its text.",
        "Time: a guest post needs an article, an acceptance and publication; a link insertion is a smaller change, but the delivery time is whatever the publisher states.",
        "Main risk: a guest post can be declined or edited; a link insertion sits in content that was not written for your link, so a poor topic match is more visible.",
        "Verification: with either type you should confirm the link is live, points to the right page and has the attributes you were promised."] }] },
      { h2: "What to check whichever you choose", blocks: [
        { kind: "ul", items: ["Does the website publish content about your topic, in your audience's language?", "Is the price, link type and delivery time stated before you pay?", "Who confirms that the link is really live, and does anyone keep checking?", "What happens if the publisher does not deliver, or the link is removed later?"] },
        { kind: "p", text: "Neither type is guaranteed to change your rankings. Treat each as a link opportunity, and judge the website by its relevance." }] },
      { h2: "How PostAtlas handles both", blocks: [
        { kind: "p", text: "Publishers set their own prices for guest posts and link insertions, and a listing shows only what that publisher offers. Both types follow the same order flow, the same hour-based delivery deadline, the same automatic verification and the same monitoring." }] }
    ],
    faqs: [
      { q: "Is a link insertion the same as a niche edit?", a: "Yes. Both terms describe adding a link to an article that is already published." },
      { q: "Which is safer, a guest post or a link insertion?", a: "Neither is safe or unsafe by type. What matters is how relevant the website and the surrounding content are, and whether the link is verified and monitored." },
      { q: "Can I order both from the same website?", a: "Only where the publisher offers both. A listing shows the guest post price and the link insertion price when each is set." }
    ],
    related: [{ href: "/buy-guest-posts", label: "Buy guest posts" }, { href: "/link-insertion-service", label: "Link insertion service" }, { href: "/backlink-monitoring", label: "Backlink monitoring" }, { href: "/publishers", label: "Explore Sites" }],
    cta: { href: "/publishers", label: "Explore Sites" }
  }
};
