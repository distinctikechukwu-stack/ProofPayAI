export function sanitizeCiDiagnostic(value) {
  return String(value)
    .replace(/\beyJ[a-zA-Z0-9._-]{20,}\b/g, '[redacted]')
    .replace(/\b(?:sb_secret_|sb_publishable_|gh[pousr]_)[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/\b(postgres(?:ql)?:\/\/[^:/@\s]+:)[^@\s/]+(@)/gi, '$1[redacted]$2')
    .replace(/\b([A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|service[_-]?role[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)\s*([=:])\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1$2[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]');
}
