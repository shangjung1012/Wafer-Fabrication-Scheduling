import { describe, it, expect, vi, afterEach } from "vitest";
import { importOrdersFromCsv } from "@/components/orders/order-csv";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importOrdersFromCsv", () => {
  it("returns successCount and errorList on a successful import", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ successCount: 3, errorList: ["row 2: bad type"] }),
      }),
    );
    const file = new File(["name,type"], "orders.csv", { type: "text/csv" });
    const result = await importOrdersFromCsv(file);
    expect(result.successCount).toBe(3);
    expect(result.errorList).toEqual(["row 2: bad type"]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/orders/import",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("defaults successCount to 0 and errorList to [] when body fields are missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      }),
    );
    const file = new File([""], "empty.csv", { type: "text/csv" });
    const result = await importOrdersFromCsv(file);
    expect(result.successCount).toBe(0);
    expect(result.errorList).toEqual([]);
  });

  it("throws an Error with the server message when response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: () => Promise.resolve({ message: "Invalid CSV format" }),
      }),
    );
    const file = new File(["bad"], "bad.csv", { type: "text/csv" });
    await expect(importOrdersFromCsv(file)).rejects.toThrow(
      "Invalid CSV format",
    );
  });

  it("throws a generic error with status code when response is not ok and body has no message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    );
    const file = new File([""], "f.csv", { type: "text/csv" });
    await expect(importOrdersFromCsv(file)).rejects.toThrow(
      "Import failed (500)",
    );
  });

  it("handles a JSON parse error on error response gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not json")),
      }),
    );
    const file = new File([""], "f.csv", { type: "text/csv" });
    await expect(importOrdersFromCsv(file)).rejects.toThrow(
      "Import failed (502)",
    );
  });
});
