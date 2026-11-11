export const PAYPAL_VALIDATION_GITHUB_REFS = Object.freeze([
  'refs/heads/codex/cloudflare-paypal-webhooks',
  'refs/heads/codex/proofpay-final-integration-prep',
]);

export function isAllowedPaypalValidationRef(value) {
  return typeof value === 'string' && PAYPAL_VALIDATION_GITHUB_REFS.includes(value);
}
