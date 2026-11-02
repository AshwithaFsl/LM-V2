// Hide a retired status-message suffix in historical API responses without
// rewriting stored audit history or changing source documents/verdicts.
const messageFields = new Set(["detail", "remark", "pending_reason", "reason", "explanation", "outcome"]);
const servicingFields = new Set([...messageFields, "check", "source", "transaction_type", "scenario"]);

// Presentation only: keep API keys and stored payment references intact.
export function servicingDisplayText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/\bmock_servic(?:er|ing)\b/gi, "servicing_data")
    .replace(/\bmock\s+servic(?:er|ing)(?:\s+data)?\b/gi, "Servicing data")
    .replace(/\s*\(mock\)/gi, "")
    .replace(/\bMOCK-/gi, "SERVICING-")
    .replace(/\bmock\s+payment/gi, "payment");
}

export function cleanDisplayMessages(value, field = "") {
  if (typeof value === "string") {
    const text = messageFields.has(field)
      ? value.replace(/(?:;\s*|\s+)?confidence(?:\s+score)?\s+(?:is\s+)?not\s+considered\.?/gi, "").trim()
      : value;
    return servicingFields.has(field) ? servicingDisplayText(text) : text;
  }
  if (Array.isArray(value)) return value.map((item) => cleanDisplayMessages(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanDisplayMessages(item, key)]));
  }
  return value;
}