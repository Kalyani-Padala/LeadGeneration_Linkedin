const APOLLO_BASE = 'https://api.apollo.io';

async function apolloRequest(endpoint, method = 'GET', body = null, apiKey, signal) {
  if (!apiKey) throw new Error('Apollo API key is missing');

  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': apiKey,
    },
    signal,
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(`${APOLLO_BASE}${endpoint}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apollo ${endpoint} failed [${res.status}]: ${text}`);
  }
  return res.json();
}

export async function searchCompanies(keywords, apolloKey, options = {}) {
  const keywordArray = Array.isArray(keywords) ? keywords : [keywords];

  const body = {
    q_organization_keyword_tags: keywordArray,
    page: options.page || 1,
    per_page: options.perPage || 10,
  };

  // Only add if provided
  if (options.locations?.length) {
    body.organization_locations = options.locations;
  }
  if (options.employeeRanges?.length) {
    body.organization_num_employees_ranges = options.employeeRanges;
  }

  return apolloRequest('/api/v1/organizations/search', 'POST', body, apolloKey);
}

export async function enrichCompany(domain, apolloKey) {
  return apolloRequest(`/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`, 'GET', null, apolloKey);
}

// Detect Apollo's locked-email sentinel ("email_not_unlocked@domain.com")
// Returned on free / out-of-credit accounts.
function isLockedEmail(email) {
  return !!email && /email_not_unlocked@/i.test(email);
}

function splitName(full) {
  if (!full) return { firstName: '', lastName: '' };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// Enrich a person via Apollo `/people/match`.
// Prefers LinkedIn URL (highest match accuracy), falls back to name + company.
// On free / no-credit accounts, `email` may be locked — caller can read
// `emailLocked` to surface this in the UI.
export async function matchPerson({ linkedinUrl, name, firstName, lastName, organizationName, domain }, apolloKey, signal) {
  if (!firstName && !lastName && name) {
    ({ firstName, lastName } = splitName(name));
  }

  const body = {
    reveal_personal_emails: true,
    reveal_phone_number: true,
  };
  if (linkedinUrl) body.linkedin_url = linkedinUrl;
  if (firstName) body.first_name = firstName;
  if (lastName) body.last_name = lastName;
  if (organizationName) body.organization_name = organizationName;
  if (domain) body.domain = domain;

  // Need at least one strong identifier
  if (!linkedinUrl && !((firstName || lastName) && (organizationName || domain))) {
    return null;
  }

  const data = await apolloRequest('/api/v1/people/match', 'POST', body, apolloKey, signal);
  const person = data?.person;
  if (!person) return null;

  const rawEmail = person.email || '';
  const emailLocked = isLockedEmail(rawEmail);
  const personalEmail = (person.personal_emails || []).find(e => !isLockedEmail(e)) || '';
  const workEmail = !emailLocked ? rawEmail : '';

  const phone = person.phone_numbers?.[0]?.sanitized_number
    || person.phone_numbers?.[0]?.raw_number
    || person.organization?.phone
    || '';

  return {
    apolloPersonId: person.id || '',
    email: workEmail || personalEmail || '',
    emailType: workEmail ? 'work' : (personalEmail ? 'personal' : ''),
    emailStatus: person.email_status || '',
    emailLocked,
    personalEmails: (person.personal_emails || []).filter(e => !isLockedEmail(e)),
    phone,
    title: person.title || '',
    seniority: person.seniority || '',
    departments: person.departments || [],
    city: person.city || '',
    state: person.state || '',
    country: person.country || '',
    linkedinUrl: person.linkedin_url || '',
  };
}