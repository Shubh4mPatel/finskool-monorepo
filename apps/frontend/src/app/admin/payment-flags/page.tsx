import { redirect } from "next/navigation";

// Payment flags became the Transactions screen (filtered to flagged payments). Old links, emails and notifications that
// still point here land on the right list, with the request they were about marked.
export default async function PaymentFlagsRedirect({ searchParams }: { searchParams: Promise<{ request?: string }> }) {
  const { request } = await searchParams;
  redirect(`/admin/transactions?status=flagged${request ? `&request=${encodeURIComponent(request)}` : ""}`);
}
