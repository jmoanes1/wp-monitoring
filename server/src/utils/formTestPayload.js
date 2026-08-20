import { config } from '../config/index.js';

export const TEST_EMAIL = (config.formTestEmail || 'john@medisure.com').trim().toLowerCase();
export const TEST_REPORT_TO = (config.formTestReportEmail || 'john@medishure.com').trim().toLowerCase();
export const TEST_RECIPIENT = TEST_EMAIL;

export const TEST_VALUES = {
  email: TEST_EMAIL,
  name: 'John Jay Moanes',
  firstName: 'John Jay',
  lastName: 'Moanes',
  age: '32',
  gender: 'Male',
  phone: '09923811486',
  country: 'Philippines',
  nationality: 'Filipino',
  message: 'This is test only, please disregard.',
  subject: 'Website form test — please disregard',
  company: 'Form monitoring test',
  requiredFallback: 'TEST — please disregard'
};

export const TEST_DATA_SUMMARY = [
  { label: 'Name', value: TEST_VALUES.name },
  { label: 'Age', value: TEST_VALUES.age },
  { label: 'Gender', value: TEST_VALUES.gender },
  { label: 'Phone', value: TEST_VALUES.phone },
  { label: 'Country', value: TEST_VALUES.country },
  { label: 'Nationality', value: TEST_VALUES.nationality },
  { label: 'Message', value: TEST_VALUES.message }
];

export function emptyFormTesting() {
  return {
    monthlyEnabled: false,
    lastTestAt: null,
    nextTestAt: null,
    lastResult: null,
    lastTestId: null
  };
}

export function defaultPlaywrightTest(form = {}) {
  return {
    enabled: false,
    formUrl: form.url || '',
    selector: '',
    mode: 'dry',
    schedule: 'manual',
    nextRunAt: null,
    lastRunAt: null,
    lastResult: null,
    lastMode: null
  };
}
