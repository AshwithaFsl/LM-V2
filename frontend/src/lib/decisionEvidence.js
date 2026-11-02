import { money } from "./caseDetails.js";

/** Render the saved QC evidence, never substitute live values for an audit comparison. */
export function formatQcValue(value, field = "") {
  if (value == null || value === "") return "Not recorded";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => formatQcValue(item, field)).join(" · ");
  if (typeof value === "object") {
    const labels = { principal_interest: "P&I", escrow_payment: "Escrow", total_payment: "Total" };
    return Object.entries(value).map(([key, item]) =>
      `${labels[key] ?? key.replace(/_/g, " ")}: ${formatQcValue(item, labels[key] ? "payment" : key)}`,
    ).join(" · ");
  }
  if (typeof value === "number" || (typeof value === "string" && value.trim() && Number.isFinite(Number(value)))) {
    if (/balance|payment|escrow|principal.*interest/i.test(field)) return money(value);
    if (/rate/i.test(field)) return `${Number(value)}%`;
    if (/term|months/i.test(field)) return `${Number(value)} months`;
  }
  return String(value);
}