import { Router } from "express";
import { body, validationResult } from "express-validator";
import Cart from "../models/Cart.js";
import Product from "../models/Product.js";
import { allowRoles, requireAuth } from "../middleware/auth.js";

const router = Router();

const cartItemValidation = [
  body("productId")
    .notEmpty()
    .withMessage("Product ID is required"),
  body("quantity")
    .isInt({ min: 1, max: 99 })
    .withMessage("Quantity must be between 1 and 99")
];

function sendValidationErrors(request, response) {
  const errors = validationResult(request);
  if (!errors.isEmpty()) {
    response.status(400).json({ errors: errors.array({ onlyFirstError: true }) });
    return true;
  }
  return false;
}

function calculateCartTotals(items) {
  return items.reduce(
    (total, item) => total + item.quantity * (item.product?.priceCents ?? 0),
    0
  );
}

router.get(
  "/",
  requireAuth,
  allowRoles("buyer"),
  async (request, response, next) => {
    try {
      const cart = await Cart.findOne({ buyer: request.auth.id }).populate({
        path: "items.product",
        select: "name priceCents imageUrl category stock vendor"
      });

      if (!cart) {
        response.json({ buyer: request.auth.id, items: [], totalCents: 0 });
        return;
      }

      const totalCents = calculateCartTotals(cart.items);
      response.json({ buyer: request.auth.id, items: cart.items, totalCents });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/items",
  requireAuth,
  allowRoles("buyer"),
  cartItemValidation,
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;

    try {
      const { productId, quantity } = request.body;
      const product = await Product.findOne({ _id: productId, isActive: true });

      if (!product) {
        response.status(404).json({ message: "Product not found" });
        return;
      }

      if (product.stock < quantity) {
        response.status(409).json({ message: "Not enough stock available" });
        return;
      }

      let cart = await Cart.findOne({ buyer: request.auth.id });
      if (!cart) {
        cart = new Cart({ buyer: request.auth.id, items: [] });
      }

      const itemIndex = cart.items.findIndex(
        (item) => item.product.toString() === productId
      );

      if (itemIndex >= 0) {
        cart.items[itemIndex].quantity += quantity;
      } else {
        cart.items.push({ product: productId, quantity });
      }

      await cart.save();
      const updatedCart = await Cart.findOne({ buyer: request.auth.id }).populate({
        path: "items.product",
        select: "name priceCents imageUrl category stock vendor"
      });

      response.status(201).json({
        buyer: request.auth.id,
        item: updatedCart.items.find(
          (item) => item.product && item.product._id.toString() === productId
        ),
        totalCents: calculateCartTotals(updatedCart.items),
        items: updatedCart.items
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/items/:productId",
  requireAuth,
  allowRoles("buyer"),
  [
    body("quantity")
      .isInt({ min: 1, max: 99 })
      .withMessage("Quantity must be between 1 and 99")
  ],
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;

    try {
      const cart = await Cart.findOne({ buyer: request.auth.id });
      if (!cart) {
        response.status(404).json({ message: "Cart not found" });
        return;
      }

      const itemIndex = cart.items.findIndex(
        (item) => item.product.toString() === request.params.productId
      );

      if (itemIndex === -1) {
        response.status(404).json({ message: "Cart item not found" });
        return;
      }

      const product = await Product.findById(request.params.productId);
      if (!product || !product.isActive) {
        response.status(404).json({ message: "Product not found" });
        return;
      }

      if (product.stock < request.body.quantity) {
        response.status(409).json({ message: "Not enough stock available" });
        return;
      }

      cart.items[itemIndex].quantity = request.body.quantity;
      await cart.save();

      const updatedCart = await Cart.findOne({ buyer: request.auth.id }).populate({
        path: "items.product",
        select: "name priceCents imageUrl category stock vendor"
      });

      response.json({
        buyer: request.auth.id,
        items: updatedCart.items,
        totalCents: calculateCartTotals(updatedCart.items)
      });
    } catch (error) {
      next(error);
    }
  }
);

router.delete(
  "/items/:productId",
  requireAuth,
  allowRoles("buyer"),
  async (request, response, next) => {
    try {
      const cart = await Cart.findOne({ buyer: request.auth.id });
      if (!cart) {
        response.status(404).json({ message: "Cart not found" });
        return;
      }

      const initialLength = cart.items.length;
      cart.items = cart.items.filter(
        (item) => item.product.toString() !== request.params.productId
      );

      if (cart.items.length === initialLength) {
        response.status(404).json({ message: "Cart item not found" });
        return;
      }

      await cart.save();

      const updatedCart = await Cart.findOne({ buyer: request.auth.id }).populate({
        path: "items.product",
        select: "name priceCents imageUrl category stock vendor"
      });

      response.json({
        buyer: request.auth.id,
        items: updatedCart.items,
        totalCents: calculateCartTotals(updatedCart.items)
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
