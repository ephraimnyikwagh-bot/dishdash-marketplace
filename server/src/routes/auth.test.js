import request from "supertest";
import app from "../app.js";

describe("authentication registration validation", () => {
  beforeAll(() => {
    process.env.ADMIN_REGISTRATION_KEY =
      "test-admin-registration-key-long-enough";
  });

  test("rejects unsupported registration roles", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Test User",
      email: "test@example.com",
      password: "correct-horse-battery-staple",
      role: "owner"
    });

    expect(response.status).toBe(400);
  });

  test("requires the registration key for admin accounts", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Test Admin",
      email: "admin@example.com",
      password: "correct-horse-battery-staple",
      role: "admin",
      adminRegistrationKey: "incorrect-key"
    });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Admin registration is not authorized");
  });

  test("does not allow admin registration when the key is omitted", async () => {
    const response = await request(app).post("/api/auth/register").send({
      name: "Unkeyed Admin",
      email: "unkeyed-admin@example.com",
      password: "correct-horse-battery-staple",
      role: "admin"
    });

    expect(response.status).toBe(403);
    expect(response.body.message).toBe("Admin registration is not authorized");
  });
});
