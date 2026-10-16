import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import { useAuth } from "../auth.jsx";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { useRealtime } from "../realtime.jsx";
import { formatPrice } from "../money.js";

function StatusBadge({ status }) {
  const styles = {
    Paid: "bg-emerald-100 text-emerald-800",
    Pending: "bg-amber-100 text-amber-800",
    Failed: "bg-red-100 text-red-800",
    Delivered: "bg-sky-100 text-sky-800",
    Shipped: "bg-indigo-100 text-indigo-800",
    "Ready for pickup": "bg-teal-100 text-teal-800",
    Cancelled: "bg-slate-100 text-slate-700",
    Refunded: "bg-purple-100 text-purple-800",
    "Under review": "bg-amber-100 text-amber-800",
    Open: "bg-amber-100 text-amber-800",
    Resolved: "bg-slate-100 text-slate-700"
  };
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${styles[status] || styles.Pending}`}>
      {status}
    </span>
  );
}

export { StatusBadge, formatPrice };

export default function OrdersPage() {
  const { user } = useAuth();
  const { updates } = useRealtime();
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/orders", {
        params: { page, limit: 10 }
      });
      setOrders(data.orders);
      setTotalPages(data.totalPages);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load orders."));
    } finally {
      setLoading(false);
    }
  }, [page, user.role]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    if (updates.length) loadOrders();
  }, [updates, loadOrders]);

  const seller = user.role === "vendor";

  async function markOrderReady(orderId, status) {
    setError("");
    try {
      await api.patch(`/orders/${orderId}/status`, { status });
      await loadOrders();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not mark the order shipped."));
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
        {seller ? "Seller" : "Your account"}
      </p>
      <h1 className="mt-2 text-3xl font-black">
        {seller ? "Incoming orders" : "My orders"}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        {seller ? "Paid orders containing your listings." : "Your recent orders and payment status."}
      </p>
      <Notice className="mt-5">{error}</Notice>
      {loading ? (
        <Loading label="Loading orders..." />
      ) : orders.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-orange-200 bg-white px-6 py-14 text-center">
          <div className="text-5xl">{seller ? "📨" : "🧾"}</div>
          <h2 className="mt-4 font-bold">
            {seller ? "No incoming orders yet" : "No orders yet"}
          </h2>
          {!seller && (
            <Link className="button-primary mt-5 inline-flex" to="/catalog">
              Browse listings
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((order) => (
          <article
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 transition hover:shadow-md"
              key={order._id}
          >
            <Link className="min-w-0 flex-1" to={`/orders/${order._id}`}>
              <p className="text-xs font-semibold text-slate-400">
                {new Date(order.createdAt).toLocaleString()}
              </p>
              <h2 className="mt-1 font-bold">
                Order #{String(order._id).slice(-8).toUpperCase()}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {formatPrice(order.totalCents)}
              </p>
            </Link>
            <div className="flex items-center gap-3">
              <StatusBadge status={order.status} />
              {seller && order.status === "Paid" && (
                <button
                  className="button-primary !px-3 !py-2"
                  onClick={() => markOrderReady(order._id, order.deliveryMethod === "pickup" ? "Ready for pickup" : "Shipped")}
                  type="button"
                >
                  {order.deliveryMethod === "pickup" ? "Ready for pickup" : "Mark Shipped"}
                </button>
              )}
            </div>
          </article>
          ))}
          <div className="flex items-center justify-center gap-4 pt-4">
            <button
              className="button-secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              type="button"
            >
              Previous
            </button>
            <span className="text-sm text-slate-500">
              Page {page} of {Math.max(1, totalPages)}
            </span>
            <button
              className="button-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((value) => value + 1)}
              type="button"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
