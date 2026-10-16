import { Router } from "express";
import { body, query, validationResult } from "express-validator";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import Dispute from "../models/Dispute.js";
import { DisputeError, createBuyerDispute, resolveDispute } from "../services/disputes.js";

const router = Router();

router.use(requireAuth);

router.post(
  "/",
  allowRoles("buyer"),
  [
    body("orderId").isMongoId().withMessage("A valid orderId is required"),
    body("reason")
      .isString()
      .trim()
      .isLength({ min: 5, max: 2000 })
      .withMessage("Reason must be between 5 and 2000 characters")
  ],
  async (request, response, next) => {
    const errors = validationResult(request);
    if (!errors.isEmpty()) {
      response.status(400).json({ errors: errors.array() });
      return;
    }
    try {
      const dispute = await createBuyerDispute({
        buyerId: request.auth.id,
        orderId: request.body.orderId,
        reason: request.body.reason
      });
      response.status(201).json({ dispute });
    } catch (error) {
      if (error instanceof DisputeError) {
        response.status(error.statusCode).json({ message: error.message });
        return;
      }
      next(error);
    }
  }
);

router.get(
  "/",
  allowRoles("buyer", "admin"),
  [query("page").optional().isInt({ min: 1 }), query("limit").optional().isInt({ min: 1, max: 100 })],
  async (request, response, next) => {
    const errors = validationResult(request);
    if (!errors.isEmpty()) {
      response.status(400).json({ errors: errors.array() });
      return;
    }
    const page = Number(request.query.page || 1);
    const limit = Number(request.query.limit || 20);
    const filter = request.auth.role === "admin" ? {} : { buyer: request.auth.id };
    try {
      const [disputes, total] = await Promise.all([
        Dispute.find(filter)
          .populate("buyer", "name email")
          .populate("order", "status totalCents createdAt")
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        Dispute.countDocuments(filter)
      ]);
      response.json({
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        disputes
      });
    } catch (error) {
      next(error);
    }
  }
);

router.patch(
  "/:disputeId",
  allowRoles("admin"),
  [body("status").isIn(["Under review", "Resolved", "Refunded"])],
  async (request, response, next) => {
    const errors = validationResult(request);
    if (!errors.isEmpty()) {
      response.status(400).json({ errors: errors.array() });
      return;
    }
    try {
      const result = await resolveDispute({
        disputeId: request.params.disputeId,
        action: request.body.status,
        adminId: request.auth.id
      });
      response.json({ dispute: result.dispute, duplicate: result.duplicate });
    } catch (error) {
      if (error instanceof DisputeError) {
        response.status(error.statusCode).json({ message: error.message });
        return;
      }
      next(error);
    }
  }
);

export default router;
