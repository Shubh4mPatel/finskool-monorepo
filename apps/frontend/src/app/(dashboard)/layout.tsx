import Sidebar from "@/components/Sidebar";

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="mx-auto flex w-full max-w-[1512px] flex-1 flex-col gap-5 px-4 py-4 sm:px-6 sm:py-6 lg:flex-row lg:px-8 lg:py-8">
      <Sidebar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
