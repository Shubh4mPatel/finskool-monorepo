import { Megaphone } from "lucide-react";

export default function AnnouncementsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-2xl font-bold text-primary">Announcements</h1>

      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl bg-white p-16 text-center shadow-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-divider text-primary">
          <Megaphone size={24} />
        </div>
        <p className="font-display text-lg font-bold text-primary">No announcements yet</p>
        <p className="max-w-sm text-sm text-muted">
          Important updates and notices from your admin will show up here.
        </p>
      </div>
    </div>
  );
}
