import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { allowRoles, requireAuth } from "./auth.js";

const secret = "test-secret-with-at-least-thirty-two-characters";
process.env.JWT_SECRET = secret;

function createProtectedApp(...roles) {
  const app = express();
  app.get(
    "/protected",
    requireAuth,
    allowRoles(...roles),
    (request, response) => response.json({ auth: request.auth })
  );
  return app;
}

function createToken(role = "buyer") {
  return jwt.sign({ role }, secret, {
    subject: "user-123",
    issuer: "food-marketplace-api",
    audience: "food-marketplace"
  });
}

describe("authentication and role authorization middleware", () => {
  test("requires a bearer token", async () => {
    const response = await request(createProtectedApp("buyer")).get(
      "/protected"
    );

    expect(response.status).toBe(401);
    expect(response.body.message).toBe("Authentication required");
  });

  test("rejects invalid tokens", async () => {
    const response = await request(createProtectedApp("buyer"))
      .get("/protected")
      .set("Authorization", "Bearer invalid-token");

    expect(response.status).toBe(401);
  });

  test("rejects a valid token with a role not permitted by the route", async () => {
    const response = await request(createProtectedApp("vendor"))
      .get("/protected")
      .set("Authorization", `Bearer ${createToken("buyer")}`);

    expect(response.status).toBe(403);
  });

  test("passes the verified identity to an authorized route", async () => {
    const response = await request(createProtectedApp("buyer"))
      .get("/protected")
      .set("Authorization", `Bearer ${createToken("buyer")}`);

    expect(response.status).toBe(200);
    expect(response.body.auth).toEqual({ id: "user-123", role: "buyer" });
  });
});
