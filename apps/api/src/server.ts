import { buildApp } from "./app.js";

const app = await buildApp();
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error, "API startup failed");
  process.exitCode = 1;
}
