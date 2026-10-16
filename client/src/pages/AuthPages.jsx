import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getErrorMessage } from "../api.js";
import { useAuth } from "../auth.jsx";
import BrandLogo from "../components/BrandLogo.jsx";
import Notice from "../components/Notice.jsx";

function roleDestination(role) {
  if (role === "vendor") return "/vendor";
  if (role === "courier") return "/courier";
  if (role === "admin") return "/admin";
  return "/catalog";
}

function AuthShell({ eyebrow, title, subtitle, children }) {
  return (
    <main className="mx-auto grid min-h-[calc(100vh-66px)] max-w-6xl items-center gap-10 px-4 py-10 md:grid-cols-2 md:px-6">
      <section className="hidden rounded-[2rem] bg-ink p-10 text-white md:block">
        <div className="w-fit rounded-xl bg-ink p-3"><BrandLogo className="h-16 w-48" tone="dark" /></div>
        <p className="mt-12 text-sm font-bold uppercase tracking-[0.22em] text-primary">
          {eyebrow}
        </p>
        <h1 className="mt-4 text-4xl font-black leading-tight">
          Find your next great deal in your community.
        </h1>
        <p className="mt-5 max-w-md leading-7 text-slate-300">
          Buy and sell confidently with protected payments, clear records, and helpful support.
        </p>
      </section>
      <section className="mx-auto w-full max-w-md rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-100 sm:p-9">
        <div className="mb-5 flex items-center gap-3">
          <span className="rounded-lg bg-ink px-2 py-1"><BrandLogo className="h-12 w-32" tone="dark" /></span>
        </div>
        <p className="text-sm font-bold uppercase tracking-wider text-orange-600">
          {eyebrow}
        </p>
        <h2 className="mt-2 text-3xl font-black">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
        {children}
      </section>
    </main>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user)
    return <Navigate to={roleDestination(user.role)} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const account = await login({ email, password });
      const destination = location.state?.from || roleDestination(account.role);
      navigate(destination, { replace: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not log in."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      subtitle="Log in to shop local listings or manage your seller account."
      title="Sign in"
    >
      <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
        <Notice>{error}</Notice>
        <label className="field-label">
          Email
          <input
            autoComplete="email"
            className="field-input"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label className="field-label">
          Password
          <input
            autoComplete="current-password"
            className="field-input"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <button
          className="button-primary w-full"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Signing in..." : "Log in"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        New to Carted?{" "}
        <Link
          className="font-bold text-orange-700 hover:underline"
          to="/register"
        >
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(searchParams.get("role") === "vendor" ? "vendor" : "buyer");
  const [adminRegistrationKey, setAdminRegistrationKey] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (user)
    return <Navigate to={roleDestination(user.role)} replace />;

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    setSubmitting(true);
    try {
      const account = await register({
        name,
        email,
        password,
        role,
        ...(role === "admin" ? { adminRegistrationKey } : {})
      });
      navigate(roleDestination(account.role), { replace: true });
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not create your account."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      eyebrow="Join the neighborhood"
      subtitle="Join as a buyer, seller, courier, or authorized administrator."
      title="Create account"
    >
      <form className="mt-7 space-y-4" onSubmit={handleSubmit}>
        <Notice>{error}</Notice>
        <label className="field-label">
          I want to
          <select
            className="field-input"
            onChange={(event) => setRole(event.target.value)}
            value={role}
          >
            <option value="buyer">Order as a buyer</option>
            <option value="vendor">Sell as a seller</option>
            <option value="courier">Deliver as a courier</option>
            <option value="admin">Register as an administrator</option>
          </select>
        </label>
        {role === "admin" && (
          <label className="field-label">
            Admin registration key
            <input
              autoComplete="off"
              className="field-input"
              onChange={(event) => setAdminRegistrationKey(event.target.value)}
              required
              type="password"
              value={adminRegistrationKey}
            />
            <span className="text-xs font-normal text-slate-500">
              Admin signup is rejected unless this matches ADMIN_REGISTRATION_KEY on the server.
            </span>
          </label>
        )}
        <label className="field-label">
          Name
          <input
            autoComplete="name"
            className="field-input"
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label className="field-label">
          Email
          <input
            autoComplete="email"
            className="field-input"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label className="field-label">
          Password
          <input
            autoComplete="new-password"
            className="field-input"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <span className="text-xs font-normal text-slate-400">
            At least 8 characters
          </span>
        </label>
        <button
          className="button-primary w-full"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Creating account..." : "Create account"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link className="font-bold text-orange-700 hover:underline" to="/login">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}
