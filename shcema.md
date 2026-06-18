-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for path LIKE queries


-- ============================================================
-- ENUM TYPES
-- ============================================================
CREATE TYPE user_role       AS ENUM ('admin', 'member');
CREATE TYPE community_role  AS ENUM ('moderator', 'member');
CREATE TYPE post_status     AS ENUM ('draft', 'published');


-- ============================================================
-- 1. USERS
-- ============================================================
CREATE TABLE users (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100)    NOT NULL,
    email           VARCHAR(255)    NOT NULL UNIQUE,
    password_hash   VARCHAR(255)    NOT NULL,
    role            user_role       NOT NULL DEFAULT 'member',
    avatar_url      VARCHAR(500),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ     -- soft delete
);

CREATE INDEX idx_users_email       ON users(email)       WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role        ON users(role)         WHERE deleted_at IS NULL;


-- ============================================================
-- 2. COMMUNITIES
-- ============================================================
CREATE TABLE communities (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by      UUID            NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
    name            VARCHAR(150)    NOT NULL,
    slug            VARCHAR(150)    NOT NULL UNIQUE,  -- URL-friendly: /c/tech-news
    description     TEXT,
    cover_image_url VARCHAR(500),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

CREATE INDEX idx_communities_slug       ON communities(slug)       WHERE deleted_at IS NULL;
CREATE INDEX idx_communities_created_by ON communities(created_by) WHERE deleted_at IS NULL;


-- ============================================================
-- 3. COMMUNITY MEMBERS
-- ============================================================
CREATE TABLE community_members (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    community_id    UUID            NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id         UUID            NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
    role            community_role  NOT NULL DEFAULT 'member',
    joined_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_community_member UNIQUE (community_id, user_id)
);

CREATE INDEX idx_members_community  ON community_members(community_id);
CREATE INDEX idx_members_user       ON community_members(user_id);


-- ============================================================
-- 4. POSTS
-- ============================================================
CREATE TABLE posts (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    community_id    UUID            NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    author_id       UUID            NOT NULL REFERENCES users(id)       ON DELETE RESTRICT,

    -- content
    content_md      TEXT            NOT NULL,           -- raw markdown
    image_urls      TEXT[]          NOT NULL DEFAULT '{}',
    tags            VARCHAR(50)[]   NOT NULL DEFAULT '{}',

    -- state
    status          post_status     NOT NULL DEFAULT 'draft',

    -- pin: NULL = unpinned | 1,2,3 = pinned order
    pin_order       SMALLINT        CHECK (pin_order BETWEEN 1 AND 3),
    pinned_at       TIMESTAMPTZ,
    pinned_by       UUID            REFERENCES users(id) ON DELETE SET NULL,

    -- timestamps
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ,

    -- max 3 pinned posts per community enforced at app layer
    -- (partial unique below gives DB-level safety)
    CONSTRAINT uq_community_pin_order UNIQUE (community_id, pin_order)
    -- NOTE: this unique constraint works correctly because
    -- multiple NULLs are not considered equal in PostgreSQL
);

-- fetch feed (most common query)
CREATE INDEX idx_posts_community_feed
    ON posts(community_id, status, published_at DESC)
    WHERE deleted_at IS NULL;

-- pinned posts quick fetch
CREATE INDEX idx_posts_pinned
    ON posts(community_id, pin_order)
    WHERE pin_order IS NOT NULL AND deleted_at IS NULL;

-- author's posts
CREATE INDEX idx_posts_author
    ON posts(author_id)
    WHERE deleted_at IS NULL;

-- tag search using GIN (array contains operator @>)
CREATE INDEX idx_posts_tags
    ON posts USING GIN(tags)
    WHERE deleted_at IS NULL;

-- auto-update updated_at
CREATE OR REPLACE FUNCTION fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ============================================================
-- 5. COMMENTS  (unlimited nesting via materialized path)
-- ============================================================
-- path format:  "<post_id>.<comment_id_1>.<comment_id_2>. ..."
-- depth:        0 = top-level, 1 = reply to comment, etc.
-- Example tree:
--   comment A  → path = "<post_id>.A"       depth = 0
--   comment B  → path = "<post_id>.A.B"     depth = 1  (reply to A)
--   comment C  → path = "<post_id>.A.B.C"   depth = 2  (reply to B)

CREATE TABLE comments (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id         UUID            NOT NULL REFERENCES posts(id)    ON DELETE CASCADE,
    author_id       UUID            NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
    parent_id       UUID            REFERENCES comments(id)          ON DELETE CASCADE,

    content         TEXT            NOT NULL,
    depth           SMALLINT        NOT NULL DEFAULT 0  CHECK (depth >= 0),
    path            TEXT            NOT NULL,           -- materialized path string

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- fetch all comments for a post (most common)
CREATE INDEX idx_comments_post
    ON comments(post_id, created_at)
    WHERE deleted_at IS NULL;

-- fetch entire thread from any ancestor
--   WHERE path LIKE '<ancestor_path>%'
CREATE INDEX idx_comments_path
    ON comments(path text_pattern_ops)
    WHERE deleted_at IS NULL;

-- direct replies to a comment
CREATE INDEX idx_comments_parent
    ON comments(parent_id)
    WHERE deleted_at IS NULL;

CREATE TRIGGER trg_comments_updated_at
    BEFORE UPDATE ON comments
    FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();


-- ============================================================
-- 6. POST LIKES
-- ============================================================
CREATE TABLE post_likes (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id     UUID        NOT NULL REFERENCES posts(id)  ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_post_like UNIQUE (post_id, user_id)
);

-- like count aggregate
CREATE INDEX idx_likes_post ON post_likes(post_id);
-- user's liked posts (for "did I like this?" check)
CREATE INDEX idx_likes_user ON post_likes(user_id);


-- ============================================================
-- USEFUL QUERIES (reference)
-- ============================================================

-- A) Get pinned posts for a community (ordered)
-- SELECT * FROM posts
-- WHERE community_id = $1
--   AND pin_order IS NOT NULL
--   AND deleted_at IS NULL
-- ORDER BY pin_order ASC;

-- B) Get feed posts (published, newest first, skip pinned)
-- SELECT * FROM posts
-- WHERE community_id = $1
--   AND status = 'published'
--   AND pin_order IS NULL
--   AND deleted_at IS NULL
-- ORDER BY published_at DESC
-- LIMIT 20 OFFSET $2;

