import { describe, expect, it } from "vitest";
import { extractJsonBlob } from "./pageExtract";

const ANCHOR = /var ytInitialPlayerResponse\s*=\s*/;

describe("extractJsonBlob", () => {
  it("should extract a simple assigned object", () => {
    const html = `<script>var ytInitialPlayerResponse = {"a": 1};</script>`;
    expect(extractJsonBlob(html, ANCHOR)).toBe(`{"a": 1}`);
  });

  it("should extract an object whose strings contain \"};</script>\"", () => {
    const blob = `{"description": "code sample: };</script> and };var x", "n": 2}`;
    const html = `<script>var ytInitialPlayerResponse = ${blob};var meta = {};</script>`;
    expect(extractJsonBlob(html, ANCHOR)).toBe(blob);
  });

  it("should extract nested objects and arrays with escaped quotes", () => {
    const blob = `{"a": {"b": [1, {"c": "say \\"hi\\" {or not}"}]}, "d": "\\\\"}`;
    const html = `junk var ytInitialPlayerResponse = ${blob}; more junk }}}`;
    expect(extractJsonBlob(html, ANCHOR)).toBe(blob);
  });

  it("should extract when the blob is followed by arbitrary script text", () => {
    const blob = `{"ok": true}`;
    const html = `var ytInitialPlayerResponse = ${blob};if (window) { doThings({}); }`;
    expect(extractJsonBlob(html, ANCHOR)).toBe(blob);
  });

  it("should return null when braces never balance", () => {
    const html = `var ytInitialPlayerResponse = {"a": {"b": 1}`;
    expect(extractJsonBlob(html, ANCHOR)).toBeNull();
  });

  it("should return null when the anchor is absent", () => {
    expect(extractJsonBlob(`<html>{"a":1}</html>`, ANCHOR)).toBeNull();
  });

  it("should return null when no object follows the anchor", () => {
    expect(extractJsonBlob(`var ytInitialPlayerResponse = null;`, ANCHOR)).toBeNull();
  });
});
