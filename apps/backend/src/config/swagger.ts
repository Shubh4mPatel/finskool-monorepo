import swaggerJSDoc from 'swagger-jsdoc'

// Scoped to the mobile self-serve auth flow only (see src/modules/mobile-auth) —
// the rest of the API predates this doc setup and isn't annotated yet.
// Extending coverage to other modules just means adding `@openapi` JSDoc
// blocks to their .routes.ts files; swagger-jsdoc picks them up automatically
// via the `apis` glob below.
const definition: swaggerJSDoc.OAS3Definition = {
  openapi: '3.0.0',
  info: {
    title: 'Finskool API — Mobile Auth',
    version: '1.0.0',
    description:
      'Self-serve mobile registration flow: create an account, verify it via a one-time ' +
      'email code (a stand-in for WhatsApp OTP delivery until that integration exists), ' +
      'then log in through the existing POST /api/v1/auth/login endpoint.',
  },
  servers: [{ url: '/api/v1', description: 'This server' }],
  tags: [{ name: 'Mobile Auth', description: 'Self-serve registration + OTP verification' }],
  components: {
    schemas: {
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
          code: { type: 'string', nullable: true },
        },
      },
      ValidationErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'Validation failed' },
          errors: {
            type: 'object',
            additionalProperties: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
}

export const swaggerSpec = swaggerJSDoc({
  definition,
  apis: [
    new URL('../modules/mobile-auth/*.routes.ts', import.meta.url).pathname,
    new URL('../modules/mobile-auth/*.routes.js', import.meta.url).pathname,
  ],
})

export const swaggerDocsPath = '/api/docs'
