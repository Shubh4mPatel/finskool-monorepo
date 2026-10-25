import { redirect } from "next/navigation";

// The website is the admin console; middleware sends anyone who isn't signed in on to /login.
export default function Home() {
  redirect("/admin/dashboard");
}
