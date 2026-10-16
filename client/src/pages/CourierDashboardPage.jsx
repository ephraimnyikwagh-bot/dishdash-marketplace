import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { useRealtime } from "../realtime.jsx";
import { formatPrice, StatusBadge } from "./OrdersPage.jsx";

function DeliveryCard({ order, busy, onAccept, onDelivered }) {
  return (
    <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            className="font-bold text-slate-900 hover:text-orange-700"
            to={`/orders/${order._id}`}
          >
            Order #{String(order._id).slice(-8).toUpperCase()}
          </Link>
          <p className="mt-1 text-sm text-slate-500">
            {new Date(order.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>
      <ul className="mt-4 space-y-1 text-sm text-slate-600">
        {order.items.map((item) => (
          <li key={item._id}>
            {item.quantity} × {item.name}
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
        <span className="font-bold">{formatPrice(order.totalCents)}</span>
        {order.status === "Shipped" && order.courier ? (
          <button
            className="button-primary"
            disabled={busy}
            onClick={() => onDelivered(order._id)}
            type="button"
          >
            {busy ? "Updating..." : "Mark Delivered"}
          </button>
        ) : order.status === "Shipped" ? (
          <button
            className="button-primary"
            disabled={busy}
            onClick={() => onAccept(order._id)}
            type="button"
          >
            {busy ? "Accepting..." : "Accept delivery"}
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function CourierDashboardPage() {
  const { updates } = useRealtime();
  const [available, setAvailable] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadDeliveries = useCallback(async () => {
    setError("");
    try {
      const [availableResponse, deliveryResponse] = await Promise.all([
        api.get("/courier/available", { params: { limit: 50 } }),
        api.get("/courier/deliveries", { params: { limit: 50 } })
      ]);
      setAvailable(availableResponse.data.orders);
      setDeliveries(deliveryResponse.data.orders);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load deliveries."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeliveries();
  }, [loadDeliveries]);

  useEffect(() => {
    if (updates.length) loadDeliveries();
  }, [updates, loadDeliveries]);

  async function updateDelivery(orderId, action) {
    setBusyId(orderId);
    setError("");
    try {
      await api.post(`/courier/${orderId}/${action}`);
      await loadDeliveries();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not update this delivery."));
      await loadDeliveries();
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <Loading label="Loading courier dashboard..." />;

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
        Courier workspace
      </p>
      <h1 className="mt-2 text-3xl font-black">Delivery dashboard</h1>
      <p className="mt-2 text-sm text-slate-500">
        Accept a ready order, then mark it delivered when it reaches the buyer.
      </p>
      <Notice className="mt-5">{error}</Notice>

      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Available deliveries</h2>
        {available.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-orange-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
            No deliveries are waiting for pickup right now.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {available.map((order) => (
              <DeliveryCard
                busy={busyId === order._id}
                key={order._id}
                onAccept={(id) => updateDelivery(id, "accept")}
                order={order}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-extrabold">My deliveries</h2>
        {deliveries.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
            Accepted deliveries will appear here.
          </div>
        ) : (
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {deliveries.map((order) => (
              <DeliveryCard
                busy={busyId === order._id}
                key={order._id}
                onDelivered={(id) => updateDelivery(id, "delivered")}
                order={order}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
