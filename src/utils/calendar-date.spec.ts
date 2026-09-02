import { describe, expect, it } from "vitest";
import { endOfCalendarDate, toCalendarDate, todayAsCalendarDate } from "./calendar-date";

/**
 * An expense filed on 28 Aug came back as 27 Aug. Day-precision fields have to
 * land on UTC midnight of the day the operator named, whatever hour it is here.
 */
describe("toCalendarDate", () => {
  it("keeps the day from a YYYY-MM-DD string", () => {
    expect(toCalendarDate("2026-08-28")?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  it("strips the clock off a full timestamp", () => {
    expect(toCalendarDate("2026-08-28T17:42:11.000Z")?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  it("normalises a Date the same way", () => {
    expect(toCalendarDate(new Date("2026-08-28T00:00:00.000Z"))?.toISOString()).toBe("2026-08-28T00:00:00.000Z");
  });

  it("leaves an absent optional field absent instead of defaulting to today", () => {
    expect(toCalendarDate(undefined)).toBeUndefined();
    expect(toCalendarDate(null)).toBeUndefined();
    expect(toCalendarDate("")).toBeUndefined();
  });

  it("rejects a value it cannot read", () => {
    expect(toCalendarDate("no es una fecha")).toBeUndefined();
  });
});

describe("todayAsCalendarDate", () => {
  it("still reads as today when it is already tomorrow in UTC", () => {
    // 20:00 on 28 Aug in Ecuador is 01:00 on 29 Aug UTC.
    expect(todayAsCalendarDate(new Date("2026-08-29T01:00:00.000Z")).toISOString())
      .toBe("2026-08-28T00:00:00.000Z");
  });

  it("rolls over at Ecuadorian midnight, not UTC midnight", () => {
    expect(todayAsCalendarDate(new Date("2026-08-29T05:00:00.000Z")).toISOString())
      .toBe("2026-08-29T00:00:00.000Z");
  });
});

describe("endOfCalendarDate", () => {
  it("closes the range on the same day it was asked for", () => {
    expect(endOfCalendarDate("2026-08-31")?.toISOString()).toBe("2026-08-31T23:59:59.999Z");
  });

  it("includes an expense filed on the last day of the range", () => {
    const last = toCalendarDate("2026-08-31")!;
    expect(last <= endOfCalendarDate("2026-08-31")!).toBe(true);
  });

  it("has no bound when no upper limit was given", () => {
    expect(endOfCalendarDate(undefined)).toBeUndefined();
  });
});
