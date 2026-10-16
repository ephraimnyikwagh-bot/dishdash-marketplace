import { lazy, Suspense, useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate
} from "react-router-dom";
import { setUnauthorizedHandler } from "./api.js";
import { AuthProvider, useAuth } from "./auth.jsx";
import { CartProvider, useCart } from "./cart.jsx";
import { LoginPage, RegisterPage } from "./pages/AuthPages.jsx";
import CatalogPage from "./pages/CatalogPage.jsx";
import CartPage from "./pages/CartPage.jsx";
import VendorDashboardPage from "./pages/VendorDashboardPage.jsx";
import PaymentPage, { PaymentReturnPage } from "./pages/PaymentPage.jsx";
import OrdersPage from "./pages/OrdersPage.jsx";
import OrderDetailPage from "./pages/OrderDetailPage.jsx";
import CourierDashboardPage from "./pages/CourierDashboardPage.jsx";
import { RealtimeProvider, useRealtime } from "./realtime.jsx";
const AdminDashboardPage = lazy(() => import("./pages/AdminDashboardPage.jsx"));
const AdminLedgerPage = lazy(() => import("./pages/AdminLedgerPage.jsx"));
const AdminDisputesPage = lazy(() => import("./pages/AdminDisputesPage.jsx"));
const AdminUsersPage = lazy(() => import("./pages/AdminUsersPage.jsx"));

function Spinner({ label = "Loading..." }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm font-semibold text-slate-500">
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600"
      />
      {label}
    </div>
  );
}

function RoleHome({ role }) {
  if (role === "vendor") return <Navigate to="/vendor" replace />;
  if (role === "buyer") return <Navigate to="/catalog" replace />;
  if (role === "courier") return <Navigate to="/courier" replace />;
  if (role === "admin") return <Navigate to="/admin" replace />;
  return <Navigate to="/login" replace />;
}

