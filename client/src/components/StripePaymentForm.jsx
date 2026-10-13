import { useState } from "react";
import {
  PaymentElement,
  useElements,
  useStripe
} from "@stripe/react-stripe-js";

export default function StripePaymentForm({ clientSecret, onPaid }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError("");
    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        setError(submitError.message || "Check your payment details.");
        return;
      }

      const result = await stripe.confirmPayment({
        elements,
        clientSecret,
        redirect: "if_required"
      });
      if (result.error) {
        setError(result.error.message || "Payment could not be confirmed.");
        return;
      }
      if (result.paymentIntent?.status === "succeeded") {
        onPaid();
      } else {
        setError(
          "Payment is processing. Keep this page open while confirmation completes."
        );
      }
    } catch {
      setError("Payment could not be completed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-5 space-y-5" onSubmit={handleSubmit}>
      {error && (
        <div
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </div>
      )}
      <PaymentElement />
      <button
        className="button-primary w-full"
        disabled={!stripe || submitting}
        type="submit"
      >
        {submitting ? "Processing payment..." : "Pay securely"}
      </button>
      <p className="text-center text-xs text-slate-500">
        Secure sandbox payment by Stripe. Card details are sent directly to
        Stripe.
      </p>
    </form>
  );
}
