import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AiEvidenceError,
  AiProviderError,
  DEFAULT_GROQ_MODEL,
  generateConfiguredStructuredAi,
  generateGroqStructured,
  generateOpenAiStructured,
  getAiModel,
  getAiProvider,
  isGroqStrictSchemaCompatible,
  isAiConfigured,
  toGroqStructuredSchema,
  verifyScopeEvidence,
} from "../src/ai.js";
import type { ScopeAnalysis } from "@proofpay/shared";
import { milestoneGenerationJsonSchema, scopeAnalysisJsonSchema } from "../src/app.js";

const aiEnvironmentKeys = ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL"] as const;

beforeEach(() => {
  for (const key of aiEnvironmentKeys) vi.stubEnv(key, "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const baseAnalysis: ScopeAnalysis = {
  classification: "possibly_covered",
  summary: "The request may overlap with the agreed scope.",
  concerns: [],
  affectedMilestoneSequences: [1],
  citations: [
    { source: "agreement_scope", milestoneSequence: null, changeOrderVersionId: null, exactExcerpt: "five pages" },
    { source: "requirements", milestoneSequence: null, changeOrderVersionId: null, exactExcerpt: "mobile and desktop" },
    { source: "milestone", milestoneSequence: 1, changeOrderVersionId: null, exactExcerpt: "Responsive website" },
  ],
  proposedAmendment: {
    title: "Clarify the requested work",
    description: "Confirm the work before amending the agreement.",
    deliverables: [],
    openQuestions: ["What interaction is needed?"],
    amountDeltaMinor: null,
    scheduleDeltaDays: null,
    estimateExplanation: "No negotiated price or schedule is available.",
  },
  uncertainty: "The agreement does not describe the requested interaction.",
};

const evidence = {
  scopeText: "Build a marketing site with five pages.",
  requirements: ["Responsive on mobile and desktop."],
  milestones: [{ sequence: 1, sourceText: "Build site\nImplement five pages.\nResponsive website\nAll five pages load\nClient approves" }],
  acceptedChangeOrders: [{ id: "0bbd062f-ea39-41ea-863e-0a32a4f910ac", sourceText: "Calendar amendment\nAdd monthly booking calendar\nCalendar" }],
};

describe("AI scope evidence validation", () => {
  it("accepts exact excerpts from the right agreement evidence", () => {
    expect(() => verifyScopeEvidence(baseAnalysis, evidence)).not.toThrow();
  });

  it("rejects invented excerpts and references to missing milestone sequences", () => {
    expect(() => verifyScopeEvidence({
      ...baseAnalysis,
      citations: [{ source: "agreement_scope", milestoneSequence: null, exactExcerpt: "automatic payments" }],
    }, evidence)).toThrow(AiEvidenceError);
    expect(() => verifyScopeEvidence({ ...baseAnalysis, affectedMilestoneSequences: [7] }, evidence)).toThrow(AiEvidenceError);
    expect(() => verifyScopeEvidence({
      ...baseAnalysis,
      citations: [{ source: "accepted_change_order", milestoneSequence: null, changeOrderVersionId: "0bbd062f-ea39-41ea-863e-0a32a4f910ac", exactExcerpt: "monthly booking calendar" }],
    }, evidence)).not.toThrow();
    expect(() => verifyScopeEvidence({
      ...baseAnalysis,
      citations: [{ source: "accepted_change_order", milestoneSequence: null, changeOrderVersionId: "0bbd062f-ea39-41ea-863e-0a32a4f910ac", exactExcerpt: "guaranteed escrow" }],
    }, evidence)).toThrow(AiEvidenceError);
  });
});

describe("OpenAI structured response boundary (mocked provider)", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "test-only-provider-key";
    process.env.OPENAI_MODEL = "test-only-model";
  });

  const request = {
    name: "test_structured_output",
    instructions: "Return a JSON object.",
    payload: { brief: "fictional test data" },
    schema: { type: "object", additionalProperties: false },
  };

  it("maps provider rate limits to a safe retryable error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 429 })));
    await expect(generateOpenAiStructured(request)).rejects.toMatchObject({
      statusCode: 503,
      message: "AI provider rate limit reached. Try again shortly.",
    });
  });

  it("does not expose provider details for credential or provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "private provider diagnostic" }), { status: 401 })));
    await expect(generateOpenAiStructured(request)).rejects.toMatchObject({
      statusCode: 502,
      message: "AI provider could not complete the request.",
    });
  });

  it("rejects invalid structured JSON returned by the provider", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "not-json" }] }],
    }), { status: 200 })));
    await expect(generateOpenAiStructured(request)).rejects.toMatchObject({
      statusCode: 502,
      message: "AI returned an invalid structured response.",
    });
  });

  it("maps an aborted provider request to a timeout response", async () => {
    const timeout = Object.assign(new Error("simulated abort"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    await expect(generateOpenAiStructured(request)).rejects.toBeInstanceOf(AiProviderError);
    await expect(generateOpenAiStructured(request)).rejects.toMatchObject({ statusCode: 504 });
  });

  it("keeps OpenAI Responses and its original strict schema request shape", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: "{\"ok\":true}" }] }],
    }), { status: 200 })));
    await expect(generateConfiguredStructuredAi({ ...request, schema: { type: "array", minItems: 1 } })).resolves.toEqual({ ok: true });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init?.body));
    expect(body.store).toBe(false);
    expect(body.text.format.schema).toEqual({ type: "array", minItems: 1 });
  });
});

