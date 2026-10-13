import { Link, Route, Routes } from "react-router-dom";

function Home() {
  return (
    <main className="min-h-screen bg-orange-50 px-6 text-slate-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between py-6">
        <Link
          className="text-2xl font-black tracking-tight text-orange-600"
          to="/"
        >
          DishDash
        </Link>
        <nav className="flex items-center gap-5 text-sm font-semibold">
          <Link className="hover:text-orange-600" to="/login">
            Log in
          </Link>
          <Link
            className="rounded-full bg-orange-600 px-5 py-3 text-white hover:bg-orange-700"
            to="/register"
          >
            Get started
          </Link>
        </nav>
      </header>
      <section className="mx-auto grid max-w-6xl items-center gap-12 py-16 md:grid-cols-2 md:py-28">
        <div>
          <p className="mb-4 font-bold uppercase tracking-[0.2em] text-orange-600">
            Your neighborhood, on a plate
          </p>
          <h1 className="max-w-xl text-5xl font-black leading-tight sm:text-6xl">
            Good food. Delivered with care.
          </h1>
          <p className="mt-6 max-w-lg text-lg leading-8 text-slate-600">
            Discover local kitchens, order your favorites, and follow every
            delivery right to your door.
          </p>
          <Link
            className="mt-8 inline-flex rounded-full bg-slate-900 px-7 py-4 font-bold text-white hover:bg-slate-700"
            to="/register"
          >
            Explore the menu
          </Link>
        </div>
        <div
          aria-hidden="true"
          className="flex aspect-square items-center justify-center rounded-[2.5rem] bg-orange-200 text-9xl shadow-inner"
        >
          🍜
        </div>
      </section>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
