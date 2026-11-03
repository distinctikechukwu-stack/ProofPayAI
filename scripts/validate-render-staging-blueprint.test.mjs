import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const blueprint = await readFile(new URL("../render.yaml", import.meta.url), "utf8");
const packageManifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const nodeVersion = (await readFile(new URL("../.node-version", import.meta.url), "utf8")).trim();

function serviceSection(name, nextName) {
  const start = blueprint.indexOf(`name: ${name}`);
  assert.notEqual(start, -1, `${name} must be defined`);
  const end = nextName ? blueprint.indexOf(`name: ${nextName}`, start + 1) : blueprint.length;
  return blueprint.slice(start, end === -1 ? undefined : end);
}

test("Blueprint scopes both uniquely named services to ProofPay AI / Staging", () => {
  assert.match(blueprint, /projects:\s*\n\s+- name: ProofPay AI\s*\n\s+environments:\s*\n\s+- name: Staging/);
  assert.match(blueprint, /generation: ['\"]?off['\"]?/);
  assert.match(blueprint, /name: proofpay-staging-api/);
  assert.match(blueprint, /name: proofpay-staging-web/);
  assert.deepEqual(
    [...blueprint.matchAll(/^[ \t]*(?:-[ \t]+)?name:[ \t]*(.+)$/gm)].map((match) => match[1]),
    ["ProofPay AI", "Staging", "proofpay-staging-api", "proofpay-staging-web"],
    "the Blueprint must define only the approved project, environment, and two services",
  );
  assert.doesNotMatch(blueprint, /Shipment-Tracker/);
  assert.doesNotMatch(blueprint, /^[ \t]*-[ \t]+name:[ \t]*Production[ \t]*$/m);
  assert.match(blueprint, /branch: codex\/proofpay-staging-release/);
  assert.equal((blueprint.match(/autoDeployTrigger: ['\"]?off['\"]?/g) ?? []).length, 2);
});

test("API and durable webhook worker share the paid web service startup", async () => {
  const api = serviceSection("proofpay-staging-api", "proofpay-staging-web");
  const server = await readFile(new URL("../apps/api/src/server.ts", import.meta.url), "utf8");

  assert.match(api, /type: web/);
  assert.match(api, /plan: 0\.5c-512mb/);
  assert.match(api, /startCommand: npm run start --workspace @proofpay\/api/);
  assert.match(api, /healthCheckPath: \/health/);
  assert.match(api, /APP_ORIGIN/);
  assert.match(server, /createPaypalWebhookWorkerFromEnvironment/);
  assert.match(server, /webhookWorker\?\.start\(\)/);
  assert.match(server, /if \(webhookWorker\)/);
  assert.match(server, /await app\.listen/);
  assert.match(server, /webhook queue worker is not configured/);
  assert.doesNotMatch(api, /preDeployCommand|db push|migration.*apply/i);
});

test("only backend variables hold AI, privileged Supabase, and PayPal Sandbox configuration", () => {
  const api = serviceSection("proofpay-staging-api", "proofpay-staging-web");
  const web = serviceSection("proofpay-staging-web");

  for (const key of [
    "AI_PROVIDER",
    "GROQ_API_KEY",
    "GROQ_MODEL",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "PAYPAL_SANDBOX_CLIENT_ID",
    "PAYPAL_SANDBOX_CLIENT_SECRET",
  ]) assert.ok(api.includes(`key: ${key}`), `${key} must be declared on the API`);

  assert.doesNotMatch(blueprint, /key:\s*PAYPAL_WEBHOOK_ID/);
  assert.doesNotMatch(blueprint, /PAYPAL_WEBHOOK_ID\s*\n\s*value:\s*[^\s]+/);
  assert.match(api, /key: AI_PROVIDER\s*\n\s+value: groq/);
  assert.match(api, /key: GROQ_MODEL\s*\n\s+value: openai\/gpt-oss-20b/);
  assert.doesNotMatch(api, /key: VITE_/);
  assert.match(web, /key: VITE_API_URL/);
  assert.match(web, /key: VITE_SUPABASE_URL/);
  assert.match(web, /key: VITE_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(web, /SUPABASE_SERVICE_ROLE_KEY|GROQ_API_KEY|OPENAI_API_KEY|PAYPAL_/);
  assert.equal((blueprint.match(/sync: false/g) ?? []).length, 12);
});

test("Node version is consistent and release npm test excludes local operator tools", () => {
  assert.equal(nodeVersion, "26.13.0");
  assert.equal((blueprint.match(/value: 26\.13\.0/g) ?? []).length, 2);
  assert.equal(packageManifest.scripts.test, "npm run test:release");
  assert.ok(packageManifest.scripts["test:release"].includes("validate-render-staging-blueprint.test.mjs"));
  assert.doesNotMatch(packageManifest.scripts["test:release"], /credential-bridge|credential-store|single-reset|draft-approval-gate|controlled-draft-workflow|paypal-preflight-report\.test|invoice-preflight-runner\.test|validate-paypal-invoice-preflight\.test/i);
  assert.doesNotMatch(JSON.stringify(packageManifest.scripts), /build:windows-credential-bridge/);
});
