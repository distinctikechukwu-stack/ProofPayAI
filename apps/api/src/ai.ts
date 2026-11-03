import type { ScopeAnalysis } from "@proofpay/shared";

export interface StructuredAiRequest {
  name: string;
  instructions: string;
  payload: unknown;
  schema: Record<string, unknown>;
}

export type StructuredAiGenerator = (request: StructuredAiRequest) => Promise<unknown>;
export type AiProvider = "groq" | "openai";

export const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";

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
  return isConfiguredValue(key) && isConfiguredValue(model);
}

/**
 * An explicit AI_PROVIDER always wins. For older deployments that only have
 * OpenAI configured, preserve the previous behavior; otherwise Groq is the
 * preferred default.
 */
export function getAiProvider(): AiProvider | null {
  const configuredProvider = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (configuredProvider) {
    return configuredProvider === "groq" || configuredProvider === "openai" ? configuredProvider : null;
  }
  if (isConfiguredValue(process.env.GROQ_API_KEY?.trim())) return "groq";
  if (isOpenAiConfigured()) return "openai";
  return "groq";
}

export function getAiModel(): string | null {
  const provider = getAiProvider();
  if (provider === "groq") {
    const model = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
    return isConfiguredValue(model) ? model : null;
  }
  if (provider === "openai") {
    const model = process.env.OPENAI_MODEL?.trim();
    return isConfiguredValue(model) ? model : null;
  }
  return null;
}

export function isAiConfigured(): boolean {
  const provider = getAiProvider();
  const model = getAiModel();
  if (!provider || !model) return false;
  const key = provider === "groq" ? process.env.GROQ_API_KEY?.trim() : process.env.OPENAI_API_KEY?.trim();
  return isConfiguredValue(key);
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

export const generateGroqStructured: StructuredAiGenerator = async (request) => {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const model = process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
  if (!isConfiguredValue(apiKey) || !isConfiguredValue(model)) throw new AiConfigurationError();
  if (!isGroqStrictSchemaCompatible(request.schema)) {
    throw new AiProviderError("The AI output schema is incompatible with the selected provider.", 500);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: request.instructions },
          { role: "user", content: JSON.stringify(request.payload) },
        ],
        max_completion_tokens: 3_000,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: request.name,
            strict: true,
            schema: toGroqStructuredSchema(request.schema),
          },
        },
      }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new AiProviderError("AI provider rate limit reached. Try again shortly.", 503);
      }
      if (response.status === 498 || response.status >= 500) {
        throw new AiProviderError("AI provider is temporarily unavailable. Try again shortly.", 503);
      }
      throw new AiProviderError("AI provider could not complete the request.", 502);
    }
    const body: unknown = await response.json();
    if (!isRecord(body) || !Array.isArray(body.choices) || !isRecord(body.choices[0])) {
      throw new AiProviderError("AI response was incomplete. Please try again.");
    }
    const choice = body.choices[0];
    if (!isRecord(choice.message)) throw new AiProviderError("AI response did not contain the expected structured result.");
    if (typeof choice.message.refusal === "string" && choice.message.refusal.length > 0) {
      throw new AiProviderError("AI could not complete this analysis.", 422);
    }
    if (choice.finish_reason !== "stop") throw new AiProviderError("AI response was incomplete. Please try again.");
    if (typeof choice.message.content !== "string") {
      throw new AiProviderError("AI response did not contain the expected structured result.");
    }
    try {
      return JSON.parse(choice.message.content) as unknown;
    } catch {
      throw new AiProviderError("AI returned an invalid structured response.");
    }
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new AiProviderError("AI request timed out. Try again.", 504);
    throw new AiProviderError();
  } finally {
    clearTimeout(timeout);
  }
};

export const generateConfiguredStructuredAi: StructuredAiGenerator = async (request) => {
  if (!isAiConfigured()) throw new AiConfigurationError();
  return getAiProvider() === "openai"
    ? generateOpenAiStructured(request)
    : generateGroqStructured(request);
};

/**
 * Groq's strict-output docs explicitly show type, properties, required,
 * additionalProperties, items, enum, anyOf, and numeric minimum/maximum.
 * Array length keywords are not listed in its supported subset, so remove
 * only those provider-side hints. The full shared Zod schemas remain enforced
 * after generation in the API routes.
 */
export function toGroqStructuredSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const normalize = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(normalize);
    if (!isRecord(value)) return value;
    const normalized = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child)]));
    delete normalized.minItems;
    delete normalized.maxItems;
    return normalized;
  };
  return normalize(schema) as Record<string, unknown>;
}

export function isGroqStrictSchemaCompatible(schema: Record<string, unknown>): boolean {
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.every(visit);
    if (!isRecord(value)) return true;
    if (value.type === "object") {
      if (value.additionalProperties !== false) return false;
      const properties = isRecord(value.properties) ? value.properties : {};
      const required = Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === "string") : [];
      if (Object.keys(properties).length !== required.length || !Object.keys(properties).every((key) => required.includes(key))) return false;
      if (!visit(Object.values(properties))) return false;
    }
    if (value.items !== undefined && !visit(value.items)) return false;
    if (value.anyOf !== undefined && !visit(value.anyOf)) return false;
    return true;
  };
  return visit(schema);
}

function isConfiguredValue(value: string | undefined): value is string {
  return Boolean(value && !value.toLowerCase().startsWith("your-"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

