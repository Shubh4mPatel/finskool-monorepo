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
  await transporter.sendMail({
    from: env.smtp.from,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  })
}

export default transporter
