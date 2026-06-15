import { MessagesSquare } from "lucide-react";

export default function RepliesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-primary">My Replies</h1>

      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white p-16 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-divider text-primary">
          <MessagesSquare size={24} />
        </div>
        <p className="font-display text-lg font-bold text-primary">No replies yet</p>
        <p className="max-w-sm text-sm text-muted">
          Replies you post on the live feed and discussion threads will show up here.
        </p>
      </div>
    </div>
  );
}
