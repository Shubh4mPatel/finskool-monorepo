import pino from 'pino'
import { env } from '../config/env.js'

export const logger = pino(
  env.nodeEnv === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
      }
    : { level: 'info' },
)
