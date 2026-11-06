import { buildApp } from "./app.js";
import { createPaypalWebhookWorkerFromEnvironment, type PaypalWebhookWorker } from "./paypal-webhook-worker.js";

let webhookWorker: PaypalWebhookWorker | null = null;
const app = await buildApp({ onPaypalWebhookPending: () => webhookWorker?.wake() });
webhookWorker = createPaypalWebhookWorkerFromEnvironment({
  info: (fields, message) => app.log.info(fields, message),
  warn: (fields, message) => app.log.warn(fields, message),
});
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);

if (webhookWorker) {
  app.addHook("onClose", async () => webhookWorker.stop());
} else {
  app.log.info({ stage: "webhook_worker" }, "PayPal webhook queue worker is not configured; delivery endpoint remains unavailable until server-only Sandbox configuration is complete");
}

try {
  await app.listen({ host: "0.0.0.0", port });
  webhookWorker?.start();
} catch (error) {
  app.log.error(error, "API startup failed");
  process.exitCode = 1;
}
