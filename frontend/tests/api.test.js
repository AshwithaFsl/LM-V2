import test from "node:test";
import assert from "node:assert/strict";
import { apiDelete, apiPost } from "../src/lib/api.js";

const path = "/api/data-management/cases/5550001001";

test("apiDelete sends a bodyless DELETE and cleans response display messages", async (t) => {
  const payload = { loan_id: "5550001001", message: "Deleted", detail: "Removed; confidence not considered" };
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload)));
  assert.deepEqual(await apiDelete(path), { ...payload, detail: "Removed" });
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [path, { method: "DELETE" }]);
  assert.equal(payload.detail, "Removed; confidence not considered");
});

test("apiDelete accepts a successful empty 204 response", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));
  assert.equal(await apiDelete(path), null);
});

for (const [label, status, body, message] of [
  ["absent case", 404, { detail: "Case is not present" }, "Case is not present"],
  ["non-demo case", 404, { detail: "Not a supplied case" }, "Not a supplied case"],
  ["busy case", 409, { detail: "Case is busy; confidence not considered" }, "Case is busy"],
  ["error field", 409, { error: "Try again later" }, "Try again later"],
  ["nested detail", 409, { detail: { message: "Processing in progress" } }, "Processing in progress"],
  ["validation details", 422, { detail: [{ msg: "Invalid loan" }, { msg: "Missing value" }] }, "Invalid loan; Missing value"],
]) {
  test(`apiDelete parses ${label} without losing the HTTP status`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
    await assert.rejects(apiDelete(path), (error) => {
      assert.equal(error.message, message);
      assert.equal(error.status, status);
      return true;
    });
  });
}

for (const body of ["Service unavailable", "{}", '{"detail":null}']) {
  test(`apiDelete falls back to path/status for unrecognized error body: ${body}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(body, { status: 503 }));
    await assert.rejects(apiDelete(path), { message: `${path} 503`, status: 503 });
  });
}

test("apiDelete preserves network errors without retrying destructive actions", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Network unavailable"); });
  await assert.rejects(apiDelete(path), { message: "Network unavailable" });
  assert.equal(fetchMock.mock.callCount(), 1);
});

test("apiPost still sends JSON and cleans successful responses", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({ loan_id: "5550001001", detail: "Added; confidence not considered" }), { status: 201 },
  ));
  assert.deepEqual(await apiPost(path, {}), { loan_id: "5550001001", detail: "Added" });
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [path, {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }]);
});

test("apiPost surfaces duplicate-case conflict details", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ detail: "Case already exists" }), { status: 409 }));
  await assert.rejects(apiPost(path, {}), { message: "Case already exists", status: 409 });
});