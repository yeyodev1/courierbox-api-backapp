import { describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";
import { errorHandler } from "./error";

vi.mock("../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

function fakeRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

const req: any = { path: "/api/v1/retiros-counter" };

describe("errorHandler", () => {
  it("honours an intentional 409 thrown by a service", () => {
    // Regression: services throw Object.assign(new Error(...), { status }).
    // These used to collapse into a generic 500, so the UI could not tell a
    // conflict from a server fault.
    const res = fakeRes();
    const err = Object.assign(new Error("Estos paquetes ya fueron retirados"), { status: 409 });

    errorHandler(err, req, res, vi.fn());

    expect(res.statusCode).toBe(409);
    expect(res.body.error).toContain("ya fueron retirados");
  });

  it("honours a 400 for bad client input", () => {
    const res = fakeRes();
    errorHandler(Object.assign(new Error("La firma es obligatoria"), { status: 400 }), req, res, vi.fn());
    expect(res.statusCode).toBe(400);
  });

  it("accepts statusCode as well as status", () => {
    const res = fakeRes();
    errorHandler(Object.assign(new Error("nope"), { statusCode: 404 }), req, res, vi.fn());
    expect(res.statusCode).toBe(404);
  });

  it("ignores a nonsensical status and falls back to 500", () => {
    const res = fakeRes();
    errorHandler(Object.assign(new Error("boom"), { status: 42 }), req, res, vi.fn());
    expect(res.statusCode).toBe(500);
  });

  it("still returns 500 for an unexpected error", () => {
    const res = fakeRes();
    errorHandler(new Error("kaboom"), req, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("internal_error");
  });

  it("keeps mapping Zod failures to 400", () => {
    const res = fakeRes();
    let zodError: ZodError;
    try {
      z.object({ a: z.string() }).parse({ a: 1 });
      throw new Error("should have thrown");
    } catch (e) {
      zodError = e as ZodError;
    }

    errorHandler(zodError!, req, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("invalid_input");
  });
});
