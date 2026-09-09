import nodemailer from 'nodemailer'
import { env } from '../config/env.js'
import { logger } from '../shared/logger.js'

const transporter = nodemailer.createTransport({
  host: env.smtp.host,
  port: env.smtp.port,
  secure: env.smtp.secure,
  auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
})

transporter.verify().then(
  () => logger.info('smtp connected'),
  (err: unknown) => logger.error({ err }, 'smtp connection failed'),
)

export interface SendMailOptions {
  to: string
  subject: string
  html: string
}

export async function sendMail(opts: SendMailOptions): Promise<void> {
  logger.info({ to: opts.to, subject: opts.subject }, 'mailer.sendMail: sending')
  try {
    const info = await transporter.sendMail({
      from: env.smtp.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    })
    // `response` is the raw final line the SMTP server sent back (e.g. Mailgun's
    // "250 Message queued" + queue id) — the one place we can see the send was
    // actually accepted downstream, not just that nodemailer didn't throw.
    logger.info(
      { to: opts.to, subject: opts.subject, messageId: info.messageId, response: info.response },
      'mailer.sendMail: sent',
    )
  } catch (err) {
    logger.error({ err, to: opts.to, subject: opts.subject }, 'mailer.sendMail: failed')
    throw err
  }
}

export default transporter