describe("AI provider selection", () => {
  it("prefers Groq by default and uses the supported default model", () => {
    expect(getAiProvider()).toBe("groq");
    expect(getAiModel()).toBe(DEFAULT_GROQ_MODEL);
    expect(isAiConfigured()).toBe(false);
  });

  it("preserves legacy OpenAI-only configuration when AI_PROVIDER is unset", () => {
    process.env.OPENAI_API_KEY = "test-only-openai-key";
    process.env.OPENAI_MODEL = "test-only-openai-model";
    expect(getAiProvider()).toBe("openai");
    expect(getAiModel()).toBe("test-only-openai-model");
    expect(isAiConfigured()).toBe(true);
  });

  it("uses the explicit provider when both providers are configured", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.GROQ_API_KEY = "test-only-groq-key";
    process.env.GROQ_MODEL = DEFAULT_GROQ_MODEL;
    process.env.OPENAI_API_KEY = "test-only-openai-key";
    process.env.OPENAI_MODEL = "test-only-openai-model";
    expect(getAiProvider()).toBe("openai");
    expect(isAiConfigured()).toBe(true);

    process.env.AI_PROVIDER = "groq";
    expect(getAiProvider()).toBe("groq");
    expect(getAiModel()).toBe(DEFAULT_GROQ_MODEL);
  });

  it("rejects an unsupported provider name without reporting configuration as ready", () => {
    process.env.AI_PROVIDER = "unsupported";
    process.env.GROQ_API_KEY = "test-only-groq-key";
    expect(getAiProvider()).toBeNull();
    expect(isAiConfigured()).toBe(false);
  });
});

describe("Groq strict schema compatibility", () => {
  it("confirms the existing milestone and scope-analysis schemas meet strict object requirements", () => {
    expect(isGroqStrictSchemaCompatible(milestoneGenerationJsonSchema)).toBe(true);
    expect(isGroqStrictSchemaCompatible(scopeAnalysisJsonSchema)).toBe(true);
  });

  it("rejects object schemas with optional properties or open additional properties", () => {
    expect(isGroqStrictSchemaCompatible({
      type: "object",
      properties: { requiredValue: { type: "string" }, optionalValue: { type: "string" } },
      required: ["requiredValue"],
      additionalProperties: false,
    })).toBe(false);
    expect(isGroqStrictSchemaCompatible({
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
    })).toBe(false);
  });
});

describe("Groq strict structured response boundary (mocked provider)", () => {
  const request = {
    name: "proofpay_test_result",
    instructions: "Use this test-only instruction exactly.",
    payload: { brief: "fictional test data" },
    schema: {
      type: "object",
      properties: {
        items: { type: "array", minItems: 1, maxItems: 3, items: { type: "integer", minimum: 1, maximum: 10 } },
      },
      required: ["items"],
      additionalProperties: false,
    },
  };

  beforeEach(() => {
    process.env.AI_PROVIDER = "groq";
    process.env.GROQ_API_KEY = "test-only-groq-key";
    process.env.GROQ_MODEL = DEFAULT_GROQ_MODEL;
  });

  it("sends strict JSON Schema to Groq and removes only undocumented array-length keywords", async () => {
    const output = { items: [2] };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }],
    }), { status: 200 })));
    await expect(generateConfiguredStructuredAi(request)).resolves.toEqual(output);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-only-groq-key");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(DEFAULT_GROQ_MODEL);
    expect(body.messages).toEqual([
      { role: "system", content: request.instructions },
      { role: "user", content: JSON.stringify(request.payload) },
    ]);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: request.name,
        strict: true,
        schema: {
          type: "object",
          properties: { items: { type: "array", items: { type: "integer", minimum: 1, maximum: 10 } } },
          required: ["items"],
          additionalProperties: false,
        },
      },
    });
  });

  it("keeps the array constraints in the caller schema for downstream validation", () => {
    const compatible = toGroqStructuredSchema(request.schema);
    expect((request.schema.properties as Record<string, unknown>).items).toMatchObject({ minItems: 1, maxItems: 3 });
    expect((compatible.properties as Record<string, unknown>).items).toEqual({
      type: "array",
      items: { type: "integer", minimum: 1, maximum: 10 },
    });
  });

  it("maps free-tier rate limits and temporary capacity/provider failures to safe retryable errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(new Response("{}", { status: 498 }))
      .mockResolvedValueOnce(new Response("{}", { status: 503 })));
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 503, message: "AI provider rate limit reached. Try again shortly." });
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 503, message: "AI provider is temporarily unavailable. Try again shortly." });
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 503, message: "AI provider is temporarily unavailable. Try again shortly." });
  });

  it("rejects malformed, incomplete, and refused responses without exposing provider details", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "not-json" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { refusal: "private refusal text", content: null } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "provider secret diagnostic" }), { status: 401 })));
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 502, message: "AI returned an invalid structured response." });
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 502, message: "AI response was incomplete. Please try again." });
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 422, message: "AI could not complete this analysis." });
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 502, message: "AI provider could not complete the request." });
  });

  it("maps an aborted request to a safe timeout", async () => {
    const timeout = Object.assign(new Error("simulated abort"), { name: "AbortError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));
    await expect(generateGroqStructured(request)).rejects.toBeInstanceOf(AiProviderError);
    await expect(generateGroqStructured(request)).rejects.toMatchObject({ statusCode: 504, message: "AI request timed out. Try again." });
  });
});
