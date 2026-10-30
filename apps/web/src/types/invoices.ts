export interface PayableMilestone {
  sourceType?: "milestone";
  projectId: string;
  projectTitle: string;
  clientName: string;
  milestoneId: string;
  milestoneTitle: string;
  amountMinor: string;
  currency: string;
  dueDate: string | null;
  invoiceId: string | null;
  invoiceStatus: string | null;
}

export interface HourlyInvoiceCandidate {
  projectId: string;
  projectTitle: string;
  clientName: string;
  hourlyRateMinor: string;
  currency: string;
  approvedSeconds: number;
  amountMinor: string;
  workDateStart: string;
  workDateEnd: string;
  entryCount: number;
}

export interface InvoiceRecord {
  id: string;
  projectId: string;
  projectTitle: string;
  sourceType: "milestone" | "hourly";
  milestoneId: string | null;
  hourlyBatchId: string | null;
  invoiceNumber: string;
  invoiceUrl: string | null;
  status: string;
  providerStatus: string | null;
  amountMinor: string;
  currency: string;
  dueDate: string | null;
  paidAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface InvoicesResponse {
  invoices: InvoiceRecord[];
  candidates: PayableMilestone[];
  hourlyCandidates: HourlyInvoiceCandidate[];
  integrations: {
    paypalSandbox: boolean;
    webhook: boolean;
    invoiceOperations: boolean;
  };
}
