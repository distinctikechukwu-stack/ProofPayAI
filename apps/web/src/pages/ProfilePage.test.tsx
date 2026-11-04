import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { freelancerProfileInputSchema, type FreelancerProfileInput } from "@proofpay/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ProfilePage, toFreelancerProfileRequestBody } from "./ProfilePage";

const { apiRequestMock, useAuthMock } = vi.hoisted(() => ({
  apiRequestMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock("../contexts/AuthContext", () => ({ useAuth: useAuthMock }));
vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, apiRequest: apiRequestMock };
});

const privateDraft = {
  displayName: "Casey Example",
  avatarUrl: "",
  publicSlug: "casey-example",
  headline: "Product designer",
  biography: "I design clear, accessible product experiences.",
  skills: "Product design, Accessibility",
  experienceSummary: "Several years designing digital products.",
  educationSummary: "Design studies.",
  languages: "English, Yoruba",
  category: "Design & creative",
  hourlyRate: "125.50",
  currency: "USD",
  availability: "available" as const,
  isPublic: false,
  portfolio: [{
    title: "Transit planner",
    description: "A fictional portfolio example.",
    projectUrl: "https://example.invalid/work",
    imageUrl: "",
    featured: true,
  }],
};

function profileResponse(input: FreelancerProfileInput): Record<string, unknown> {
  return {
    account: { display_name: input.displayName, avatar_url: input.avatarUrl },
    roles: ["freelancer"],
    freelancer: {
      public_slug: input.publicSlug,
      headline: input.headline,
      biography: input.biography,
      skills: input.skills,
      experience_summary: input.experienceSummary,
      education_summary: input.educationSummary,
      languages: input.languages,
      category: input.category,
      hourly_rate_minor: input.hourlyRateMinor === null ? null : String(input.hourlyRateMinor),
      currency: input.currency,
      availability: input.availability,
      is_public: input.isPublic,
    },
    portfolio: input.portfolio.map((item) => ({
      title: item.title,
      description: item.description,
      project_url: item.projectUrl,
      image_url: item.imageUrl,
      featured: item.featured,
    })),
    client: null,
  };
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  useAuthMock.mockReset();
});

describe("freelancer profile serialization", () => {
  it("matches the strict API schema and converts the hourly preference to minor units", () => {
    const body = toFreelancerProfileRequestBody(privateDraft);

    expect(body).not.toHaveProperty("hourlyRate");
    expect(body.hourlyRateMinor).toBe(12550);
    expect(freelancerProfileInputSchema.safeParse(body).success).toBe(true);
  });

  it("saves a private profile and reloads the saved fields through the mocked API", async () => {
    const user = userEvent.setup();
    let storedProfile = profileResponse(freelancerProfileInputSchema.parse({
      ...toFreelancerProfileRequestBody({ ...privateDraft, hourlyRate: "75.00", headline: "Initial headline" }),
    }));
    let savedBody: FreelancerProfileInput | undefined;
    useAuthMock.mockReturnValue({
      user: { id: "test-user", email: "casey@example.invalid", user_metadata: { display_name: "Casey Example" } },
      configured: true,
    });
    apiRequestMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path === "/api/profile" && !options?.method) return storedProfile;
      if (path === "/api/profile/freelancer" && options?.method === "POST") {
        const parsed = freelancerProfileInputSchema.safeParse(options.body);
        expect(parsed.success).toBe(true);
        if (!parsed.success) throw new Error("The mocked API received an invalid freelancer profile.");
        savedBody = parsed.data;
        storedProfile = profileResponse(parsed.data);
        return { ok: true };
      }
      throw new Error(`Unexpected profile API request: ${path}`);
    });

    const firstRender = render(<MemoryRouter><ProfilePage /></MemoryRouter>);
    const hourlyRate = await screen.findByLabelText(/Hourly preference/);
    expect(hourlyRate).toHaveValue("75.00");
    await user.clear(hourlyRate);
    await user.type(hourlyRate, "125.50");
    const headline = screen.getByLabelText("Professional headline");
    await user.clear(headline);
    await user.type(headline, "Independent product designer");
    await user.click(screen.getByRole("button", { name: /save freelancer profile/i }));

    expect(await screen.findByRole("status")).toHaveTextContent("Freelancer profile saved as private.");
    expect(savedBody).toBeDefined();
    expect(savedBody).not.toHaveProperty("hourlyRate");
    expect(savedBody?.hourlyRateMinor).toBe(12550);
    expect(savedBody?.isPublic).toBe(false);

    firstRender.unmount();
    render(<MemoryRouter><ProfilePage /></MemoryRouter>);
    expect(await screen.findByLabelText("Professional headline")).toHaveValue("Independent product designer");
    expect(await screen.findByLabelText(/Hourly preference/)).toHaveValue("125.50");
    expect(screen.getByRole("checkbox", { name: /publish my freelancer profile/i })).not.toBeChecked();
  });
});
