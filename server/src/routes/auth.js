import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { body, validationResult } from "express-validator";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";
import User from "../models/User.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
const roles = ["buyer", "vendor", "courier", "admin"];

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many authentication attempts. Try again later." }
});

const registrationValidation = [
  body("name")
    .isString()
    .withMessage("Name is required")
    .trim()
    .isLength({ min: 1, max: 120 })
    .withMessage("Name must be between 1 and 120 characters")
    .escape(),
  body("email")
    .isEmail()
    .withMessage("A valid email is required")
    .normalizeEmail(),
  body("password")
    .isString()
    .withMessage("Password is required")
    .isLength({ min: 8, max: 128 })
    .withMessage("Password must be between 8 and 128 characters")
    .custom((value) => Buffer.byteLength(value, "utf8") <= 72)
    .withMessage("Password must be at most 72 bytes when UTF-8 encoded"),
  body("role")
    .optional()
    .isIn(roles)
    .withMessage("Role must be buyer, vendor, courier, or admin")
];

function sendValidationErrors(request, response) {
  const errors = validationResult(request);
  if (!errors.isEmpty()) {
    response
      .status(400)
      .json({ errors: errors.array({ onlyFirstError: true }) });
    return true;
  }
  return false;
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be configured with at least 32 characters"
    );
  }
  return secret;
}

function issueToken(user) {
  return jwt.sign({ role: user.role }, getJwtSecret(), {
    subject: user.id,
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    issuer: "food-marketplace-api",
    audience: "food-marketplace"
  });
}

function isAdminRegistrationAuthorized(providedKey) {
  const configuredKey = process.env.ADMIN_REGISTRATION_KEY;
  if (
    typeof configuredKey !== "string" ||
    typeof providedKey !== "string" ||
    !configuredKey ||
    !providedKey
  ) {
    return false;
  }
  const configuredBuffer = Buffer.from(configuredKey);
  const providedBuffer = Buffer.from(providedKey);
  return (
    configuredBuffer.length === providedBuffer.length &&
    timingSafeEqual(configuredBuffer, providedBuffer)
  );
}

router.post(
  "/register",
  authLimiter,
  registrationValidation,
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;

    const role = request.body.role || "buyer";
    if (
      role === "admin" &&
      !isAdminRegistrationAuthorized(request.body.adminRegistrationKey)
    ) {
      response
        .status(403)
        .json({ message: "Admin registration is not authorized" });
      return;
    }

    try {
      const existingUser = await User.exists({ email: request.body.email });
      if (existingUser) {
        response.status(409).json({ message: "Email is already registered" });
        return;
      }

      const passwordHash = await bcrypt.hash(request.body.password, 12);
      const user = await User.create({
        name: request.body.name,
        email: request.body.email,
        passwordHash,
        role
      });

      response.status(201).json({
        token: issueToken(user),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      if (error.code === 11000) {
        response.status(409).json({ message: "Email is already registered" });
        return;
      }
      next(error);
    }
  }
);

router.post(
  "/login",
  authLimiter,
  [
    body("email")
      .isEmail()
      .withMessage("A valid email is required")
      .normalizeEmail(),
    body("password")
      .isString()
      .withMessage("Password is required")
      .isLength({ min: 1, max: 128 })
      .withMessage("Password is invalid")
  ],
  async (request, response, next) => {
    if (sendValidationErrors(request, response)) return;

    try {
      const user = await User.findOne({ email: request.body.email }).select(
        "+passwordHash"
      );
      if (
        !user ||
        !user.isActive ||
        !(await bcrypt.compare(request.body.password, user.passwordHash))
      ) {
        response.status(401).json({ message: "Invalid email or password" });
        return;
      }

      response.json({
        token: issueToken(user),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/me", requireAuth, async (request, response, next) => {
  try {
    const user = await User.findById(request.auth.id).select(
      "name email role isActive"
    );
    if (!user || !user.isActive) {
      response.status(401).json({ message: "Account is unavailable" });
      return;
    }

    response.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
