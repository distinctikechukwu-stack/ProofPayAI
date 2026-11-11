import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicesPage } from "./InvoicesPage";

const mocks = vi.hoisted(() => ({ apiRequest: vi.fn() }));
const originalTimezone = process.env.TZ;
const paymentDate = "2026-11-07T00:00:00.000Z";
const dueDate = "2026-11-07T00:00:00.000Z";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "invoice-owner" } }),
}));

vi.mock("../lib/api", () => ({
  apiRequest: mocks.apiRequest,
  ApiError: class ApiError extends Error {},
}));

function invoiceResponse(paidAt: string | null = paymentDate) {
  return {
    invoices: [{
      id: "invoice-1",
      projectId: "project-1",
      projectTitle: "Website project",
      sourceType: "milestone" as const,
      milestoneId: "milestone-1",
      hourlyBatchId: null,
      invoiceNumber: "PP-TEST-001",
      invoiceUrl: null,
      status: "paid",
      providerStatus: "PAID",
      amountMinor: "10000",
      currency: "USD",
      dueDate,
      paidAt,
      createdAt: null,
      updatedAt: null,
    }],
    candidates: [{
      projectId: "project-2",
      projectTitle: "Due date project",
      clientName: "Sample client",
      milestoneId: "milestone-2",
      milestoneTitle: "First milestone",
      amountMinor: "10000",
      currency: "USD",
      dueDate,
      invoiceId: null,
      invoiceStatus: null,
    }],
    hourlyCandidates: [],
    integrations: { paypalSandbox: true, webhook: true, invoiceOperations: true },
  };
}

function setTimezone(timezone: string) {
  process.env.TZ = timezone;
  expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(timezone);
}

async function renderInvoices() {
  render(<InvoicesPage />);
  return screen.findByText("Website project");
}

describe("invoice payment-date presentation", () => {
  beforeEach(() => {
    mocks.apiRequest.mockReset().mockResolvedValue(invoiceResponse());
  });

  afterEach(() => {
    cleanup();
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it.each(["UTC", "America/Los_Angeles", "Africa/Lagos"])(
    "keeps a date-only PayPal payment on November 7 when the browser is in %s",
    async (timezone) => {
      setTimezone(timezone);
      await renderInvoices();

      expect(screen.getByText(/paid November 7, 2026/)).toBeInTheDocument();
    },
  );

  it("shows the UTC calendar day for a genuine timestamp without showing an exact time", async () => {
    setTimezone("America/Los_Angeles");
    mocks.apiRequest.mockResolvedValue(invoiceResponse("2026-11-07T23:30:00-05:00"));
    await renderInvoices();

    const paymentSummary = screen.getByText(/paid November 8, 2026/);
    expect(paymentSummary).toBeInTheDocument();
    expect(paymentSummary.textContent).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("labels an invalid payment timestamp as unavailable rather than displaying a normalized date", async () => {
    mocks.apiRequest.mockResolvedValue(invoiceResponse("2026-02-31T11:00:00Z"));
    await renderInvoices();

    expect(screen.getByText(/paid date unavailable/)).toBeInTheDocument();
  });

  it("preserves the existing browser-local due-date formatting", async () => {
    setTimezone("America/Los_Angeles");
    await renderInvoices();

    const dueSummary = screen.getByText((_, element) =>
      element?.tagName === "SMALL" && Boolean(element.textContent?.includes("due ")),
    );
    expect(dueSummary.textContent).toContain(`due ${new Date(dueDate).toLocaleDateString()}`);
    expect(new Date(dueDate).toLocaleDateString()).not.toBe("11/7/2026");
  });
});
