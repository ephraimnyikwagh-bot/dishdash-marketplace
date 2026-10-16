import { Router } from "express";
import { body, query, validationResult } from "express-validator";
import multer from "multer";
import mongoose from "mongoose";
import Product, { listingCategories, listingConditions, nigerianStates } from "../models/Product.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import { storeProductImage, validateImageBuffer } from "../services/imageStorage.js";

const router = Router();
const maxImageBytes = 2 * 1024 * 1024;
const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxImageBytes, files: 5 },
  fileFilter(_request, file, callback) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      callback(Object.assign(new Error("Image must be a JPG, PNG, or WebP file"), {
        statusCode: 400
      }));
      return;
    }
    callback(null, true);
  }
});

function handleImageUpload(request, response, next) {
  uploadImage.single("image")(request, response, (error) => {
    if (!error) {
      next();
      return;
    }
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ message: "Image must be no larger than 2 MB" });
      return;
    }
    if (error.statusCode === 400) {
      response.status(400).json({ message: error.message });
      return;
    }
    next(error);
  });
}

const productValidation = [
  body().custom((value) => value.priceCents != null || value.price != null)
    .withMessage("A price is required"),
  body().custom((value) => value.quantity != null || value.stock != null)
    .withMessage("A quantity is required"),
  body().custom((value) => {
    const title = value.title ?? value.name;
    return typeof title === "string" && title.trim().length > 0 && title.trim().length <= 160;
  }).withMessage("Title must be between 1 and 160 characters"),
  body("category")
    .isString()
    .isIn(listingCategories)
    .withMessage("Choose a supported listing category"),
  body("description")
    .optional({ values: "falsy" })
    .isString()
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Description is too long"),
  body("imageUrl")
    .optional({ values: "falsy" })
    .isURL({ protocols: ["http", "https"], require_protocol: true })
    .withMessage("Image URL must be valid"),
  body("priceCents")
    .optional()
    .isInt({ min: 1, max: 10000000000 })
    .withMessage("Price must be a positive integer in kobo"),
  body("price")
    .optional()
    .isFloat({ min: 0.01, max: 100000000 })
    .withMessage("Price must be a positive amount in naira"),
  body("stock")
    .optional()
    .isInt({ min: 0, max: 999999 })
    .withMessage("Quantity must be a whole number from 0 to 999999"),
  body("quantity")
    .optional()
    .isInt({ min: 0, max: 999999 })
    .withMessage("Quantity must be a whole number from 0 to 999999"),
  body("condition").isIn(listingConditions),
  body("location").isObject().withMessage("A Nigerian state and city are required"),
  body("location.state").isIn(nigerianStates).withMessage("Choose a Nigerian state"),
  body("location.city").isString().trim().isLength({ min: 1, max: 100 }),
  body("images").optional().isArray({ max: 5 }).withMessage("A listing can have up to 5 images"),
  body("images.*")
    .optional()
    .isURL({ protocols: ["http", "https"], require_protocol: true })
    .withMessage("Image URLs must be valid")
];

