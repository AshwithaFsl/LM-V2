// Thin fetch wrappers shared by every react-query hook.
// In dev, Vite proxies /api to the FastAPI server (see vite.config.js).
import { cleanDisplayMessages } from "./displayMessages.js";
const API_BASE = import.meta.env?.VITE_API_BASE ?? "";

function errorText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(errorText).filter(Boolean).join("; ");
  if (value && typeof value === "object") {
    return errorText(value.error) || errorText(value.detail)
      || errorText(value.message) || errorText(value.msg);
  }
  return "";
}

async function responseError(res, path) {
  let message = `${path} ${res.status}`;
  try {
    const text = errorText(await res.json());
    message = cleanDisplayMessages({ detail: text }).detail || message;
  } catch {
    /* non-JSON error body */
  }
  const error = new Error(message);
  error.status = res.status;
  return error;
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return cleanDisplayMessages(await res.json());
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await responseError(res, path);
  return cleanDisplayMessages(await res.json());
}

export async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, { method: "DELETE" });
  if (!res.ok) throw await responseError(res, path);
  if (res.status === 204) return null;
  return cleanDisplayMessages(await res.json());
}

export { API_BASE };
