# Post reactions (mobile)

Five reaction types. Show them in this order, with these icons (the admin web uses the same coloured badges):

| Order | `id` | `name` | Emoji | Badge colour |
|---|---|---|---|---|
| 1 | 1 | `like` | 👍 | blue |
| 2 | 2 | `love` | ❤️ | red |
| 3 | 7 | `insightful` | 💡 | yellow |
| 4 | 3 | `haha` | 😂 | teal |
| 5 | 8 | `celebrate` | 👏 | green |

Do not hard-code the list. Call `GET /api/v1/mobile/reaction-types` (already sorted by `sortOrder`) when the app starts and draw what it returns; use `id` as `reactionTypeId` when reacting. Ids are stable: 1, 2 and 3 are what they have always been, and 7 and 8 are new.

## What changed

- **New:** Insightful (id 7) and Celebrate (id 8).
- **Removed:** Wow (4), Sad (5) and Angry (6). Reactions members had left with those three were deleted, and the counts on the posts were recalculated. Like, Love and Haha reactions were kept.
- An app that still sends 4, 5 or 6 (or any unknown id) to `PUT /mobile/posts/{postId}/reactions` gets `400 Invalid reaction type` and nothing is saved. Show a friendly message and refresh the list from `/mobile/reaction-types`.
- `reactionCounts` on a post only contains the types that have at least one reaction, for example `{ "like": 3, "insightful": 1 }`. A missing key means zero.
- Drawing a type the app does not know (a future one): fall back to the `emoji` from the API.

## How it reaches production

The migration `20261105100000_reaction_types_v2` makes the change when the backend is deployed (the container runs `prisma migrate deploy` on start). Nothing to run by hand. `npm run db:seed:reactions` re-applies the same list if it is ever needed; it is safe to run again.
