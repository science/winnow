import { describe, it, expect } from "vitest";
import {
  parseDurationText,
  formatDuration,
  parseViewCountText,
  approxAgeMs,
} from "./format";

describe("parseDurationText", () => {
  it("should parse mm:ss", () => {
    expect(parseDurationText("12:34")).toBe(12 * 60 + 34);
    expect(parseDurationText("0:59")).toBe(59);
  });

  it("should parse h:mm:ss", () => {
    expect(parseDurationText("1:02:03")).toBe(3723);
  });

  it("should return null for garbage or empty input", () => {
    expect(parseDurationText("")).toBeNull();
    expect(parseDurationText("LIVE")).toBeNull();
    expect(parseDurationText("12:34:56:78")).toBeNull();
  });
});

describe("formatDuration", () => {
  it("should format seconds as mm:ss and h:mm:ss", () => {
    expect(formatDuration(754)).toBe("12:34");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(59)).toBe("0:59");
  });
});

describe("parseViewCountText", () => {
  it("should parse plain counts with separators and suffix words", () => {
    expect(parseViewCountText("123,456 views")).toBe(123456);
    expect(parseViewCountText("1,024 watching")).toBe(1024);
  });

  it("should parse compact K/M/B forms", () => {
    expect(parseViewCountText("2.1M views")).toBe(2_100_000);
    expect(parseViewCountText("2.1M")).toBe(2_100_000);
    expect(parseViewCountText("15K views")).toBe(15_000);
    expect(parseViewCountText("1B views")).toBe(1_000_000_000);
  });

  it("should return null for unparseable input", () => {
    expect(parseViewCountText("No views")).toBe(0);
    expect(parseViewCountText("")).toBeNull();
    expect(parseViewCountText("watching now")).toBeNull();
  });
});

describe("approxAgeMs", () => {
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  it("should parse long-form relative ages", () => {
    expect(approxAgeMs("3 days ago")).toBe(3 * DAY);
    expect(approxAgeMs("2 weeks ago")).toBe(14 * DAY);
    expect(approxAgeMs("1 month ago")).toBe(30 * DAY);
    expect(approxAgeMs("1 year ago")).toBe(365 * DAY);
    expect(approxAgeMs("5 hours ago")).toBe(5 * HOUR);
    expect(approxAgeMs("47 minutes ago")).toBe(47 * 60_000);
  });

  it("should parse compact relative ages as served by lockup metadata", () => {
    expect(approxAgeMs("3w ago")).toBe(21 * DAY);
    expect(approxAgeMs("2d ago")).toBe(2 * DAY);
    expect(approxAgeMs("10h ago")).toBe(10 * HOUR);
    expect(approxAgeMs("36m ago")).toBe(36 * 60_000);
    expect(approxAgeMs("1mo ago")).toBe(30 * DAY);
    expect(approxAgeMs("5y ago")).toBe(5 * 365 * DAY);
  });

  it("should handle 'Streamed'/'Premiered' prefixes", () => {
    expect(approxAgeMs("Streamed 2 days ago")).toBe(2 * DAY);
    expect(approxAgeMs("Premiered 3 hours ago")).toBe(3 * HOUR);
  });

  it("should return null for unknown formats", () => {
    expect(approxAgeMs("")).toBeNull();
    expect(approxAgeMs("yesterday")).toBeNull();
  });
});
