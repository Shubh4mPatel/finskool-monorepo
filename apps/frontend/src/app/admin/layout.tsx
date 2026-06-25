import AdminSidebar from "@/components/admin/AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen gap-4 overflow-hidden p-4">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto py-4 pr-2">{children}</main>
    </div>
  );
}
