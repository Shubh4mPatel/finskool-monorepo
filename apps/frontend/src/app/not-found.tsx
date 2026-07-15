import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f4f0] px-4">
      <div className="animate-rise flex w-full max-w-md flex-col items-center gap-6 rounded-2xl bg-white p-10 text-center shadow-card">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent/10 text-4xl font-bold text-accent">
          404
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-2xl font-bold text-primary">Page Not Found</h1>
          <p className="text-sm text-subtle">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>

        <Link
          href="/feed"
          className="rounded-full bg-gradient-to-r from-lime to-accent px-8 py-3 text-sm font-bold text-white shadow-glow transition-transform duration-300 hover:scale-105 active:scale-95"
        >
          Go to Home
        </Link>
      </div>
    </div>
  );
}
