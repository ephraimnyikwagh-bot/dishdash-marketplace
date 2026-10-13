import { Router } from "express";
import { body, query, validationResult } from "express-validator";
import Product from "../models/Product.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

const productValidation = [
  body("name")
    .isString()
    .trim()
    .isLength({ min: 1, max: 160 })
    .withMessage("Name must be between 1 and 160 characters"),
  body("category")
    .isString()
    .trim()
    .isLength({ min: 1, max: 80 })
    .withMessage("Category is required"),
  body("description")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Description is too long"),
  body("imageUrl")
    .optional({ values: "falsy" })
    .isURL()
    .withMessage("Image URL must be valid"),
  body("priceCents")
    .isInt({ min: 1 })
    .withMessage("Price must be a positive integer in cents"),
  body("stock")
    .isInt({ min: 0 })
    .withMessage("Stock must be a non-negative integer")
];

function sendValidationErrors(request, response) {
  const errors = validationResult(request);
  if (!errors.isEmpty()) {
    response.status(400).json({ errors: errors.array({ onlyFirstError: true }) });
    return true;
  }
  return false;
}

function escapeForRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get(
  "/",
  requireAuth,
  allowRoles("buyer", "vendor", "courier", "admin"),
  [
    query("page").optional().isInt({ min: 1 }).withMessage("Page must be >= 1"),
    query("limit")
      .optional()
      .isInt({ min: 1, max: 50 })
      .withMessage("Limit must be between 1 and 50"),
    query("q")
      .optional()
      .isString()
      .trim()
      .isLength({ max: 120 })
      .withMessage("Search term is too long")
  ],
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;

    try {
      const page = Number(request.query.page ?? 1);
      const limit = Number(request.query.limit ?? 12);
      const search = String(request.query.q ?? "").trim();
      const category = String(request.query.category ?? "").trim();
      const filters = { isActive: true };

      if (search) {
        filters.name = { $regex: escapeForRegex(search), $options: "i" };
      }

      if (category) {
        filters.category = { $regex: `^${escapeForRegex(category)}$`, $options: "i" };
      }

      const [items, total] = await Promise.all([
        Product.find(filters)
          .populate("vendor", "name email role")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Product.countDocuments(filters)
      ]);

      response.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        items
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/mine",
  requireAuth,
  allowRoles("vendor"),
  async (_request, response, next) => {
    try {
      const products = await Product.find({ vendor: _request.auth.id, isActive: true })
        .sort({ createdAt: -1 })
        .lean();

      response.json({ products });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/:productId",
  requireAuth,
  allowRoles("buyer", "vendor", "courier", "admin"),
  async (request, response, next) => {
    try {
      const product = await Product.findOne({
        _id: request.params.productId,
        isActive: true
      }).populate("vendor", "name email role");

      if (!product) {
        response.status(404).json({ message: "Product not found" });
        return;
      }

      response.json({ product });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/",
  requireAuth,
  allowRoles("vendor"),
  productValidation,
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;

    try {
      const product = await Product.create({
        vendor: request.auth.id,
        name: request.body.name,
        description: request.body.description || "",
        priceCents: request.body.priceCents,
        stock: request.body.stock,
        imageUrl: request.body.imageUrl || "",
        category: request.body.category
      });

      response.status(201).json({ product });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:productId",
  requireAuth,
  allowRoles("vendor"),
  productValidation,
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;

    try {
      const product = await Product.findOneAndUpdate(
        { _id: request.params.productId, vendor: request.auth.id, isActive: true },
        {
          $set: {
            name: request.body.name,
            description: request.body.description || "",
            priceCents: request.body.priceCents,
            stock: request.body.stock,
            imageUrl: request.body.imageUrl || "",
            category: request.body.category
          }
        },
        { new: true }
      );

      if (!product) {
        response.status(404).json({ message: "Product not found" });
        return;
      }

      response.json({ product });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/:productId",
  requireAuth,
  allowRoles("vendor"),
  async (request, response, next) => {
    try {
      const product = await Product.findOneAndUpdate(
        { _id: request.params.productId, vendor: request.auth.id, isActive: true },
        { isActive: false },
        { new: true }
      );

      if (!product) {
        response.status(404).json({ message: "Product not found" });
        return;
      }

      response.json({ message: "Product removed", product });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
