const { computeOverlay, saveDirty, manualDirty } = require("../popupLogic.js");

describe("computeOverlay — the auto-fill overlay + safety rule", () => {
  const stored = { status: "New", tag: "cold-list" };

  test("overlays a remembered value that is non-empty and differs from stored", () => {
    const r = computeOverlay(stored, { status: "In Communication (Active)", tag: "warm-intro" }, true);
    expect(r.fields).toEqual({ status: "In Communication (Active)", tag: "warm-intro" });
    expect(r.overlaid).toEqual({ status: true, tag: true });
  });

  test("does NOT overlay a remembered value equal to the stored value (nothing to carry)", () => {
    const r = computeOverlay(stored, { status: "New", tag: "warm-intro" }, true);
    expect(r.fields).toEqual({ status: "New", tag: "warm-intro" });
    expect(r.overlaid).toEqual({ status: false, tag: true });
  });

  test("never overlays an EMPTY remembered value (no silent blanking of tag/status)", () => {
    const r = computeOverlay(stored, { status: "", tag: "" }, true);
    expect(r.fields).toEqual({ status: "New", tag: "cold-list" });
    expect(r.overlaid).toEqual({ status: false, tag: false });
  });

  test("overlays only the field that qualifies (status remembered, tag empty)", () => {
    const r = computeOverlay(stored, { status: "Accepted", tag: "" }, true);
    expect(r.fields).toEqual({ status: "Accepted", tag: "cold-list" });
    expect(r.overlaid).toEqual({ status: true, tag: false });
  });

  test("when disabled, never overlays even if values differ", () => {
    const r = computeOverlay(stored, { status: "Accepted", tag: "warm-intro" }, false);
    expect(r.fields).toEqual({ status: "New", tag: "cold-list" });
    expect(r.overlaid).toEqual({ status: false, tag: false });
  });

  test("overlay onto a contact with NO stored values fills from the remembered ones", () => {
    const r = computeOverlay({ status: "", tag: "" }, { status: "Provisional", tag: "event-x" }, true);
    expect(r.fields).toEqual({ status: "Provisional", tag: "event-x" });
    expect(r.overlaid).toEqual({ status: true, tag: true });
  });

  test("tolerates missing/undefined inputs (treated as empty strings)", () => {
    const r = computeOverlay(undefined, undefined, true);
    expect(r.fields).toEqual({ status: "", tag: "" });
    expect(r.overlaid).toEqual({ status: false, tag: false });
  });
});

describe("saveDirty — fields vs the contact's real stored values (controls Save)", () => {
  test("false when fields equal the loaded baseline", () => {
    expect(saveDirty({ status: "New", tag: "x" }, { status: "New", tag: "x" })).toBe(false);
  });
  test("true when any field differs from the loaded baseline", () => {
    expect(saveDirty({ status: "Accepted", tag: "x" }, { status: "New", tag: "x" })).toBe(true);
    expect(saveDirty({ status: "New", tag: "y" }, { status: "New", tag: "x" })).toBe(true);
  });
});

describe("manualDirty — fields vs the post-overlay suggestion (controls the nav-hold)", () => {
  test("false when an UNTOUCHED suggestion still matches the suggestion baseline", () => {
    // overlay set both fields to the suggestion; operator hasn't typed → not manually dirty
    const suggestion = { status: "In Communication (Active)", tag: "warm-intro" };
    expect(manualDirty({ ...suggestion }, suggestion)).toBe(false);
  });
  test("true once the operator types over the suggestion", () => {
    const suggestion = { status: "In Communication (Active)", tag: "warm-intro" };
    expect(manualDirty({ status: "Dropped", tag: "warm-intro" }, suggestion)).toBe(true);
  });
  test("true when the operator has typed a note draft", () => {
    const suggestion = { status: "New", tag: "event-x" };
    expect(manualDirty({ ...suggestion }, suggestion, "Call again next week")).toBe(true);
  });
  test("false for a whitespace-only note draft", () => {
    const suggestion = { status: "New", tag: "event-x" };
    expect(manualDirty({ ...suggestion }, suggestion, "   ")).toBe(false);
  });
});
