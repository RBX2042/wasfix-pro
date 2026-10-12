/**
 * schema.org JSON-LD builders (decision D23).
 *
 * The rule: a builder takes only inputs the page also shows, and leaves out what it was not given. Nothing is
 * defaulted to a plausible value. In particular this module has NO builder for AggregateRating, Review or
 * FAQPage: a rating is emitted only from stored, moderated reviews (src/lib/reviews.ts) that the same page
 * prints, and a FAQPage only for questions the page prints. scripts/qa-seo.ts checks both against the HTML
 * of every page it crawls, so a block added later in some page file is caught there.
 *
 * Pure on purpose (no server-only imports; the company arrives as a plain object): scripts/qa-seo.ts imports
 * it to test the escaping and the "leave out what is not configured" rules directly.
 */
import { absoluteUrl } from "./site-url";
import { clipAtWord } from "./seo-text";

type Json = Record<string, unknown>;

/**
 * The text of a <script type="application/ld+json"> element. JSON.stringify alone is not safe inside HTML: a
 * value containing "</script>" (a part description an admin typed, a review body a visitor wrote) would end
 * the element and the rest would be parsed as markup. "<" becomes <, which JSON reads back as "<", and
 * the two line separators that are valid in JSON but not in every JavaScript engine are escaped too.
 */
export function ldJson(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

const CONTEXT = "https://schema.org";

/** What the site publishes about the company: the same fields publicCompany() (src/lib/company.ts) returns. */
export type CompanyFacts = {
  name: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  kvk: string | null;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  /** The complete fiscal identity is configured: only then is `name` a real legal name. */
  ready: boolean;
};

/**
 * The organisation behind the site. Brand name, address of the website and logo are always true; the legal
 * name, postal address, KvK, VAT number, e-mail and phone are added only when they are configured (a
 * placeholder is already null in publicCompany()), and an incomplete address is left out as a whole rather
 * than printed with a bare country. The logo is the 180 px app icon (Google asks for at least 112 px).
 */
export function organizationLd(company: CompanyFacts | null, opts: { name: string; description: string }): Json {
  const c = company;
  const address = c && c.street && c.postalCode && c.city
    ? { "@type": "PostalAddress", streetAddress: c.street, postalCode: c.postalCode, addressLocality: c.city, addressCountry: "NL" }
    : null;
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    name: opts.name,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/apple-icon"),
    description: opts.description,
    ...(c && c.ready && c.name ? { legalName: c.name } : {}),
    ...(address ? { address } : {}),
    ...(c?.vatNumber ? { vatID: c.vatNumber } : {}),
    ...(c?.kvk ? { identifier: { "@type": "PropertyValue", propertyID: "KvK", value: c.kvk } } : {}),
    ...(c?.email ? { email: c.email } : {}),
    ...(c?.phone ? { telephone: c.phone } : {}),
  };
}

/**
 * The website. `searchPath` is the address of a search results page with the literal {search_term_string}
 * in it; give it only for a results page that works (the /foutcodes?q= list does: scripts/qa-seo.ts opens it).
 */
export function websiteLd(opts: { name: string; searchPath?: string }): Json {
  return {
    "@context": CONTEXT,
    "@type": "WebSite",
    name: opts.name,
    url: absoluteUrl("/"),
    inLanguage: "nl-NL",
    ...(opts.searchPath
      ? { potentialAction: { "@type": "SearchAction", target: absoluteUrl(opts.searchPath), "query-input": "required name=search_term_string" } }
      : {}),
  };
}

/**
 * A breadcrumb trail. It must be the trail the page prints: same names, same order, and every crumb with a
 * `path` is a page that exists and is indexable (scripts/qa-seo.ts opens each). The last crumb is the page
 * itself and takes no `path`.
 */
export function breadcrumbLd(crumbs: ReadonlyArray<{ name: string; path?: string }>): Json {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      ...(c.path ? { item: absoluteUrl(c.path) } : {}),
    })),
  };
}

