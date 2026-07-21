// Unit vocabularies for the fabric side, shared by every fabric page's forms.
// Taken from the source spreadsheet: stock/price are measured in กก · หลา · เมตร,
// fabric weight in gm2. The lists are suggestions for dropdowns — the DB columns
// are free text, so importing a sheet with a unit not listed here still works.
export const STOCK_UNITS = ["กก", "หลา", "เมตร", "ม้วน", "ปอนด์"];
export const WEIGHT_UNITS = ["gm2", "gsm", "oz/yd2"];
