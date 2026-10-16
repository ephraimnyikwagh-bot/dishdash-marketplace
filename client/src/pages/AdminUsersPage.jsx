import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";

export default function AdminUsersPage() {
  const [searchParams] = useSearchParams();
  const role = searchParams.get("role") || "";
  const [users, setUsers] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admin/users", {
        params: { page, limit: 25, ...(role ? { role } : {}) }
      });
      setUsers(data.users);
      setTotalPages(Math.max(1, data.totalPages));
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load users."));
    } finally {
      setLoading(false);
    }
  }, [page, role]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  if (loading) return <Loading label="Loading marketplace users..." />;
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <h1 className="text-3xl font-black">Marketplace users</h1>
      <p className="mt-2 text-sm text-slate-500">
        {role ? `Filtered by ${role === "vendor" ? "seller" : role}.` : "Paginated directory of all account roles."}
      </p>
      <Notice className="mt-5">{error}</Notice>
      <div className="mt-6 overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr><th className="px-5 py-3">Name</th><th className="px-5 py-3">Email</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Joined</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user._id}>
                <td className="px-5 py-3 font-semibold">{user.name}</td>
                <td className="px-5 py-3">{user.email}</td>
                <td className="px-5 py-3 capitalize">{user.role === "vendor" ? "Seller" : user.role}</td>
                <td className="px-5 py-3">{user.isActive ? "Active" : "Inactive"}</td>
                <td className="px-5 py-3">{new Date(user.createdAt).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex items-center justify-center gap-4 px-5 py-4">
          <button className="button-secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)} type="button">Previous</button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <button className="button-secondary" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)} type="button">Next</button>
        </div>
      </div>
    </main>
  );
}
