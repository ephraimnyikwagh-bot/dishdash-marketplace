import { Router } from "express";
import { allowRoles, requireAuth } from "../middleware/auth.js";
import LedgerEntry from "../models/LedgerEntry.js";

const router = Router();

router.get(
  "/integrity",
  requireAuth,
  allowRoles("admin"),
  async (_request, response, next) => {
    try {
      const totals = await LedgerEntry.aggregate([
        {
          $group: {
            _id: "$currency",
            debitsCents: {
              $sum: {
                $cond: [
                  { $eq: ["$direction", "debit"] },
                  "$amountCents",
                  0
                ]
              }
            },
            creditsCents: {
              $sum: {
                $cond: [
                  { $eq: ["$direction", "credit"] },
                  "$amountCents",
                  0
                ]
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]);
      const currencies = totals.map((row) => ({
        currency: row._id,
        debitsCents: row.debitsCents,
        creditsCents: row.creditsCents,
        balanced: row.debitsCents === row.creditsCents
      }));
      response.json({
        balanced: currencies.every((currency) => currency.balanced),
        currencies
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
