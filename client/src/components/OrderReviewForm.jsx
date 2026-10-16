import { useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Notice from "./Notice.jsx";

export default function OrderReviewForm({ order, onSubmitted }) {
  const [rating, setRating] = useState("5");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  if (order.hasReview || submitted) {
    return <p className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">Thank you for reviewing this verified purchase.</p>;
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.post("/reviews", {
        orderId: order._id,
        rating: Number(rating),
        comment
      });
      setSubmitted(true);
      await onSubmitted?.();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not submit your review."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="glass-strong mt-6 p-5" onSubmit={submit}>
      <h2 className="text-lg font-extrabold">Leave a review</h2>
      <p className="mt-1 text-sm text-slate-600">Verified purchase · one review for this order.</p>
      <Notice className="mt-3">{error}</Notice>
      <div className="mt-3 grid gap-3 sm:grid-cols-[140px_1fr]">
        <label className="field-label">
          Rating
          <select className="field-input" onChange={(event) => setRating(event.target.value)} value={rating}>
            {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} / 5</option>)}
          </select>
        </label>
        <label className="field-label">
          Comment (optional)
          <textarea className="field-input min-h-20" maxLength={500} onChange={(event) => setComment(event.target.value)} value={comment} />
        </label>
      </div>
      <button className="button-primary mt-4" disabled={busy} type="submit">{busy ? "Submitting..." : "Submit review"}</button>
    </form>
  );
}
