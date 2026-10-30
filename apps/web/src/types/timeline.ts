export interface TimelineEntry {
  projectId: string;
  projectTitle: string;
  clientName: string;
  projectStatus: string;
  milestoneId: string;
  sequence: number;
  title: string;
  status: string;
  dueDate: string | null;
  amountMinor: string;
  currency: string;
}

export interface TimelineResponse {
  entries: TimelineEntry[];
}
