import { useCallback, useEffect, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";

const emptyForm = {
  name: "",
  category: "",
  description: "",
  priceCents: "",
  stock: "",
  imageUrl: ""
};

function formatPrice(cents) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format((cents || 0) / 100);
}

export default function VendorDashboardPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/products/mine");
      setProducts(data.products || []);
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load your products."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId("");
  }

  function startEditing(product) {
    setEditingId(product._id);
    setForm({
      name: product.name,
      category: product.category,
      description: product.description || "",
      priceCents: String(product.priceCents),
      stock: String(product.stock),
      imageUrl: product.imageUrl || ""
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const priceCents = Number(form.priceCents);
    const stock = Number(form.stock);
    if (!Number.isInteger(priceCents) || priceCents < 1) {
      setError("Enter a price of at least 1 cent.");
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      setError("Stock must be a whole number greater than or equal to zero.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    const payload = { ...form, priceCents, stock };
    try {
      if (editingId) {
        await api.patch(`/products/${editingId}`, payload);
        setNotice("Product updated.");
      } else {
        await api.post("/products", payload);
        setNotice("Product added to your menu.");
      }
      resetForm();
      await loadProducts();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not save this product."));
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(product) {
    if (!window.confirm(`Remove "${product.name}" from your menu?`)) return;
    setError("");
    setNotice("");
    try {
      await api.delete(`/products/${product._id}`);
      setProducts((current) =>
        current.filter((item) => item._id !== product._id)
      );
      setNotice("Product removed from your menu.");
      if (editingId === product._id) resetForm();
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not remove this product."));
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 pb-16 pt-8 sm:px-6">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-600">
            Your kitchen
          </p>
          <h1 className="mt-2 text-3xl font-black">Vendor dashboard</h1>
          <p className="mt-2 text-sm text-slate-500">
            Manage your dishes, prices, and available stock.
          </p>
        </div>
        <span className="rounded-full bg-orange-100 px-4 py-2 text-sm font-bold text-orange-800">
          {products.length} {products.length === 1 ? "product" : "products"}
        </span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
          <h2 className="text-lg font-extrabold">
            {editingId ? "Edit product" : "Add a product"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            All prices are entered in cents.
          </p>
          <form className="mt-5 space-y-3" onSubmit={handleSubmit}>
            <Notice>{error}</Notice>
            <Notice kind="success">{notice}</Notice>
            <label className="field-label">
              Product name
              <input
                className="field-input"
                maxLength={160}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                required
                value={form.name}
              />
            </label>
            <label className="field-label">
              Category
              <input
                className="field-input"
                maxLength={80}
                onChange={(event) =>
                  setForm({ ...form, category: event.target.value })
                }
                required
                value={form.category}
              />
            </label>
            <label className="field-label">
              Description
              <textarea
                className="field-input min-h-20 resize-y"
                maxLength={2000}
                onChange={(event) =>
                  setForm({ ...form, description: event.target.value })
                }
                value={form.description}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="field-label">
                Price (cents)
                <input
                  className="field-input"
                  min="1"
                  onChange={(event) =>
                    setForm({ ...form, priceCents: event.target.value })
                  }
                  required
                  step="1"
                  type="number"
                  value={form.priceCents}
                />
              </label>
              <label className="field-label">
                Stock
                <input
                  className="field-input"
                  min="0"
                  onChange={(event) =>
                    setForm({ ...form, stock: event.target.value })
                  }
                  required
                  step="1"
                  type="number"
                  value={form.stock}
                />
              </label>
            </div>
            <label className="field-label">
              Image URL{" "}
              <span className="font-normal text-slate-400">(optional)</span>
              <input
                className="field-input"
                onChange={(event) =>
                  setForm({ ...form, imageUrl: event.target.value })
                }
                type="url"
                value={form.imageUrl}
              />
            </label>
            <div className="flex gap-2 pt-1">
              <button
                className="button-primary flex-1"
                disabled={saving}
                type="submit"
              >
                {saving
                  ? "Saving..."
                  : editingId
                    ? "Save changes"
                    : "Add product"}
              </button>
              {editingId && (
                <button
                  className="button-secondary"
                  onClick={resetForm}
                  type="button"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-extrabold">Your menu</h2>
          {loading ? (
            <Loading label="Loading your kitchen..." />
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-orange-200 bg-white px-6 py-14 text-center">
              <div className="text-5xl">🍳</div>
              <h3 className="mt-4 font-bold">
                Your menu is ready for its first dish
              </h3>
              <p className="mt-2 text-sm text-slate-500">
                Add a product using the form.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {products.map((product) => (
                <article
                  className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-100"
                  key={product._id}
                >
                  <ProductImage name={product.name} src={product.imageUrl} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-orange-600">
                          {product.category}
                        </p>
                        <h3 className="mt-1 font-bold">{product.name}</h3>
                      </div>
                      <span className="font-extrabold">
                        {formatPrice(product.priceCents)}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      Stock:{" "}
                      <strong className="text-slate-700">
                        {product.stock}
                      </strong>
                    </p>
                    <div className="mt-4 flex gap-2">
                      <button
                        className="button-secondary flex-1 !py-2"
                        onClick={() => startEditing(product)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-xl border border-red-200 px-3 py-2 text-sm font-bold text-red-600 hover:bg-red-50"
                        onClick={() => deleteProduct(product)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