function Guard({ roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Spinner label="Checking your session..." />;
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (roles && !roles.includes(user.role)) return <RoleHome role={user.role} />;
  return <Outlet />;
}

function Navbar() {
  const { user, logout } = useAuth();
  const { count } = useCart();
  const { connected, updates, clearUpdates } = useRealtime();
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-20 border-b border-orange-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link
          aria-label="DishDash home"
          className="flex shrink-0 items-center gap-2"
          to={
            user
              ? user.role === "vendor"
                ? "/vendor"
                : user.role === "courier"
                  ? "/courier"
                  : user.role === "admin"
                    ? "/admin"
                    : "/catalog"
              : "/login"
          }
        >
          <img alt="" className="h-10 w-10 rounded-xl" src="/logo.png" />
          <span className="text-xl font-black tracking-tight text-slate-900">
            Dish<span className="text-orange-600">Dash</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          {user?.role === "buyer" && (
            <>
              <Link className="nav-link" to="/catalog">
                Menu
              </Link>
              <Link className="nav-link" to="/orders">
                Orders
              </Link>
              <Link
                aria-label={`Cart, ${count} items`}
                className="relative rounded-xl p-2 text-slate-700 hover:bg-orange-50"
                to="/cart"
              >
                <svg
                  aria-hidden="true"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M3 4h2l2.1 10.1a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 1.9-1.4L22 8H6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="10" cy="20" r="1" />
                  <circle cx="18" cy="20" r="1" />
                </svg>
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
                  {count}
                </span>
              </Link>
            </>
          )}
          {user?.role === "vendor" && (
            <>
              <Link className="nav-link" to="/vendor">
                My kitchen
              </Link>
              <Link className="nav-link" to="/orders">
                Incoming orders
              </Link>
            </>
          )}
          {user?.role === "courier" && (
            <Link className="nav-link" to="/courier">
              Deliveries
            </Link>
          )}
          {user?.role === "admin" && (
            <>
              <Link className="nav-link" to="/admin">Dashboard</Link>
              <Link className="nav-link" to="/admin/orders">Orders</Link>
              <Link className="nav-link" to="/admin/users">Users</Link>
              <Link className="nav-link" to="/admin/ledger">Ledger</Link>
              <Link className="nav-link" to="/admin/disputes">Disputes</Link>
            </>
          )}
          {user && (
            <div className="relative">
              <button
                aria-expanded={notificationsOpen}
                aria-label={`Notifications${updates.length ? `, ${updates.length} recent updates` : ""}`}
                className="relative rounded-xl p-2 text-slate-700 hover:bg-orange-50"
                onClick={() => {
                  setNotificationsOpen((open) => !open);
                }}
                type="button"
              >
                <svg
                  aria-hidden="true"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                {!connected && (
                  <span
                    aria-label="Live updates disconnected"
                    className="absolute right-1 top-1 h-2 w-2 rounded-full bg-slate-300"
                    title="Live updates disconnected"
                  />
                )}
                {updates.length > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-600 px-1 text-[10px] font-bold text-white">
                    {updates.length}
                  </span>
                )}
              </button>
              {notificationsOpen && (
                <div className="absolute right-0 top-12 z-30 w-72 rounded-2xl border border-slate-100 bg-white p-3 shadow-xl">
                  <div className="flex items-center justify-between px-2 py-1">
                    <p className="font-bold">Recent updates</p>
                    <button
                      className="text-xs font-semibold text-orange-700"
                      onClick={clearUpdates}
                      type="button"
                    >
                      Clear
                    </button>
                  </div>
                  {updates.length === 0 ? (
                    <p className="px-2 py-4 text-sm text-slate-500">
                      No recent order updates.
                    </p>
                  ) : (
                    <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                      {updates.map((update) => (
                        <li key={update.notificationId}>
                          <Link
                            className="block rounded-xl px-2 py-2 text-sm hover:bg-orange-50"
                            onClick={() => setNotificationsOpen(false)}
                            to={
                              user.role === "courier"
                                ? "/courier"
                                : `/orders/${update.orderId}`
                            }
                          >
                            Order #{String(update.orderId).slice(-8)} is{" "}
                            {update.status}.
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}
          <span className="hidden max-w-32 truncate text-sm text-slate-500 md:block">
            {user?.name}
          </span>
          {user && (
            <button
              className="button-secondary !px-3 !py-2"
              onClick={handleLogout}
              type="button"
            >
              Log out
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}

function AppFrame() {
  const { user } = useAuth();
  const { refreshCart } = useCart();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      window.localStorage.removeItem("dishdash.session");
      window.location.assign("/login");
    });
  }, []);

  useEffect(() => {
    if (user?.role === "buyer") refreshCart();
  }, [refreshCart, user]);

  return (
    <div className="min-h-screen bg-[#fffaf5] text-slate-900">
      <Navbar />
      <Routes>
        <Route path="/" element={<RoleHome role={user?.role} />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<Guard roles={["buyer"]} />}>
          <Route path="/catalog" element={<CatalogPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/payment/return" element={<PaymentReturnPage />} />
          <Route path="/payment/:paymentId" element={<PaymentPage />} />
        </Route>
        <Route element={<Guard roles={["vendor"]} />}>
          <Route path="/vendor" element={<VendorDashboardPage />} />
        </Route>
        <Route element={<Guard roles={["buyer", "vendor", "admin"]} />}>
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Route>
        <Route element={<Guard roles={["courier"]} />}>
          <Route path="/courier" element={<CourierDashboardPage />} />
          <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        </Route>
        <Route element={<Guard roles={["admin"]} />}>
          <Route path="/admin" element={<Suspense fallback={<Spinner label="Loading admin..." />}><AdminDashboardPage /></Suspense>} />
          <Route path="/admin/orders" element={<Suspense fallback={<Spinner label="Loading orders..." />}><AdminDashboardPage ordersOnly /></Suspense>} />
          <Route path="/admin/users" element={<Suspense fallback={<Spinner label="Loading users..." />}><AdminUsersPage /></Suspense>} />
          <Route path="/admin/ledger" element={<Suspense fallback={<Spinner label="Loading ledger..." />}><AdminLedgerPage /></Suspense>} />
          <Route path="/admin/disputes" element={<Suspense fallback={<Spinner label="Loading disputes..." />}><AdminDisputesPage /></Suspense>} />
        </Route>
        <Route path="*" element={<RoleHome role={user?.role} />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CartProvider>
        <RealtimeProvider>
          <AppFrame />
        </RealtimeProvider>
      </CartProvider>
    </AuthProvider>
  );
}