/**
 * The catalogue's label for a part that fits several makes ("Universeel" = universal). It says what the part fits,
 * not who made it, so it is never published as the Product's brand.
 */
export const UNIVERSAL_BRAND = "Universeel";

export type ProductLdInput = {
  sku: string;
  name: string;
  description: string;
  brand: string;
  categoryLabel: string;
  priceEur: number;
  inStock: boolean;
  /** A real photo (src/lib/static-db.ts realImageUrl), never a placeholder tile; null = no image property. */
  imageUrl: string | null;
  /** What shipping costs for ONE of this part (0 above the free-shipping threshold). */
  shippingEur: number;
  returnDays: number;
  /** From src/lib/reviews.ts, built from stored moderated reviews; undefined when there are none. */
  aggregateRating?: Json;
  review?: Json[];
};

/**
 * Product + Offer. Price and availability are the database's; the shipping rate is the one a single unit of
 * this part is charged; the return window and who pays are what /retourvoorwaarden says. No GTIN, MPN or
 * delivery time is invented, `image` is left out when there is no real photo, and `brand` is left out for a
 * universal part (UNIVERSAL_BRAND is a compatibility label, not a manufacturer).
 *
 * The return policy describes the standard case, the 30-day change of mind, where the customer pays the return
 * shipping (retourvoorwaarden, section 4). A defective or wrongly delivered part and a warranty claim are free;
 * a single returnFees value cannot say both, so the policy links to the terms page that does (merchantReturnLink).
 */
export function productLd(p: ProductLdInput): Json {
  const url = absoluteUrl(`/onderdelen/${encodeURIComponent(p.sku)}`);
  return {
    "@context": CONTEXT,
    "@type": "Product",
    name: p.name,
    ...(p.imageUrl ? { image: [p.imageUrl] } : {}),
    description: p.description,
    sku: p.sku,
    ...(p.brand && p.brand !== UNIVERSAL_BRAND ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    category: p.categoryLabel,
    offers: {
      "@type": "Offer",
      url,
      priceCurrency: "EUR",
      price: p.priceEur.toFixed(2),
      availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      seller: { "@type": "Organization", name: "WasFix Pro" },
      shippingDetails: {
        "@type": "OfferShippingDetails",
        shippingRate: { "@type": "MonetaryAmount", value: p.shippingEur.toFixed(2), currency: "EUR" },
        shippingDestination: { "@type": "DefinedRegion", addressCountry: "NL" },
      },
      hasMerchantReturnPolicy: {
        "@type": "MerchantReturnPolicy",
        applicableCountry: "NL",
        returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
        merchantReturnDays: p.returnDays,
        returnMethod: "https://schema.org/ReturnByMail",
        returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
        merchantReturnLink: absoluteUrl("/retourvoorwaarden"),
      },
    },
    ...(p.aggregateRating ? { aggregateRating: p.aggregateRating } : {}),
    ...(p.review && p.review.length > 0 ? { review: p.review } : {}),
  };
}

/**
 * An article written by the site. `datePublished` only for a page that shows its date to the reader. The
 * headline is cut to Google's 110 characters at a word boundary. Author and publisher are the organisation:
 * no invented person.
 */
export function articleLd(a: { headline: string; description: string; path: string; section?: string; datePublished?: string }): Json {
  return {
    "@context": CONTEXT,
    "@type": "Article",
    headline: clipAtWord(a.headline, 110),
    description: a.description,
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(a.path) },
    ...(a.section ? { articleSection: a.section } : {}),
    ...(a.datePublished ? { datePublished: a.datePublished } : {}),
    author: { "@type": "Organization", name: "WasFix Pro" },
    publisher: { "@type": "Organization", name: "WasFix Pro", logo: { "@type": "ImageObject", url: absoluteUrl("/apple-icon") } },
  };
}
