import { jest } from "@jest/globals";
import { checkTransactionSupport } from "./database.js";

function mockConnection(helloResponse) {
  return {
    db: {
      admin: () => ({
        command: jest.fn().mockResolvedValue(helloResponse)
      })
    }
  };
}

describe("MongoDB transaction capability check", () => {
  test("detects a replica set", async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(
      checkTransactionSupport(mockConnection({ setName: "rs0" }), logger)
    ).resolves.toBe(true);
    expect(logger.info).toHaveBeenCalledWith(
      "MongoDB transaction support detected."
    );
  });

  test("warns when connected to a standalone server", async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };

    await expect(
      checkTransactionSupport(mockConnection({}), logger)
    ).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("does not support transactions")
    );
  });

  test("warns when transaction capability cannot be verified", async () => {
    const logger = { info: jest.fn(), warn: jest.fn() };
    const connection = {
      db: {
        admin: () => ({
          command: jest.fn().mockRejectedValue(new Error("command failed"))
        })
      }
    };

    await expect(checkTransactionSupport(connection, logger)).resolves.toBe(
      false
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("transaction support could not be verified"),
      { name: "Error", code: "UNKNOWN" }
    );
  });
});
