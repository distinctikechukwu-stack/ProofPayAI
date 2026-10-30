import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

describe("API foundation", () => {
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("exposes a health endpoint without requiring provider credentials", async () => {
    app = await buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("reports provider configuration as booleans only", async () => {
    app = await buildApp({ logger: false });
    const response = await app.inject({ method: "GET", url: "/api/status" });
    const status = response.json();

    expect(response.statusCode).toBe(200);
    expect(status).toMatchObject({
      status: "ok",
      integrations: {
        supabase: expect.any(Boolean),
        ai: expect.any(Boolean),
        paypal: expect.any(Boolean),
      },
    });
    expect(JSON.stringify(status)).not.toContain("CLIENT_SECRET");
  });

  it("allows the configured browser origin without reflecting an untrusted origin", async () => {
    app = await buildApp({ logger: false, allowedOrigin: "https://app.proofpay.example" });

    const allowed = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { origin: "https://app.proofpay.example" },
    });
    const untrusted = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { origin: "https://attacker.example" },
    });

    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.proofpay.example");
    expect(untrusted.headers["access-control-allow-origin"]).toBe("https://app.proofpay.example");
    expect(untrusted.headers["access-control-allow-origin"]).not.toBe("https://attacker.example");
  });
});
