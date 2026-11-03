import { useEffect, useRef, useState } from "react";
import { marketplaceProposalInputSchema, type MarketplaceProposalInput } from "@proofpay/shared";

export type ProposalReviewPortfolioItem = { id: string; title: string };

export function FreelancerProposalReview({
  coverLetter, quoteText, quoteMinor, quotePreview, currency, timelineText, timelineDays,
  portfolioItemIds, portfolio, onEdit, onRemoveUnavailableReference, onConfirm,
}: {
  coverLetter: string;
  quoteText: string;
  quoteMinor: number | null;
  quotePreview: string;
  currency: string;
  timelineText: string;
  timelineDays: number;
  portfolioItemIds: string[];
  portfolio: ProposalReviewPortfolioItem[];
  onEdit: () => void;
  onRemoveUnavailableReference: (id: string) => void;
  onConfirm: (input: MarketplaceProposalInput) => Promise<void>;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submissionLockedRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submissionError, setSubmissionError] = useState("");

  useEffect(() => { headingRef.current?.focus(); }, []);

  const parsed = marketplaceProposalInputSchema.safeParse({
    coverLetter,
    quoteMinor,
    timelineDays,
    portfolioItemIds,
  });
  const availableIds = new Set(portfolio.map((item) => item.id));
  const unavailableIds = portfolioItemIds.filter((id) => !availableIds.has(id));
  const errors: string[] = parsed.success ? [] : [...new Set(parsed.error.issues.map((issue) => {
    const field = issue.path[0];
    if (field === "coverLetter") return "Cover letter must contain 30 to 5,000 characters.";
    if (field === "quoteMinor") return "Enter a positive exact quote using the job currency.";
    if (field === "timelineDays") return "Delivery timeline must be a whole number from 1 to 3,650 days.";
    if (field === "portfolioItemIds") return "Select no more than 12 valid portfolio references.";
    return "Review the proposal details before continuing.";
  }))];
  if (unavailableIds.length > 0) errors.push("Remove portfolio references that are no longer available.");
  const canSubmit = parsed.success && unavailableIds.length === 0 && !submitting && !submitted;

  const confirmSubmission = async () => {
    if (submissionLockedRef.current || !canSubmit || !parsed.success) return;
    const input = parsed.data;
    submissionLockedRef.current = true;
    setSubmitting(true);
    setSubmissionError("");
    try {
      await onConfirm(input);
      setSubmitted(true);
    } catch (reason) {
      submissionLockedRef.current = false;
      setSubmissionError(reason instanceof Error ? reason.message : "Proposal could not be submitted. Review the details and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const amountLabel = quoteMinor === null
    ? quoteText.trim() ? `Invalid amount: ${quoteText.trim()} ${currency}` : "Amount missing."
    : `${quotePreview} (${currency})`;
  const timelineLabel = Number.isSafeInteger(timelineDays) && timelineDays > 0
    ? `${timelineText.trim()} days`
    : timelineText.trim() ? `Invalid timeline: ${timelineText.trim()}` : "Timeline missing.";

  return <section className="marketplace-proposal-review" aria-labelledby="proposal-review-heading">
    <div className="marketplace-proposal-review-heading">
      <div>
        <span className="eyebrow">FINAL REVIEW</span>
        <h3 id="proposal-review-heading" ref={headingRef} tabIndex={-1}>Review your proposal</h3>
        <p>Check what will be sent to the client. You can return to editing before confirming.</p>
      </div>
    </div>
    {errors.length > 0 && <div id="proposal-review-errors" className="marketplace-proposal-review-errors" role="alert" aria-labelledby="proposal-review-errors-heading">
      <h4 id="proposal-review-errors-heading">Update these details before submitting</h4>
      <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
    </div>}
    <dl className="marketplace-proposal-review-details">
      <div className="marketplace-proposal-review-cover-letter"><dt>Cover letter</dt><dd>{coverLetter.trim() || "No cover letter provided."}</dd></div>
      <div><dt>Proposed amount</dt><dd>{amountLabel}</dd></div>
      <div><dt>Delivery timeline</dt><dd>{timelineLabel}</dd></div>
      <div className="marketplace-proposal-review-portfolio">
        <dt>Selected portfolio references</dt>
        <dd>
          {portfolioItemIds.length === 0 ? <span>No portfolio references selected.</span> : <ul>
            {portfolioItemIds.map((id, index) => {
              const item = portfolio.find((entry) => entry.id === id);
              return <li key={`${id}-${index}`}>
                <span>{item?.title ?? "Selected reference unavailable"}</span>
                {!item && <button type="button" className="marketplace-text-action" aria-label={`Remove unavailable portfolio reference ${index + 1}`} disabled={submitting || submitted} onClick={() => onRemoveUnavailableReference(id)}>Remove</button>}
              </li>;
            })}
          </ul>}
        </dd>
      </div>
    </dl>
    {submitting && <p className="marketplace-proposal-review-status" role="status" aria-live="polite">Submitting proposal…</p>}
    {submissionError && <p className="marketplace-proposal-review-error" role="alert">{submissionError}</p>}
    {submitted && <p className="marketplace-proposal-review-status" role="status" aria-live="polite">Proposal submitted successfully.</p>}
    <div className="marketplace-proposal-review-actions">
      <button type="button" className="button-secondary" disabled={submitting || submitted} onClick={onEdit}>Return to editing</button>
      <button type="button" className="button-primary" disabled={!canSubmit} aria-describedby={errors.length > 0 ? "proposal-review-errors" : undefined} onClick={() => void confirmSubmission()}>
        {submitting ? "Submitting proposal…" : submitted ? "Proposal submitted" : "Confirm and submit proposal"}
      </button>
    </div>
  </section>;
}
