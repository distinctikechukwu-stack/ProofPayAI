import { z } from "zod";

const shortText = (max: number) => z.string().trim().max(max);
const httpsUrl = z.string().trim().url().refine((value) => value.startsWith("https://"), "Use an HTTPS URL.");
const uniqueTextList = (maxItems: number, maxLength: number) => z.array(z.string().trim().min(1).max(maxLength)).max(maxItems)
  .refine((items) => new Set(items.map((item) => item.toLocaleLowerCase())).size === items.length, "Remove duplicate entries.");

export const marketplaceRoleSelectionSchema = z.object({
  roles: z.array(z.enum(["freelancer", "client"])).min(1).max(2)
    .refine((roles) => new Set(roles).size === roles.length, "Choose each role only once."),
});

export const freelancerProfileInputSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  avatarUrl: httpsUrl.nullable(),
  publicSlug: z.string().trim().toLowerCase().min(3).max(48).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  headline: shortText(120),
  biography: shortText(2400),
  skills: uniqueTextList(20, 40),
  experienceSummary: shortText(1800),
  educationSummary: shortText(1200),
  languages: uniqueTextList(12, 40),
  category: shortText(80),
  hourlyRateMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  availability: z.enum(["available", "limited", "unavailable"]),
  isPublic: z.boolean(),
  portfolio: z.array(z.object({
    title: z.string().trim().min(2).max(120),
    description: shortText(1000),
    projectUrl: httpsUrl.nullable(),
    imageUrl: httpsUrl.nullable(),
    featured: z.boolean(),
  })).max(12),
}).strict();

export const clientProfileInputSchema = z.object({
  accountType: z.enum(["individual", "business"]),
  organizationName: shortText(160),
  organizationDescription: shortText(1800),
  websiteUrl: httpsUrl.nullable(),
  billingEmail: z.string().trim().email().max(254).nullable(),
}).strict();

export const publicFreelancerProfileSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  headline: z.string(),
  biography: z.string(),
  skills: z.array(z.string()),
  experienceSummary: z.string(),
  educationSummary: z.string(),
  languages: z.array(z.string()),
  category: z.string(),
  hourlyRateMinor: z.string().regex(/^\d+$/).nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  availability: z.enum(["available", "limited", "unavailable"]),
  portfolio: z.array(z.object({
    title: z.string(), description: z.string(), projectUrl: z.string().url().nullable(),
    imageUrl: z.string().url().nullable(), featured: z.boolean(),
  })),
}).strict();

export type FreelancerProfileInput = z.infer<typeof freelancerProfileInputSchema>;
export type ClientProfileInput = z.infer<typeof clientProfileInputSchema>;
export type PublicFreelancerProfile = z.infer<typeof publicFreelancerProfileSchema>;
