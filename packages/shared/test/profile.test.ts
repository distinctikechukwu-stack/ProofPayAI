import { describe, expect, it } from "vitest";
import {
  clientProfileInputSchema,
  freelancerProfileInputSchema,
  marketplaceRoleSelectionSchema,
  publicFreelancerProfileSchema,
} from "../src/profile.js";

const freelancer = {
  displayName: "Jordan Rivera", avatarUrl: null, publicSlug: "jordan-rivera", headline: "Product designer",
  biography: "I design accessible tools.", skills: ["Research", "Figma"], experienceSummary: "Eight years in product design.",
  educationSummary: "Design studies.", languages: ["English"], category: "Design", hourlyRateMinor: 7500,
  currency: "USD", availability: "available", isPublic: true,
  portfolio: [{ title: "Transit planning", description: "A public case study.", projectUrl: "https://example.com/work", imageUrl: null, featured: true }],
};

describe("marketplace profile boundaries", () => {
  it("permits freelancer, client, and dual-role selections but never a self-selected admin role", () => {
    expect(marketplaceRoleSelectionSchema.safeParse({ roles: ["freelancer"] }).success).toBe(true);
    expect(marketplaceRoleSelectionSchema.safeParse({ roles: ["freelancer", "client"] }).success).toBe(true);
    expect(marketplaceRoleSelectionSchema.safeParse({ roles: ["admin"] }).success).toBe(false);
    expect(marketplaceRoleSelectionSchema.safeParse({ roles: ["client", "client"] }).success).toBe(false);
  });

  it("validates exact integer minor-unit rates, HTTPS links, and duplicate-free tags", () => {
    expect(freelancerProfileInputSchema.safeParse(freelancer).success).toBe(true);
    expect(freelancerProfileInputSchema.safeParse({ ...freelancer, hourlyRateMinor: 75.5 }).success).toBe(false);
    expect(freelancerProfileInputSchema.safeParse({ ...freelancer, avatarUrl: "http://example.com/me.png" }).success).toBe(false);
    expect(freelancerProfileInputSchema.safeParse({ ...freelancer, skills: ["Design", "design"] }).success).toBe(false);
    expect(freelancerProfileInputSchema.safeParse({ ...freelancer, extraPrivateField: "leak" }).success).toBe(false);
  });

  it("keeps client billing fields in the private client profile schema", () => {
    expect(clientProfileInputSchema.safeParse({
      accountType: "business", organizationName: "Northstar", organizationDescription: "A design studio.",
      websiteUrl: "https://northstar.example", billingEmail: "billing@northstar.example",
    }).success).toBe(true);
    expect(clientProfileInputSchema.safeParse({
      accountType: "business", organizationName: "Northstar", organizationDescription: "", websiteUrl: "http://northstar.example", billingEmail: null,
    }).success).toBe(false);
  });

  it("rejects private account fields in the public profile projection", () => {
    const publicShape = {
      slug: "jordan-rivera", displayName: "Jordan Rivera", avatarUrl: null, headline: "Product designer",
      biography: "I design accessible tools.", skills: ["Research"], experienceSummary: "", educationSummary: "",
      languages: [], category: "Design", hourlyRateMinor: "7500", currency: "USD", availability: "available", portfolio: [],
    };
    expect(publicFreelancerProfileSchema.safeParse(publicShape).success).toBe(true);
    expect(publicFreelancerProfileSchema.safeParse({ ...publicShape, billingEmail: "private@example.com" }).success).toBe(false);
  });
});
