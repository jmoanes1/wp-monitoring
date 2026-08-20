const SENSITIVE_KEY = /password|passwd|pwd|authorization|cookie|ciphertext|credential|secret|token|iv$|tag$/i;

export function redact(value) {
  if (value == null) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(nested);
    }
    return out;
  }
  return value;
}
