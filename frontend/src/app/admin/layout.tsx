import { requireAdminPage } from "@/lib/auth/guard";

// Server-side admin gate. notFound() renders the same 404 page as any
// non-existent route, so non-admins can't even tell the route exists.
// Every admin page calls the same gate itself (see requireAdminPage); the
// database (RLS + is_admin checks inside every admin RPC function) is the
// actual security boundary.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return <>{children}</>;
}
