import AdminSidebar from "@/components/admin/AdminSidebar";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    // The shell is exactly the window and never scrolls itself — only <main> and the sidebar menu do.
    //  - Sized by its parent (w-full / h-dvh), not w-screen / h-screen: 100vw and 100vh include the scrollbars' space,
    //    so once one scrollbar appeared the page overflowed by a scrollbar's width or height, which kept the other
    //    one alive — a horizontal bar along the bottom and a page that could be scrolled past its content.
    //  - overflow-clip (not -hidden) so the shell can't be scrolled by code either, e.g. by focusing something;
    //    `relative` makes it the container of any absolutely placed element inside, so those are clipped too
    //    instead of stretching the page.
    <div className="relative flex h-dvh w-full gap-6 overflow-clip p-3 lg:p-4">
      <AdminSidebar />
      {/* pt-14 clears the fixed mobile top bar; the desktop rail sits beside the content instead.
          overscroll-y-contain: reaching the end of the page (the last post, say) must not hand the scroll on to the window. */}
      <main className="flex-1 overflow-y-auto overscroll-y-contain px-1 pb-8 pt-14 lg:pr-3 lg:pt-3">{children}</main>
    </div>
  );
}
