import { expect, test } from "bun:test";
import { matches } from "./search";

test("every word has to match, and tags count", () => {
  const hay = "reddit r/breadit sourdough schedule #recipes";
  expect(matches("", hay)).toBe(true);
  expect(matches("SOURDOUGH schedule", hay)).toBe(true);
  expect(matches("sourdough pizza", hay)).toBe(false);
  expect(matches("#recipes", hay)).toBe(true);
});
