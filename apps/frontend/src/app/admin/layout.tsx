import AdminSidebar from "@/components/admin/AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-screen gap-6 overflow-hidden p-3 lg:p-4">
      <AdminSidebar />
      {/* pt-14 clears the fixed mobile top bar; the desktop rail sits beside the content instead. */}
      <main className="flex-1 overflow-y-auto px-1 pb-8 pt-14 lg:pr-3 lg:pt-3">{children}</main>
    </div>
  );
}