-- C) Insert top-level comment (depth=0)
-- INSERT INTO comments (post_id, author_id, parent_id, content, depth, path)
-- VALUES ($post_id, $author_id, NULL, $content, 0,
--         $post_id || '.' || <new_uuid>);

-- D) Insert nested reply (depth = parent.depth + 1)
-- INSERT INTO comments (post_id, author_id, parent_id, content, depth, path)
-- VALUES ($post_id, $author_id, $parent_id, $content,
--         $parent_depth + 1,
--         $parent_path  || '.' || <new_uuid>);

-- E) Fetch entire thread under a comment (all descendants)
-- SELECT * FROM comments
-- WHERE path LIKE $ancestor_path || '%'
--   AND deleted_at IS NULL
-- ORDER BY path ASC;

-- F) Like count for a post
-- SELECT COUNT(*) FROM post_likes WHERE post_id = $1;

-- G) Check if user liked a post
-- SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2;

-- H) Soft delete a post
-- UPDATE posts SET deleted_at = NOW() WHERE id = $1;

-- I) Soft delete a comment (children still visible via path)
-- UPDATE comments SET deleted_at = NOW(), content = '[deleted]' WHERE id = $1;co




when to use what check and learn

Confirmed — no migrations folder exists. This matches how the project was already set up (no migrations existed before either).

db push vs migrate dev — what's the difference:

prisma db push	prisma migrate dev
Creates migration files	No	Yes (in prisma/migrations/)
Safe for production	No	Yes
Good for	Dev/prototyping	Staging + production
Since there are no migration files at all in this project (even from before), db push is what you've been using throughout and it's fine for now.

If you want to switch to proper migrations going forward, run:


npx prisma migrate dev --name init
This will create a baseline migration from the current schema. But that's a separate decision — the database is already in sync either way.


how dows frontend now is it exp or not so we can log the user out
The user is asking: how does the frontend (Next.js middleware) know if the access token is expired or not, so it can decide to refresh or log the user out?

Let me trace through the middleware logic I wrote:

In src/middleware.ts:


function decodeJwtPayload(token: string): { exp?: number; role?: string } | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(json)
I'm decoding the JWT by extracting the payload segment and converting it from base64 to JSON, then checking if the expiration timestamp has passed with a 5-second buffer to handle edge cases. The middleware reads the access token from cookies, decodes it to get the exp claim, and compares it against the current time to determine whether to refresh or log out.

The access token includes an exp claim because it's signed with a 15-minute expiration, while the refresh token has no exp claim and relies entirely on Redis for validation. When the access token expires, the frontend calls the refresh endpoint to get a new one, and if that fails, it redirects to login. The browser also automatically clears the access token cookie after 15 minutes based on its maxAge setting.

Good question. Let me show exactly what happens in the middleware step by step.

The access token JWT is signed with expiresIn: '15m' on the backend, which embeds an exp (Unix timestamp) claim inside the token payload. In src/middleware.ts:


access_token cookie value:
eyJhbGciOiJIUzI1NiJ9  .  eyJzdWIiOiJ1c2VyLWlkIiwicm9sZSI6Im1lbWJlciIsImV4cCI6MTc1MDI1MDAwMH0  .  <signature>
      header                                    payload (base64)                                        signature
The middleware decodes only the middle part (no secret needed — it's just base64):


function decodeJwtPayload(token: string): { exp?: number; role?: string } | null {
  const part = token.split('.')[1]           // grab middle segment
  const json = atob(part)                    // base64 decode → JSON string
  return JSON.parse(json)                    // { sub, role, type, exp: 1750250000 }
}

function isExpired(payload: { exp?: number }): boolean {
  if (!payload.exp) return true              // no exp → treat as expired
  return Date.now() / 1000 > payload.exp - 5 // 5-sec buffer for clock skew
}
So the full flow in middleware is:


Request arrives
    │
    ▼
Read access_token cookie
    │
    ├── Cookie missing? (browser deleted it after 15 min maxAge)
    │       │
    │       ▼
    ├── Cookie present but JWT exp < now?
    │
    ▼
Either case → try GET /api/v1/auth/refresh
    │
    ├── Backend finds refresh_token cookie in Redis → issues new access_token cookie → user continues ✓
    │
    └── Backend finds NO entry in Redis (logged out / suspended) → 401 → middleware redirects to /login ✗
Two ways the middleware detects expiry:

Cookie is gone — browser automatically deletes the access_token cookie after 15 min (maxAge: 15 * 60 * 1000) since that's what we set on the backend
Cookie exists but exp is past — the isExpired() check catches this edge case (e.g. user kept the tab open, cookie still present, but JWT is stale)
The refresh token cookie has maxAge: 400 days and its JWT has no exp claim — so the only thing that can kill it is redis.del() on logout or suspension.