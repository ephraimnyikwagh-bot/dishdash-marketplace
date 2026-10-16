import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import { StatusBadge, formatPrice } from "./OrdersPage.jsx";

export default function AdminDisputesPage() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const loadDisputes = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/disputes", {
        params: { page: 1, limit: 50 }
      });
      setDisputes(data.disputes);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load disputes."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDisputes();
  }, [loadDisputes]);

  async function updateDispute(disputeId, status) {
    setBusyId(disputeId);
    setError("");
    try {
      await api.patch(`/disputes/${disputeId}`, { status });
      await loadDisputes();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not update this dispute."));
    } finally {
      setBusyId("");
    }
  }

  if (loading) return <Loading label="Loading disputes..." />;
  return (
    <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">Administration</p>
      <h1 className="mt-2 text-3xl font-black">Disputes</h1>
      <p className="mt-2 text-sm text-slate-500">Review buyer reports and system-flagged failed payments.</p>
      <Notice className="mt-5">{error}</Notice>
      {disputes.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-orange-200 bg-white px-6 py-12 text-center text-slate-500">No disputes need review.</div>
      ) : (
        <div className="mt-6 space-y-4">
          {disputes.map((dispute) => (
            <article className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100" key={dispute._id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{dispute.origin} report · {new Date(dispute.createdAt).toLocaleString()}</p>
                  <h2 className="mt-1 font-bold">{dispute.buyer?.name} <span className="font-normal text-slate-500">({dispute.buyer?.email})</span></h2>
                </div>
                <StatusBadge status={dispute.status} />
              </div>
              <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{dispute.reason}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                <Link className="text-sm font-semibold text-orange-700 hover:underline" to={`/orders/${dispute.order?._id}`}>
                  Order #{String(dispute.order?._id || "").slice(-8).toUpperCase()} · {formatPrice(dispute.order?.totalCents)}
                </Link>
                {dispute.status !== "Resolved" && dispute.status !== "Refunded" && (
                  <div className="flex flex-wrap gap-2">
                    {dispute.status === "Open" && (
                      <button className="button-secondary" disabled={busyId === dispute._id} onClick={() => updateDispute(dispute._id, "Under review")} type="button">
                        Under review
                      </button>
                    )}
                    <button className="button-secondary" disabled={busyId === dispute._id} onClick={() => updateDispute(dispute._id, "Resolved")} type="button">
                      Resolve
                    </button>
                    <button className="button-primary" disabled={busyId === dispute._id || dispute.order?.status === "Failed"} onClick={() => updateDispute(dispute._id, "Refunded")} type="button">
                      {busyId === dispute._id ? "Processing..." : "Refund"}
                    </button>
                  </div>
                )}
              </div>
              {dispute.resolution && <p className="mt-3 text-xs text-slate-500">{dispute.resolution}</p>}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
