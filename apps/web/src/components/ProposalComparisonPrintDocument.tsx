import { createPortal } from "react-dom";

export type PrintableProposalSummary = {
  amount: string;
  timeline: string;
  status: string;
  coverLetter: string | null;
  portfolioReferences: string;
};

const coverLetterExcerptLength = 500;

export function ProposalComparisonPrintDocument({
  jobTitle,
  proposals,
}: {
  jobTitle: string;
  proposals: PrintableProposalSummary[];
}) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <main className="marketplace-comparison-print-document" aria-hidden="true">
      <header className="marketplace-comparison-print-heading">
        <p className="marketplace-comparison-print-eyebrow">PROOFPAY AI · MARKETPLACE</p>
        <h1>Proposal comparison summary</h1>
        <p><strong>Job:</strong> {jobTitle.trim() || "Job title not provided"}</p>
        <p>{proposals.length} selected proposals</p>
      </header>
      <ol className="marketplace-comparison-print-grid">
        {proposals.map((proposal, index) => {
          const letter = proposal.coverLetter?.trim() ?? "";
          const truncated = letter.length > coverLetterExcerptLength;
          const excerpt = truncated ? `${letter.slice(0, coverLetterExcerptLength).trimEnd()}…` : letter;

          return <li key={`comparison-print-${index}`}>
            <article className="marketplace-comparison-print-card">
              <header><h2>Proposal {index + 1}</h2></header>
              <dl>
                <div><dt>Quoted amount</dt><dd>{proposal.amount}</dd></div>
                <div><dt>Delivery timeline</dt><dd>{proposal.timeline}</dd></div>
                <div><dt>Proposal status</dt><dd>{proposal.status}</dd></div>
                <div className="marketplace-comparison-print-wide">
                  <dt>Cover-letter summary</dt>
                  <dd>
                    <p>{excerpt || "No cover letter provided."}</p>
                    {truncated && <small>Excerpt only. Open the proposal in ProofPay AI to read the full cover letter.</small>}
                  </dd>
                </div>
                <div className="marketplace-comparison-print-wide">
                  <dt>Portfolio references</dt><dd>{proposal.portfolioReferences}</dd>
                </div>
              </dl>
            </article>
          </li>;
        })}
      </ol>
      <footer>Prepared from the proposals selected for comparison on this job.</footer>
    </main>,
    document.body,
  );
}
