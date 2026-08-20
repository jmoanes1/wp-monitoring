const TOKEN_NAME = /^(_wpcf7|_wpnonce|_wp_http|nonce|gform_|wpforms\[id\]|wpforms\[nonce\]|wpforms\[token\]|form_id|form_build_id|form_token)/i;
const HONEYPOT = /^(website|url|fax|honeypot|hp|bot|company.?url|address2|confirm.?email)$/i;

export function classifyField(name, type, label, extra = '') {
  const hay = `${name} ${label} ${type} ${extra}`.toLowerCase();
  if (type === 'hidden' || TOKEN_NAME.test(name || '')) return 'hidden';
  if (HONEYPOT.test(name || '') || /honeypot/.test(hay)) return 'honeypot';
  if (type === 'password') return 'skip';
  if (type === 'email' || /e-?mail/.test(hay)) return 'email';
  if (/\bage\b|years?\s*old/.test(hay)) return 'age';
  if (/\bgender\b|\bsex\b/.test(hay)) return 'gender';
  if (/nationalit|citizenship|citizen/.test(hay)) return 'nationality';
  if (/country of residence|residence country|country of origin|\bcountry\b/.test(hay)) return 'country';
  if (/first.?name|fname|given.?name/.test(hay)) return 'firstName';
  if (/last.?name|lname|surname|family.?name/.test(hay)) return 'lastName';
  if (/phone|tel|mobile|contact.?number/.test(hay) || type === 'tel') return 'phone';
  if (/subject/.test(hay)) return 'subject';
  if (/company|organization|organisation/.test(hay)) return 'company';
  if (/message|remark|comment|enquiry|inquiry|additional.?info|notes?\b/.test(hay) || type === 'textarea') {
    return 'message';
  }
  if (/full.?name|your name|(^|[-_[])name($|[-_\]])/.test(hay)) return 'name';
  if (type === 'checkbox' || type === 'acceptance') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'select') return 'select';
  if (type === 'number') return 'number';
  if (type === 'date') return 'date';
  return 'text';
}

export function needlesFor(role) {
  if (role === 'country') return ['philippines', 'republic of the philippines', 'phl', 'ph', '63'];
  if (role === 'nationality') return ['filipino', 'philippine', 'philippines'];
  if (role === 'gender') return ['male', 'man'];
  return [];
}

export function matchOption(options, needles) {
  const cleaned = (options || [])
    .map((item) => ({
      value: item.value,
      label: item.label || item.value,
      n: `${item.value || ''} ${item.label || ''}`.trim().toLowerCase()
    }))
    .filter((item) => item.n && !/^(select|choose|please|--)/i.test(item.n));

  for (const needle of needles) {
    if (needle.length < 3 && needle !== 'ph') continue;
    const exact = cleaned.find((item) => item.n === needle || item.value?.toLowerCase() === needle);
    if (exact) return exact;
  }
  for (const needle of needles) {
    if (needle.length < 3) continue;
    const partial = cleaned.find((item) => item.n.includes(needle));
    if (partial) return partial;
  }
  return null;
}
