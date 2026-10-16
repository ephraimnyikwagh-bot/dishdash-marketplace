import { createMockProvider } from "./mock.js";

describe("mock payment provider", () => {
  test("reconstructs a persisted intent after a process restart", async () => {
    const provider = createMockProvider();
    const result = await provider.simulate("mock_persisted_reference", "succeeded", {
      amountCents: 12500,
      currency: "NGN"
    });

    expect(result).toMatchObject({
      id: "mock_persisted_reference",
      amountCents: 12500,
      currency: "NGN",
      status: "succeeded"
    });
  });
});
