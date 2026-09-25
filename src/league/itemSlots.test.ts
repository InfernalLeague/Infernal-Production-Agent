import assert from "node:assert/strict";
import test from "node:test";
import { toItemSlots } from "./itemSlots.js";

test("itemy jdou na své sloty, prázdný slot je 0", () => {
  // ADC z hry 25. 9. 2026: pátý slot prázdný, boty v quest slotu.
  assert.deepEqual(
    toItemSlots([
      { id: 3036, slot: 0 },
      { id: 3032, slot: 1 },
      { id: 3031, slot: 2 },
      { id: 3085, slot: 3 },
      { id: 3072, slot: 4 },
      { id: 3363, slot: 6 },
      { id: 2001, slot: 7 },
      { id: 3006, slot: 8 },
    ]),
    [3036, 3032, 3031, 3085, 3072, 0, 3363, 2001, 3006],
  );
});

test("prázdné, spotřebované a mimo rozsah se ignorují", () => {
  assert.deepEqual(
    toItemSlots([
      { id: 0, slot: 0 },
      { id: 2003, slot: 1, count: 0 },
      { id: 1055, slot: 12 },
      { id: 1055, slot: 2 },
    ]),
    [0, 0, 1055, 0, 0, 0, 0, 0, 0],
  );
});
