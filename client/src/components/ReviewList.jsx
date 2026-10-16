import { useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Notice from "./Notice.jsx";

export default function ReviewList({ reviews = [], sellerId, user, onChange }) {
  const [replyById, setReplyById] = useState({});
  const [reportById, setReportById] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  async function submitReply(event, reviewId) {
    event.preventDefault();
    setBusyId(reviewId);
    setError("");
    try {
      await api.patch(`/reviews/${reviewId}/reply`, { reply: replyById[reviewId] || "" });
      setReplyById((current) => ({ ...current, [reviewId]: "" }));
      setNotice("Reply posted.");
      await onChange?.();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not post your reply."));
    } finally {
      setBusyId("");
    }
  }

  async function submitReport(event, reviewId) {
    event.preventDefault();
    setBusyId(reviewId);
    setError("");
    try {
      await api.post(`/reviews/${reviewId}/report`, { reason: reportById[reviewId] || "" });
      setReportById((current) => ({ ...current, [reviewId]: "" }));
      setNotice("Review report submitted.");
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not report this review."));
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="mt-8">
      <h2 className="text-xl font-black">Buyer reviews</h2>
      <Notice className="mt-3">{error}</Notice>
      <Notice className="mt-3" kind="success">{notice}</Notice>
      <div className="mt-4 space-y-4">
        {reviews.map((review) => (
          <article className="glass-strong p-5" key={review._id}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-bold">{review.buyer?.name || "Carted buyer"}</p>
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">Verified purchase</span>
            </div>
            <p className="mt-2 font-bold text-amber-700" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)} <span className="text-sm">{review.rating}/5</span></p>
            {review.comment && <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{review.comment}</p>}
            {review.reply && <p className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700"><strong>Seller reply:</strong> {review.reply}</p>}
            {user?.role === "vendor" && String(user._id) === String(sellerId) && !review.reply && (
              <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => submitReply(event, review._id)}>
                <input className="field-input" maxLength={500} onChange={(event) => setReplyById((current) => ({ ...current, [review._id]: event.target.value }))} placeholder="Write one reply" required value={replyById[review._id] || ""} />
                <button className="button-secondary shrink-0" disabled={busyId === review._id} type="submit">Reply</button>
              </form>
            )}
            {user && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs font-semibold text-link">Report review</summary>
                <form className="mt-2 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => submitReport(event, review._id)}>
                  <input className="field-input" maxLength={500} minLength={3} onChange={(event) => setReportById((current) => ({ ...current, [review._id]: event.target.value }))} placeholder="Reason for reporting" required value={reportById[review._id] || ""} />
                  <button className="button-secondary shrink-0" disabled={busyId === review._id} type="submit">Send report</button>
                </form>
              </details>
            )}
          </article>
        ))}
        {reviews.length === 0 && <p className="rounded-2xl bg-white p-6 text-sm text-slate-500">No verified reviews yet.</p>}
      </div>
    </section>
  );
}
