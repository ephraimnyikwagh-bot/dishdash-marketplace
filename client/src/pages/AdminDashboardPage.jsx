import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { StatusBadge } from "./OrdersPage.jsx";
import { formatPrice } from "../money.js";

const colors = ["#007f69", "#16a34a", "#2563eb", "#7c3aed", "#eab308", "#dc2626"];

function MetricCard({ title, value, detail }) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-black text-slate-900">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-400">{detail}</p>}
    </article>
  );
}

export default function AdminDashboardPage({ ordersOnly = false }) {
  const [dashboard, setDashboard] = useState(null);
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const requests = [
        api.get("/admin/orders", { params: { page, limit: 10 } })
      ];
      if (!ordersOnly) requests.push(api.get("/admin/dashboard"));
      const [ordersResponse, dashboardResponse] = await Promise.all(requests);
      setOrders(ordersResponse.data.orders);
      setTotalPages(Math.max(1, ordersResponse.data.totalPages));
      if (dashboardResponse) setDashboard(dashboardResponse.data);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load the admin dashboard."));
    } finally {
      setLoading(false);
    }
  }, [ordersOnly, page]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading label="Loading admin dashboard..." />;

  const statuses = dashboard
    ? Object.entries(dashboard.ordersByStatus).map(([name, value]) => ({
        name,
        value
      }))
    : [];

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
        Administration
      </p>
      <h1 className="mt-2 text-3xl font-black">
        {ordersOnly ? "All orders" : "Marketplace dashboard"}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        Marketplace activity, transaction health, and operational queues.
      </p>
      <Notice className="mt-5">{error}</Notice>

      {!ordersOnly && dashboard && (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              detail={`${dashboard.ordersByStatus?.Paid || 0} paid / processing`}
              title="Transaction volume"
              value={formatPrice(dashboard.transactionVolumeCents)}
            />
            <MetricCard
              detail="Paid and delivered orders"
              title="Platform fee revenue · 7 days"
              value={formatPrice(dashboard.platformFeeRevenue.last7DaysCents)}
            />
            <MetricCard
              detail="Net platform fees, last 30 days"
              title="Platform fee revenue · 30 days"
              value={formatPrice(dashboard.platformFeeRevenue.last30DaysCents)}
            />
            <MetricCard
              detail={`${dashboard.openDisputes} open disputes`}
              title="Active deliveries"
              value={dashboard.activeDeliveries}
            />
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-3">
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 lg:col-span-2">
              <h2 className="font-extrabold">Daily transaction volume · 30 days</h2>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.dailyVolume}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => formatPrice(value)} />
                    <Bar dataKey="volumeCents" fill="#007f69" radius={[5, 5, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
              <h2 className="font-extrabold">Orders by status</h2>
              <div className="mt-2 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statuses} dataKey="value" nameKey="name" outerRadius={78} label>
                      {statuses.map((entry, index) => (
                        <Cell fill={colors[index % colors.length]} key={entry.name} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {Object.entries(dashboard.userCounts).map(([role, count]) => (
                  <Link
                    className="rounded-lg bg-slate-50 px-3 py-2 capitalize hover:bg-orange-50"
                    key={role}
                    to={`/admin/users?role=${role}`}
                  >
                    {role}: <strong>{count}</strong>
                  </Link>
                ))}
              </div>
              <Link className="mt-3 inline-block text-sm font-bold text-orange-700" to="/admin/users">
                Manage users
              </Link>
            </article>
          </section>
        </>
      )}

      <section className="mt-8 rounded-2xl bg-white shadow-sm ring-1 ring-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-extrabold">
            {ordersOnly ? "Marketplace orders" : "Recent orders"}
          </h2>
          {!ordersOnly && (
            <Link className="text-sm font-bold text-orange-700" to="/admin/orders">
              View all
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Buyer</th>
                <th className="px-5 py-3">Seller</th>
                <th className="px-5 py-3">Total</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((order) => (
                <tr key={order._id}>
                  <td className="px-5 py-3">
                    <Link className="font-bold text-orange-700" to={`/orders/${order._id}`}>
                      #{String(order._id).slice(-8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="px-5 py-3">{order.buyer?.email}</td>
                  <td className="px-5 py-3">{order.vendor?.name}</td>
                  <td className="px-5 py-3">{formatPrice(order.totalCents)}</td>
                  <td className="px-5 py-3"><StatusBadge status={order.status} /></td>
                  <td className="px-5 py-3">{new Date(order.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td className="px-5 py-10 text-center text-slate-500" colSpan="6">No orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-center gap-4 px-5 py-4">
          <button className="button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} type="button">
            Previous
          </button>
          <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
          <button className="button-secondary" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)} type="button">
            Next
          </button>
        </div>
      </section>
    </main>
  );
}
