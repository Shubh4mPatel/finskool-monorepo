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