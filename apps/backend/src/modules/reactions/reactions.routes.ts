import { Router } from 'express'
import { ReactionsService } from './reactions.service.js'
import { ReactionsController } from './reactions.controller.js'
import { authenticate } from '../../middlewares/auth.middleware.js'
import prisma from '../../lib/prisma.js'

const service = new ReactionsService(prisma)
const controller = new ReactionsController(service)

const router = Router()

// mounted at /api/v1 — full paths defined here, same pattern as
// commentsRoutes (deliberately overlapping the /posts URL space).

/**
 * @openapi
 * /reaction-types:
 *   get:
 *     tags: [Reactions]
 *     summary: List the available reaction types
 *     description: >
 *       Fixed, seeded set (like, love, haha, wow, sad, angry) — there is no
 *       admin CRUD for these, they never change at runtime. Use `id` as the
 *       `reactionTypeId` sent to `PUT /posts/{postId}/reactions`. Sorted by
 *       `sortOrder`, ascending.
 *     responses:
 *       200:
 *         description: All reaction types.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id: { type: integer, example: 1 }
 *                       name: { type: string, example: like }
 *                       emoji: { type: string, example: "👍" }
 *                       sortOrder: { type: integer, example: 1 }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.get('/reaction-types', authenticate, controller.listTypes)

/**
 * @openapi
 * /posts/{postId}/reactions:
 *   put:
 *     tags: [Reactions]
 *     summary: Set (or change) the caller's reaction on a post
 *     description: >
 *       Upsert, not create — a caller has at most one reaction per post
 *       (enforced by a `(postId, userId)` unique constraint). Calling this
 *       again with a different `reactionTypeId` changes the existing
 *       reaction rather than adding a second one, and can be done any number
 *       of times. The post's author is notified (in-app + live push) unless
 *       the caller is reacting to their own post; re-reacting updates that
 *       same notification in place rather than creating a duplicate.
 *     parameters:
 *       - name: postId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reactionTypeId]
 *             properties:
 *               reactionTypeId:
 *                 type: integer
 *                 description: One of the `id` values from `GET /reaction-types`.
 *                 example: 1
 *     responses:
 *       200:
 *         description: Updated reaction summary for the post.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reactionCounts:
 *                       type: object
 *                       description: Counts keyed by reaction type name; zero-count types are omitted.
 *                       additionalProperties: { type: integer }
 *                       example: { like: 12, love: 3 }
 *                     myReaction:
 *                       type: string
 *                       nullable: true
 *                       description: The caller's own reaction type name.
 *                       example: like
 *       400:
 *         description: "`reactionTypeId` doesn't match any known reaction type."
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: >
 *           Not a member of the post's community (code SUBSCRIPTION_REQUIRED),
 *           or a scoped admin without access to it (code
 *           COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Post not found, not published, or deleted.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       422:
 *         description: Validation failed (missing/non-numeric `reactionTypeId`).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ValidationErrorResponse' } }
 *   delete:
 *     tags: [Reactions]
 *     summary: Remove the caller's reaction from a post
 *     description: >
 *       Clears the caller's reaction, if any — safe to call even when the
 *       caller has no reaction on this post (a no-op), and can be done at
 *       any time. Never removes or affects other users' reactions.
 *     parameters:
 *       - name: postId
 *         in: path
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Updated reaction summary for the post.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 data:
 *                   type: object
 *                   properties:
 *                     reactionCounts:
 *                       type: object
 *                       additionalProperties: { type: integer }
 *                       example: { like: 11 }
 *                     myReaction: { type: string, nullable: true, example: null }
 *       401:
 *         description: Not authenticated.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       403:
 *         description: >
 *           Not a member of the post's community (code SUBSCRIPTION_REQUIRED),
 *           or a scoped admin without access to it (code
 *           COMMUNITY_ACCESS_DENIED).
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 *       404:
 *         description: Post not found, not published, or deleted.
 *         content:
 *           application/json: { schema: { $ref: '#/components/schemas/ErrorResponse' } }
 */
router.put('/posts/:postId/reactions', authenticate, controller.upsert)
router.delete('/posts/:postId/reactions', authenticate, controller.remove)

export default router
