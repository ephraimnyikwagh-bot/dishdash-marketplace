import { useCallback, useEffect, useRef, useState } from "react";
import api, { getErrorMessage } from "../api.js";
import Loading from "../components/Loading.jsx";
import Notice from "../components/Notice.jsx";
import ProductImage from "../components/ProductImage.jsx";
import { formatPrice } from "../money.js";

const emptyForm = {
  name: "",
  category: "",
  description: "",
  priceCents: "",
  stock: "",
  imageUrl: ""
};

export default function VendorDashboardPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const imageInputRef = useRef(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/products/mine", {
        params: { page, limit: 30 }
      });
      setProducts(data.products || []);
      setTotalPages(Math.max(1, data.totalPages || 1));
    } catch (requestError) {
      setError(getErrorMessage(requestError, "Could not load your products."));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  function resetForm() {
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setForm(emptyForm);
    setImageFile(null);
    setImagePreview("");
    if (imageInputRef.current) imageInputRef.current.value = "";
    setEditingId("");
  }

  function startEditing(product) {
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    if (imageInputRef.current) imageInputRef.current.value = "";
    setEditingId(product._id);
    setImagePreview(product.imageUrl || "");
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

  function selectImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setError("Choose a JPG, PNG, or WebP image.");
      event.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be no larger than 2 MB.");
      event.target.value = "";
      return;
    }
    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setError("");
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const priceCents = Number(form.priceCents);
    const stock = Number(form.stock);
    if (!Number.isInteger(priceCents) || priceCents < 1) {
      setError("Enter a price of at least 1 kobo.");
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
    let productId = editingId;
    try {
      if (editingId) {
        await api.patch(`/products/${editingId}`, payload);
        setNotice("Product updated.");
      } else {
        const { data } = await api.post("/products", payload);
        productId = data.product._id;
        setEditingId(productId);
        setNotice("Product added to your menu.");
      }
      if (imageFile) {
        const upload = new FormData();
        upload.append("image", imageFile);
        await api.post(`/products/${productId}/image`, upload, {
          headers: { "Content-Type": "multipart/form-data" }
        });
      }
      resetForm();
      await loadProducts();
    } catch (requestError) {
      if (productId) await loadProducts();
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
          {products.length} shown
        </span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-100 sm:p-6">
          <h2 className="text-lg font-extrabold">
            {editingId ? "Edit product" : "Add a product"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Prices are entered in kobo (100 kobo = NGN 1.00).
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
                Price (kobo)
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
            <div className="space-y-3">
              <label className="field-label">
                Product image{" "}
                <span className="font-normal text-slate-400">(JPG, PNG, or WebP · max 2 MB)</span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="field-input file:mr-3 file:rounded-lg file:border-0 file:bg-orange-50 file:px-3 file:py-2 file:text-xs file:font-bold file:text-orange-800"
                  onChange={selectImage}
                  ref={imageInputRef}
                  type="file"
                />
              </label>
              <ProductImage
                name={form.name || "Product"}
                src={imagePreview || form.imageUrl}
              />
              <label className="field-label">
                Or use an image URL{" "}
                <span className="font-normal text-slate-400">(optional)</span>
              <input
                className="field-input"
                onChange={(event) => {
                  if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                  setImageFile(null);
                  if (imageInputRef.current) imageInputRef.current.value = "";
                  setImagePreview(event.target.value);
                  setForm({ ...form, imageUrl: event.target.value });
                }}
                type="url"
                value={form.imageUrl}
              />
              </label>
            </div>
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
            <>
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
            {totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-4">
                <button
                  className="button-secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => current - 1)}
                  type="button"
                >
                  Previous
                </button>
                <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
                <button
                  className="button-secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  Next
                </button>
              </div>
            )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
