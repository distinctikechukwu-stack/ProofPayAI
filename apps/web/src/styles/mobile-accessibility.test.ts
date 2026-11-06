import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stylesheet = readFileSync("src/styles/mobile-accessibility.css", "utf8");

describe("mobile accessibility stylesheet contract", () => {
  it("keeps navigation and primary controls within the small-screen rules", () => {
    expect(stylesheet).toMatch(/@media \(max-width: 620px\)/);
    expect(stylesheet).toMatch(/\.mobile-nav-link \{[\s\S]*?min-height: 44px/);
    expect(stylesheet).toMatch(/\.topbar-actions \.role-toggle \{[\s\S]*?min-height: 44px/);
    expect(stylesheet).toMatch(/\.workspace-content \.(?:button-primary|button-secondary) \{[\s\S]*?min-height: 44px/);
  });

  it("keeps form controls finger-friendly and readable on small screens", () => {
    expect(stylesheet).toMatch(/\.workspace-content input,[\s\S]*?min-height: 44px;[\s\S]*?font-size: 16px/);
  });
});
