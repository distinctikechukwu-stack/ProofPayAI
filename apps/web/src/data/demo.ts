export type ProjectStatus = "In progress" | "Awaiting approval" | "Ready to invoice";

export interface Milestone {
  id: string;
  title: string;
  description: string;
  amountCents: number;
  dueDate: string;
  dueLabel: string;
  status: "Approved" | "In progress" | "Not started";
}

export const demoProject = {
  id: "studio-website",
  name: "Studio website refresh",
  client: "Northstar Studio",
  initials: "NS",
  budgetCents: 60_000,
  currency: "USD",
  deadlineLabel: "Nov 30, 2026",
  description:
    "A clearer, faster website that introduces the studio and makes it simple for prospective clients to get in touch.",
  milestones: [
    {
      id: "discovery",
      title: "Discovery & wireframes",
      description: "Align on goals, page structure, and low-fidelity layouts.",
      amountCents: 15_000,
      dueDate: "2026-11-06",
      dueLabel: "Nov 6",
      status: "Approved",
    },
    {
      id: "visual-design",
      title: "Visual design & content",
      description: "Deliver the responsive design system and approved page content.",
      amountCents: 25_000,
      dueDate: "2026-11-16",
      dueLabel: "Nov 16",
      status: "In progress",
    },
    {
      id: "build-launch",
      title: "Build, QA & launch",
      description: "Implement the agreed pages, test on key devices, and publish.",
      amountCents: 20_000,
      dueDate: "2026-11-30",
      dueLabel: "Nov 30",
      status: "Not started",
    },
  ] satisfies Milestone[],
};

export const acceptedScopeExcerpt =
  "The site will provide responsive pages for Home, Services, About, and Contact, with contact form routing to the client's email. Scheduling, calendar integrations, and appointment booking are not included unless added by written change order.";

export function formatMoney(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function sumMilestonesCents(milestones: Milestone[]): number {
  return milestones.reduce((total, milestone) => total + milestone.amountCents, 0);
}
