# ProofPay AI web application

React, TypeScript, Vite, and Tailwind frontend. From the repository root, start the workspace with `npm.cmd run dev:web`. Vite loads root `.env` through `envDir`; only `VITE_*` variables are exposed to browser code.

Signed-out routes use clearly labeled illustrative data. With Supabase configured, Auth uses the public anon key and API calls use the signed-in user's bearer token. PayPal and AI secrets must never be added to this app's environment or source.

Run `npm.cmd run typecheck --workspace @proofpay/web`, `npm.cmd run test --workspace @proofpay/web`, or `npm.cmd run build --workspace @proofpay/web`. The current signed-out invoice page is a preview; it does not fabricate invoice or payment records.
