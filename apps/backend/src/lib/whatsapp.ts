import { env } from '../config/env.js'

/**
 * Sends the registration OTP via WhatsApp (template message, auth category).
 * `toE164` is expected in the +<countrycode><number> form lib/phone.ts always
 * produces — the API wants it without the leading '+'.
 *
 * No response shape was documented by the provider — a 2xx is treated as
 * success and nothing is parsed from the body; any other status throws with
 * the response text attached, for the worker's retry/log path to surface.
 */
export async function sendWhatsappOtp(toE164: string, otp: string): Promise<void> {
  const { baseUrl, apiKey, phoneNoId, templateName } = env.whatsapp
  if (!baseUrl || !apiKey || !phoneNoId) {
    throw new Error('WhatsApp is not configured — set WHATSAPP_API_BASE_URL/WHATSAPP_API_KEY/WHATSAPP_PHONE_NO_ID')
  }

  const to = toE164.replace(/^\+/, '')
  const res = await fetch(`${baseUrl}/api/v2/whatsapp-business/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to,
      phoneNoId,
      type: 'template',
      name: templateName,
      language: 'en_US',
      bodyParams: [otp],
      // "Copy code" one-tap button — same OTP as bodyParams[0], per the auth template contract.
      buttons: [{ type: 'button', sub_type: 'url', text: otp }],
    }),
  })
  if (!res.ok) {
    throw new Error(`WhatsApp OTP send failed: ${res.status} ${await res.text()}`)
  }
}
