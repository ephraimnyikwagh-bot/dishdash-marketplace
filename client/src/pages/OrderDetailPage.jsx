import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { formatPrice, StatusBadge } from "./OrdersPage.jsx";

export default function OrderDetailPage() {
  const { orderId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    api
      .get(`/orders/${orderId}`)
      .then(({ data: result }) => {
        if (active) setData(result);
      })
      .catch((requestError) => {
        if (active) setError(getErrorMessage(requestError, "Could not load the order."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [orderId]);

  if (loading) return <Loading label="Loading order..." />;
  if (error) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <Notice>{error}</Notice>
      </main>
    );
  }
  if (!data) return null;

  const { order, items } = data;
  const heading =
    order.status === "Paid"
      ? "Order confirmed"
      : order.status === "Failed"
        ? "Payment failed"
        : order.status === "Cancelled"
          ? "Order cancelled"
          : "Order details";
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-10 sm:px-6">
      <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100 sm:p-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
              {order.status === "Paid" ? "Payment confirmed" : "Order details"}
            </p>
            <h1 className="mt-2 text-3xl font-black">{heading}</h1>
            <p className="mt-2 text-sm text-slate-500">
              #{String(order._id).slice(-8).toUpperCase()} ·{" "}
              {new Date(order.createdAt).toLocaleString()}
            </p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="mt-7 divide-y divide-slate-100 border-y border-slate-100">
          {items.map((item) => (
            <div className="flex justify-between gap-4 py-4" key={item._id}>
              <div>
                <p className="font-bold">{item.name}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {item.quantity} × {formatPrice(item.unitPriceCents)}
                </p>
              </div>
              <span className="font-bold">{formatPrice(item.lineTotalCents)}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex justify-between text-lg font-black">
          <span>{order.status === "Paid" ? "Total paid" : "Order total"}</span>
          <span>{formatPrice(order.totalCents)}</span>
        </div>
        {order.status === "Paid" && (
          <p className="mt-5 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Thank you. Your payment has been confirmed.
          </p>
        )}
        {order.status === "Failed" && (
          <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
            Payment was not completed. Reserved stock has been released. You
            can add the items to your cart and try again.
          </p>
        )}
        <Link className="button-primary mt-6 inline-flex" to="/orders">
          View all orders
        </Link>
      </section>
    </main>
  );
}
