export interface AnalyticsGridRow {
  id: string;
  status: string;
  currency: string;
  title?: string;
  budgetMinor?: string | number;
  deadline?: string | null;
  updatedAt?: string | null;
  projectId?: string;
  projectTitle?: string;
  invoiceNumber?: string;
  amountMinor?: string | number;
  createdAt?: string | null;
  paidAt?: string | null;
}

export interface AnalyticsProjectRow extends AnalyticsGridRow {
  title: string;
  budgetMinor: string | number;
  deadline: string | null;
  updatedAt: string | null;
}

export interface AnalyticsInvoiceRow extends AnalyticsGridRow {
  projectId: string;
  projectTitle: string;
  invoiceNumber: string;
  amountMinor: string | number;
  createdAt: string | null;
  paidAt: string | null;
}

export interface AnalyticsResponse {
  summary: {
    projectCount: number;
    activeProjectCount: number;
    milestoneCount: number;
    approvedMilestoneCount: number;
    invoiceCount: number;
    paidInvoiceCount: number;
    paidTotals: Array<{ currency: string; amountMinor: string }>;
  };
  projects: AnalyticsProjectRow[];
  invoices: AnalyticsInvoiceRow[];
}
