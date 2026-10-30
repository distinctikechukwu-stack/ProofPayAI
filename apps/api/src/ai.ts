import type { ScopeAnalysis } from "@proofpay/shared";

export interface StructuredAiRequest {
  name: string;
  instructions: string;
  payload: unknown;
  schema: Record<string, unknown>;
}

export type StructuredAiGenerator = (request: StructuredAiRequest) => Promise<unknown>;

export class AiConfigurationError extends Error {
  constructor() {
    super("AI provider is not configured.");
    this.name = "AiConfigurationError";
  }
}

export class AiProviderError extends Error {
  constructor(message = "AI provider could not complete the request.", readonly statusCode = 502) {
    super(message);
    this.name = "AiProviderError";
  }
}

export class AiEvidenceError extends AiProviderError {
  constructor() {
    super("AI returned a citation that does not match the accepted project record. The result was not saved.");
    this.name = "AiEvidenceError";
  }
}

export interface ScopeEvidence {
  scopeText: string;
  requirements: string[];
  milestones: Array<{ sequence: number; sourceText: string }>;
  acceptedChangeOrders: Array<{ id: string; sourceText: string }>;
}

export function verifyScopeEvidence(result: ScopeAnalysis, evidence: ScopeEvidence): void {
  const milestones = new Map(evidence.milestones.map((milestone) => [milestone.sequence, milestone.sourceText]));
  const changes = new Map(evidence.acceptedChangeOrders.map((changeOrder) => [changeOrder.id, changeOrder.sourceText]));
  if (result.affectedMilestoneSequences.some((sequence) => !milestones.has(sequence))) throw new AiEvidenceError();
  for (const citation of result.citations) {
    if (citation.source === "agreement_scope") {
      if (citation.milestoneSequence !== null || citation.changeOrderVersionId !== null || !evidence.scopeText.includes(citation.exactExcerpt)) throw new AiEvidenceError();
    } else if (citation.source === "requirements") {
      if (citation.milestoneSequence !== null || citation.changeOrderVersionId !== null || !evidence.requirements.some((requirement) => requirement.includes(citation.exactExcerpt))) throw new AiEvidenceError();
    } else if (citation.source === "milestone") {
      if (citation.changeOrderVersionId !== null) throw new AiEvidenceError();
      const sourceText = citation.milestoneSequence === null ? undefined : milestones.get(citation.milestoneSequence);
      if (!sourceText || !sourceText.includes(citation.exactExcerpt)) throw new AiEvidenceError();
    } else {
      if (citation.milestoneSequence !== null || citation.changeOrderVersionId === null) throw new AiEvidenceError();
      const sourceText = changes.get(citation.changeOrderVersionId);
      if (!sourceText || !sourceText.includes(citation.exactExcerpt)) throw new AiEvidenceError();
    }
  }
}

export function isOpenAiConfigured(): boolean {
  const key = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  return Boolean(key && model && !key.startsWith("your-") && !model.startsWith("your-"));
}

export const generateOpenAiStructured: StructuredAiGenerator = async (request) => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const model = process.env.OPENAI_MODEL?.trim();
  if (!apiKey || !model || apiKey.startsWith("your-") || model.startsWith("your-")) throw new AiConfigurationError();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        max_output_tokens: 3_000,
        input: [
          { role: "system", content: request.instructions },
          { role: "user", content: JSON.stringify(request.payload) },
        ],
        text: { format: { type: "json_schema", name: request.name, strict: true, schema: request.schema } },
      }),
    });
    if (!response.ok) {
      throw new AiProviderError(
        response.status === 429 ? "AI provider rate limit reached. Try again shortly." : "AI provider could not complete the request.",
        response.status === 429 ? 503 : 502,
      );
    }
    const body: unknown = await response.json();
    if (!isRecord(body) || body.status !== "completed" || !Array.isArray(body.output)) {
      throw new AiProviderError("AI response was incomplete. Please try again.");
    }
    for (const item of body.output) {
      if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content)) continue;
      for (const content of item.content) {
        if (isRecord(content) && content.type === "refusal") throw new AiProviderError("AI could not complete this analysis.", 422);
        if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
          try {
            return JSON.parse(content.text) as unknown;
          } catch {
            throw new AiProviderError("AI returned an invalid structured response.");
          }
        }
      }
    }
    throw new AiProviderError("AI response did not contain the expected structured result.");
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new AiProviderError("AI request timed out. Try again.", 504);
    throw new AiProviderError();
  } finally {
    clearTimeout(timeout);
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

