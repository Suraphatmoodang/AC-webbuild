// Numeric form fields in the entry modals start EMPTY rather than pre-filled with 0,
// so the greyed placeholder shows through like the text fields and the user types a
// real figure instead of having to clear a leading zero. The blank is coerced to a
// fallback at save time, so nothing but a number ever reaches the DB.
//
// Used by the add/edit modals on both the accessory and fabric sides.

/** A numeric form field that may be left blank while typing. */
export type NumField = number | "";

/** Coerce a possibly-blank field to a number for saving. */
export const numOr = (v: NumField, fallback = 0): number => (v === "" ? fallback : Number(v));

/** Parse an <input type="number"> value, preserving "" so the field can be blanked. */
export const numInput = (v: string): NumField => (v === "" ? "" : parseFloat(v) || 0);

/** Default สต็อคขั้นต่ำ applied when the field is left blank (matches the importer). */
export const DEFAULT_MIN_QTY = 10;
