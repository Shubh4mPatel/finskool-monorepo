"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiLock, FiSend, FiTrash2, FiCornerDownRight, FiChevronDown, FiChevronUp } from "react-icons/fi";
import { api, ApiError } from "@/lib/api";
import { getSession, saveSession } from "@/lib/session";

interface CommentAuthor {
  id: string;
  name: string;
  role: string;
  avatarUrl: string | null;
}

interface CommentNotificationRef {
  id: string;
  isReplied: boolean;
}

interface Comment {
  id: string;
  content: string;
  depth: number;
  createdAt: string;
  author: CommentAuthor;
  notification: CommentNotificationRef | null;
  replies: Comment[];
}

interface CommentsResponse {
  comments: Comment[];
  nextCursor: string | null;
  hasMore: boolean;
}

function countAllComments(comments: Comment[]): number {
  return comments.reduce((sum, c) => sum + 1 + countAllComments(c.replies), 0);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function authorInitials(name: string): string {
  return name.split(" ").slice(0, 2).map(w => w[0] ?? "").join("").toUpperCase();
}

// ── Single comment node ──────────────────────────────────────────────────────

// Pastel avatar palette cycled across anonymised members (M1, M2, M3, …)
const MEMBER_AVATAR_COLORS = [
  { bg: "#e8f5ec", text: "#153d3a" },
  { bg: "#e0f4f4", text: "#108b8b" },
  { bg: "#e8eeec", text: "#2d5e5a" },
];

function buildMemberLabels(comments: Comment[], currentUserId: string): Map<string, string> {
  const map = new Map<string, string>();
  let n = 0;
  function walk(list: Comment[]) {
    for (const c of list) {
      if (c.author.role !== "admin" && c.author.id !== currentUserId && !map.has(c.author.id)) {
        n += 1;
        map.set(c.author.id, `M${n}`);
      }
      walk(c.replies);
    }
  }
  walk(comments);
  return map;
}

function displayName(author: CommentAuthor, currentUserId: string, memberLabels: Map<string, string>): string {
  if (author.id === currentUserId) return "You";
  if (author.role === "admin") return author.name;
  return memberLabels.get(author.id) ?? "Member";
}

function CommentNode({
  comment,
  currentUserId,
  isAdmin,
  memberLabels,
  onReply,
  onDelete,
  onMarkReplied,
  markingRepliedId,
}: {
  comment: Comment;
  currentUserId: string;
  isAdmin: boolean;
  memberLabels: Map<string, string>;
  onReply: (id: string, label: string) => void;
  onDelete: (id: string) => void;
  onMarkReplied?: (notificationId: string) => void;
  markingRepliedId?: string | null;
}) {
  const isAuthorAdmin = comment.author.role === "admin";
  const isOwn = comment.author.id === currentUserId;
  const hasReplies = comment.replies.length > 0;
  // Members can only delete their own comment if no one has replied yet; admins can always delete
  const canDelete = isAdmin || (isOwn && !hasReplies);
  const label = displayName(comment.author, currentUserId, memberLabels);
  const isPending = isAdmin && !!comment.notification && !comment.notification.isReplied;
  const memberLabel = memberLabels.get(comment.author.id);
  const memberColorIndex = memberLabel ? (parseInt(memberLabel.slice(1), 10) - 1) % MEMBER_AVATAR_COLORS.length : 0;
  const avatarColor = MEMBER_AVATAR_COLORS[memberColorIndex]!;

  return (
    <div className={`flex gap-3 ${comment.depth > 0 ? "ml-7 border-l-2 pl-4 pt-1 border-[#85cd78]/50" : ""}`}>
      {/* Avatar */}
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={
          isAuthorAdmin
            ? { background: "#153d3a", color: "#ffffff" }
            : isOwn
              ? { background: "#108b8b", color: "#ffffff" }
              : { background: avatarColor.bg, color: avatarColor.text }
        }
      >
        {isAuthorAdmin || isOwn ? authorInitials(comment.author.name) : label}
      </div>

      <div className={`flex-1 min-w-0 ${isAuthorAdmin ? "rounded-xl border-l-4 border-[#85cd78] bg-background px-3.5 py-3" : ""}`}>
        {/* Header */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-primary">{label}</span>
          {isAuthorAdmin && (
            <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-primary">ADMIN</span>
          )}
          {isPending && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-600">PENDING</span>
          )}
          <span className="text-xs text-subtle">{timeAgo(comment.createdAt)}</span>

          {canDelete && (
            <button
              onClick={() => onDelete(comment.id)}
              className="ml-auto text-subtle hover:text-red-500 transition-colors"
              title="Delete comment"
            >
              <FiTrash2 size={12} />
            </button>
          )}
        </div>

        {/* Content */}
        <p className="mt-1 text-sm leading-relaxed text-muted">{comment.content}</p>

        {/* Reply / Mark Replied actions */}
        <div className="mt-1.5 flex items-center gap-3">
          <button
            onClick={() => onReply(comment.id, label)}
            className="flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
          >
            <FiCornerDownRight size={11} />
            {isOwn && hasReplies ? `Reply (${comment.replies.length})` : "Reply"}
          </button>
          {isPending && onMarkReplied && comment.notification && (
            <button
              onClick={() => onMarkReplied(comment.notification!.id)}
              disabled={markingRepliedId === comment.notification.id}
              className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-primary disabled:opacity-50"
            >
              {markingRepliedId === comment.notification.id ? "Marking…" : "Mark Replied"}
            </button>
          )}
        </div>

        {/* Nested replies */}
        {comment.replies.map(reply => (
          <div key={reply.id} className="mt-3">
            <CommentNode
              comment={reply}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              memberLabels={memberLabels}
              onReply={onReply}
              onDelete={onDelete}
              onMarkReplied={onMarkReplied}
              markingRepliedId={markingRepliedId}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Reply input card ─────────────────────────────────────────────────────────

function ReplyCard({
  replyingTo,
  text,
  submitting,
  inputRef,
  currentUserInitials,
  onChange,
  onSubmit,
  onCancelReply,
}: {
  replyingTo: { id: string; name: string } | null;
  text: string;
  submitting: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  currentUserInitials: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onCancelReply: () => void;
}) {
  return (
    <div className="flex gap-3 items-start">
      {/* Current user avatar */}
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-divider text-xs font-bold text-muted">
        {currentUserInitials || "U"}
      </div>

      <div className="flex-1">
        {/* Replying-to indicator */}
        {replyingTo && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <FiCornerDownRight size={12} className="text-accent" />
            <span className="text-xs text-muted">
              Replying to <span className="font-semibold text-primary">{replyingTo.name}</span>
            </span>
            <button onClick={onCancelReply} className="ml-1 text-xs text-subtle hover:text-primary">
              · Cancel
            </button>
          </div>
        )}

        {/* Input box */}
        <div className="overflow-hidden rounded-xl border border-accent bg-white focus-within:border-primary transition-colors">
          <textarea
            ref={inputRef}
            value={text}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSubmit();
            }}
            placeholder="Add to the discussion..."
            rows={2}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-primary placeholder:text-subtle focus:outline-none"
          />
        </div>

        {/* Footer row */}
        <div className="mt-2.5 flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-xs text-subtle">
            <FiLock size={11} />
            Your identity is kept private from other members
          </p>
          <button
            onClick={onSubmit}
            disabled={submitting || !text.trim()}
            className="flex items-center gap-1.5 rounded-full px-5 py-2 text-xs font-bold text-white transition-transform hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: "linear-gradient(to right, #c1f26e, #108b8b)" }}
          >
            {submitting ? "Posting…" : "Post Reply"}
            <FiSend size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main PostThreads ─────────────────────────────────────────────────────────

export default function PostThreads({
  postId,
  initialCount = 0,
  isAdmin = false,
  defaultOpen = false,
  onChange,
}: {
  postId: string;
  initialCount?: number;
  isAdmin?: boolean;
  defaultOpen?: boolean;
  onChange?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [comments, setComments] = useState<Comment[]>([]);
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [markingRepliedId, setMarkingRepliedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const [currentUserId, setCurrentUserId] = useState(getSession()?.userId ?? "");
  const currentUserInitials = getSession()?.userInitials ?? "U";

  // Backfill userId into session if it was saved before we added that field
  useEffect(() => {
    if (currentUserId) return;
    api.get<{ user: { id: string } }>("/api/v1/auth/me").then(data => {
      const session = getSession();
      if (session) saveSession({ ...session, userId: data.user.id });
      setCurrentUserId(data.user.id);
    }).catch(() => {});
  }, [currentUserId]);

  async function fetchComments(cur?: string | null) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (cur) params.set("cursor", cur);
      const data = await api.get<CommentsResponse>(`/api/v1/posts/${postId}/comments?${params}`);
      setComments(prev => cur ? [...prev, ...data.comments] : data.comments);
      if (!cur) setCount(countAllComments(data.comments));
      setHasMore(data.hasMore);
      setCursor(data.nextCursor);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && comments.length === 0) fetchComments();
  }, [open]);

  function handleReply(id: string, name: string) {
    setReplyingTo({ id, name });
    setText("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleSubmit() {
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/api/v1/posts/${postId}/comments`, {
        content: text.trim(),
        ...(replyingTo ? { parentCommentId: replyingTo.id } : {}),
      });
      setText("");
      setReplyingTo(null);
      setComments([]);
      setCount(c => c + 1);
      await fetchComments();
      onChange?.();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to post reply");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this comment and its replies?")) return;
    try {
      await api.delete(`/api/v1/comments/${id}`);
      setComments([]);
      setCount(c => Math.max(0, c - 1));
      await fetchComments();
      onChange?.();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Failed to delete comment");
    }
  }

  async function handleMarkReplied(notificationId: string) {
    setMarkingRepliedId(notificationId);
    try {
      await api.patch(`/api/v1/admin/comment-notifications/${notificationId}/mark-replied`, {});
      setComments([]);
      await fetchComments();
      onChange?.();
    } catch {
      alert("Failed to mark thread as replied");
    } finally {
      setMarkingRepliedId(null);
    }
  }

  const memberLabels = useMemo(() => buildMemberLabels(comments, currentUserId), [comments, currentUserId]);

  return (
    <div className="mt-4 border-t border-divider pt-4">
      {/* Toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline"
      >
        {open ? <FiChevronUp size={15} /> : <FiChevronDown size={15} />}
        {open ? "Hide Threads" : `View Threads (${count})`}
      </button>

      {open && (
        <div className="mt-5 flex flex-col gap-5 rounded-xl bg-[#fafbfe] p-4">
          {/* Thread count heading */}
          {comments.length > 0 && (
            <p className="text-sm">
              <span className="font-bold text-primary">Threads</span>{" "}
              <span className="font-semibold text-accent">({count})</span>
            </p>
          )}

          {/* Comments */}
          {loading && comments.length === 0 ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => <div key={i} className="h-12 animate-pulse rounded-xl bg-divider/60" />)}
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-subtle">No comments yet. Be the first to reply!</p>
          ) : (
            <div className="flex flex-col gap-5">
              {comments.map(c => (
                <CommentNode
                  key={c.id}
                  comment={c}
                  currentUserId={currentUserId}
                  isAdmin={isAdmin}
                  memberLabels={memberLabels}
                  onReply={handleReply}
                  onDelete={handleDelete}
                  onMarkReplied={handleMarkReplied}
                  markingRepliedId={markingRepliedId}
                />
              ))}
              {hasMore && (
                <button
                  onClick={() => fetchComments(cursor)}
                  disabled={loading}
                  className="text-sm font-semibold text-accent hover:underline disabled:opacity-50"
                >
                  Load more…
                </button>
              )}
            </div>
          )}

          {/* Reply card */}
          <ReplyCard
            replyingTo={replyingTo}
            text={text}
            submitting={submitting}
            inputRef={inputRef}
            currentUserInitials={currentUserInitials}
            onChange={setText}
            onSubmit={handleSubmit}
            onCancelReply={() => setReplyingTo(null)}
          />
        </div>
      )}
    </div>
  );
}
