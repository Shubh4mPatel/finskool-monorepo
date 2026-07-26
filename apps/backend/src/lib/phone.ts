import { parsePhoneNumberFromString } from 'libphonenumber-js'

// Numbers without a leading country code are assumed to be Indian (existing data convention)
export function normalizePhone(raw: string): string | null {
  const phone = parsePhoneNumberFromString(raw, 'IN')
  return phone?.isValid() ? phone.number : null
}
