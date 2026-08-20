const WEBSITE_TYPES = new Set(['lead', 'non-lead']);

export function isNonEmptyString(value, max = 200) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max;
}

export function validateWebsiteInput(payload, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || payload.name !== undefined) {
    if (!isNonEmptyString(payload.name, 120)) errors.push('Name is required (max 120 characters)');
    else data.name = payload.name.trim();
  }

  if (!partial || payload.url !== undefined) {
    if (!isNonEmptyString(payload.url, 500)) {
      errors.push('URL is required');
    } else {
      try {
        const parsed = new URL(payload.url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          errors.push('URL must start with http:// or https://');
        } else {
          data.url = parsed.toString();
        }
      } catch {
        errors.push('URL is invalid');
      }
    }
  }

  if (!partial || payload.type !== undefined) {
    if (!WEBSITE_TYPES.has(payload.type)) errors.push('Type must be lead or non-lead');
    else data.type = payload.type;
  }

  if (payload.monitoringEnabled !== undefined) {
    data.monitoringEnabled = Boolean(payload.monitoringEnabled);
  }

  if (payload.notes !== undefined) {
    data.notes = String(payload.notes || '').slice(0, 2000);
  }

  if (payload.formTestingMonthlyEnabled !== undefined) {
    data.formTestingMonthlyEnabled = Boolean(payload.formTestingMonthlyEnabled);
  }

  return { errors, data };
}

export function validateCredentials(payload) {
  const errors = [];
  if (!isNonEmptyString(payload.username, 80)) errors.push('Username is required');
  if (!isNonEmptyString(payload.password, 200)) errors.push('Password is required');
  return errors;
}
