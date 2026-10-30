import { describe, expect, it } from "vitest";
import {
  freelancerServiceInputSchema,
  marketplaceJobInputSchema,
  marketplaceOfferInputSchema,
  marketplaceProposalInputSchema,
  publicFreelancerServiceSchema,
} from "../src/marketplace.js";

const job = {
  id: null, idempotencyKey: "a1c20886-3262-42d0-9442-e5a828f8a4ea", title: "Accessible client portal",
  summary: "Build a responsive portal for a small professional services team.",
  description: "Create a responsive customer portal with account pages, clear navigation, and a documented handover.",
  requirements: ["Keyboard-accessible navigation"], skills: ["React", "TypeScript"], category: "Development",
  experienceLevel: "intermediate", projectType: "fixed", fixedBudgetMinor: 60_000, hourlyRateMinMinor: null,
  hourlyRateMaxMinor: null, currency: "USD", estimatedDays: 30,
};

describe("marketplace contract boundaries", () => {
  it("accepts fixed and hourly budgets only in their matching exact minor-unit shape", () => {
    expect(marketplaceJobInputSchema.safeParse(job).success).toBe(true);
    expect(marketplaceJobInputSchema.safeParse({ ...job, fixedBudgetMinor: 60_000.5 }).success).toBe(false);
    expect(marketplaceJobInputSchema.safeParse({ ...job, fixedBudgetMinor: null }).success).toBe(false);
    expect(marketplaceJobInputSchema.safeParse({ ...job, projectType: "hourly", fixedBudgetMinor: null, hourlyRateMinMinor: 12_500, hourlyRateMaxMinor: 10_000 }).success).toBe(false);
    expect(marketplaceJobInputSchema.safeParse({ ...job, createdBy: "client-selected-user" }).success).toBe(false);
  });

  it("validates proposal, offer, and service prices without accepting decimal minor units", () => {
    const proposal = { coverLetter: "I will approach the work with a clear delivery plan and share progress at each review point.", quoteMinor: 60_000, timelineDays: 20, portfolioItemIds: [] };
    expect(marketplaceProposalInputSchema.safeParse(proposal).success).toBe(true);
    expect(marketplaceProposalInputSchema.safeParse({ ...proposal, quoteMinor: 600.25 }).success).toBe(false);
    const offer = { idempotencyKey: "d84ba92f-1fd2-4595-9ce0-0011b273a2f6", terms: "The accepted project includes the listed portal pages and handover.", amountMinor: 60_000, currency: "USD", timelineDays: 20 };
    expect(marketplaceOfferInputSchema.safeParse(offer).success).toBe(true);
    expect(marketplaceOfferInputSchema.safeParse({ ...offer, amountMinor: 600.25 }).success).toBe(false);
  });

  it("requires scoped service packages and emits a strict public service projection", () => {
    const service = {
      id: null, title: "Accessible product landing page", slug: "accessible-product-page",
      description: "A responsive product landing page with keyboard navigation, clear sections, and a handover note.",
      category: "Design and development", startingPriceMinor: 25_000, currency: "USD", deliveryDays: 7,
      deliverables: ["Responsive landing page"], packages: [{ title: "Standard", description: "Landing page and review.", priceMinor: 25_000, deliveryDays: 7, deliverables: ["Landing page"] }],
      portfolioItemIds: [], isPublic: true,
    };
    expect(freelancerServiceInputSchema.safeParse(service).success).toBe(true);
    expect(freelancerServiceInputSchema.safeParse({ ...service, packages: [{ ...service.packages[0], priceMinor: 250.5 }] }).success).toBe(false);
    const publicService = {
      id: "73e6af4b-43dc-4598-b626-942640f2290c", freelancerSlug: "jordan-rivera", freelancerName: "Jordan Rivera",
      slug: service.slug, title: service.title, description: service.description, category: service.category,
      startingPriceMinor: "25000", currency: "USD", deliveryDays: 7, deliverables: service.deliverables,
      packages: [{ title: "Standard", description: "Landing page and review.", priceMinor: "25000", deliveryDays: 7, deliverables: ["Landing page"] }],
    };
    expect(publicFreelancerServiceSchema.safeParse(publicService).success).toBe(true);
    expect(publicFreelancerServiceSchema.safeParse({ ...publicService, clientEmail: "private@example.com" }).success).toBe(false);
  });
});
