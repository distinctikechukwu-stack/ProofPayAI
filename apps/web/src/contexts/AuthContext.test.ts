import { describe, expect, it } from "vitest";
import { safeAuthError } from "./AuthContext";

describe("authentication error redaction", () => {
  it("replaces provider details with a stable user-facing message", () => {
    expect(safeAuthError(new Error("provider-internal-detail"))).toBe("We could not complete that account request. Check the details and try again shortly.");
    expect(safeAuthError({ message: "token-like-provider-detail" })).toBe("We could not complete that account request. Check the details and try again shortly.");
  });

  it("returns no error for a successful provider result", () => {
    expect(safeAuthError(null)).toBeNull();
  });
});