function productData(body) {
  const data = {
    name: body.title ?? body.name,
    title: body.title ?? body.name,
    description: body.description || "",
    priceCents: body.priceCents ?? Math.round(Number(body.price) * 100),
    stock: body.quantity ?? body.stock,
    quantity: body.quantity ?? body.stock,
    category: body.category,
    condition: body.condition || "Used",
    location: {
      state: body.location?.state || "Lagos",
      city: body.location?.city || "Lagos"
    }
  };
  if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
  if (Array.isArray(body.images)) data.images = body.images;
  return data;
}

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
      .withMessage("Search term is too long"),
    query("category")
      .optional()
      .isString()
      .isIn(listingCategories),
    query("condition").optional().isIn(listingConditions),
    query("state").optional().isIn(nigerianStates),
    query("city").optional().isString().trim().isLength({ max: 100 }),
    query("minPrice").optional().isFloat({ min: 0 }),
    query("maxPrice").optional().isFloat({ min: 0 }),
    query("sort").optional().isIn(["newest", "price_asc", "price_desc"])
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
        filters.$or = ["name", "description"].map((field) => ({
          [field]: { $regex: escapeForRegex(search), $options: "i" }
        }));
      }

      if (category) {
        filters.category = category;
      }
      if (request.query.condition) filters.condition = request.query.condition;
      if (request.query.state) filters["location.state"] = request.query.state;
      if (request.query.city) filters["location.city"] = new RegExp(`^${escapeForRegex(String(request.query.city))}$`, "i");
      if (request.query.minPrice != null || request.query.maxPrice != null) {
        filters.priceCents = {};
        if (request.query.minPrice != null) filters.priceCents.$gte = Math.round(Number(request.query.minPrice) * 100);
        if (request.query.maxPrice != null) filters.priceCents.$lte = Math.round(Number(request.query.maxPrice) * 100);
      }
      const sort = request.query.sort === "price_asc"
        ? { priceCents: 1, _id: 1 }
        : request.query.sort === "price_desc"
          ? { priceCents: -1, _id: -1 }
          : { createdAt: -1, _id: -1 };

      const [items, total] = await Promise.all([
        Product.find(filters)
          .populate("vendor", "name email role")
          .sort(sort)
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

router.post(
  "/:productId/image",
  requireAuth,
  allowRoles("vendor"),
  handleImageUpload,
  async (request, response, next) => {
    if (!mongoose.isValidObjectId(request.params.productId)) {
      response.status(400).json({ message: "Invalid product ID" });
      return;
    }
    if (!request.file) {
      response.status(400).json({ message: "Choose an image to upload" });
      return;
    }
    if (!validateImageBuffer(request.file.buffer, request.file.mimetype)) {
      response.status(400).json({ message: "File contents must be a valid JPG, PNG, or WebP image" });
      return;
    }
    try {
      const product = await Product.findOne({
        _id: request.params.productId,
        vendor: request.auth.id,
        isActive: true
      });
      if (!product) {
        response.status(404).json({ message: "Product not found" });
        return;
      }
      product.imageUrl = await storeProductImage({
        buffer: request.file.buffer,
        mimetype: request.file.mimetype,
        productId: product.id
      });
      product.images = [product.imageUrl];
      await product.save();
      response.json({ product });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  "/mine",
  requireAuth,
  allowRoles("vendor"),
  [
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 })
  ],
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 50);
    try {
      const filter = { vendor: request.auth.id, isActive: true };
      const [products, total] = await Promise.all([
        Product.find(filter)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Product.countDocuments(filter)
      ]);
      response.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        products
      });
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
        ...productData(request.body),
        vendor: request.auth.id
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
          $set: productData(request.body)
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

router.post(
  "/:productId/images",
  requireAuth,
  allowRoles("vendor"),
  (request, response, next) => {
    uploadImage.array("images", 5)(request, response, (error) => {
      if (!error) return next();
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
        response.status(413).json({ message: "Each image must be no larger than 2 MB" });
        return;
      }
      if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_COUNT") {
        response.status(400).json({ message: "A listing can have at most 5 images" });
        return;
      }
      if (error.statusCode === 400) {
        response.status(400).json({ message: error.message });
        return;
      }
      next(error);
    });
  },
  async (request, response, next) => {
    if (!mongoose.isValidObjectId(request.params.productId)) {
      response.status(400).json({ message: "Invalid listing ID" });
      return;
    }
    if (!request.files?.length || request.files.length > 5) {
      response.status(400).json({ message: "Choose between 1 and 5 images" });
      return;
    }
    try {
      const product = await Product.findOne({
        _id: request.params.productId,
        vendor: request.auth.id,
        isActive: true
      });
      if (!product) {
        response.status(404).json({ message: "Listing not found" });
        return;
      }
      const images = [];
      for (const [index, file] of request.files.entries()) {
        if (!validateImageBuffer(file.buffer, file.mimetype)) {
          response.status(400).json({ message: "Image contents must be valid JPG, PNG, or WebP files" });
          return;
        }
        images.push(await storeProductImage({
          buffer: file.buffer,
          mimetype: file.mimetype,
          productId: product.id,
          key: `listing-${product.id}-${Date.now()}-${index}`
        }));
      }
      product.images = images;
      product.imageUrl = images[0] || "";
      await product.save();
      response.json({ product });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
