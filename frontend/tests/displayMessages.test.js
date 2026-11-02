import test from "node:test";
import assert from "node:assert/strict";
import { cleanDisplayMessages, servicingDisplayText } from "../src/lib/displayMessages.js";

test("removes retired message from pending actions and historical run traces", () => {
  const original = {
    pending_actions: [{ pending_reason: "1 stip(s); confidence is not considered" }],
    remark: "0 stip(s); confidence is not considered",
    trace: [{ detail: "1 stip(s); confidence is not considered" }],
    report: { explanation: "Confidence not considered", stip_count: 1 },
  };
  const result = cleanDisplayMessages(original);
  assert.equal(result.pending_actions[0].pending_reason, "1 stip(s)");
  assert.equal(result.remark, "0 stip(s)");
  assert.equal(result.trace[0].detail, "1 stip(s)");
  assert.equal(result.report.explanation, "");
  assert.equal(result.report.stip_count, 1);
  assert.equal(original.remark, "0 stip(s); confidence is not considered");
});

test("preserves source data, decisions, metadata, nulls and other explanations", () => {
  const source = { status: "Facially Incomplete", confidence_considered: false,
    hardship_reason: "confidence is not considered", detail: "Current tax bill required",
    report: null, values: [0, false, null] };
  assert.deepEqual(cleanDisplayMessages(source), source);
});

test("servicing labels are cleaned in historical checks and payment descriptions", () => {
  const original = {
    findings: [{ check: "MOCK servicer", source: "mock_servicing", detail: "posted 3 mock payment(s) to DLQ1" }],
    stage_report: { mock_servicer: { posted: [{ transaction_type: "Trial (MOCK)", reference: "MOCK-TP-123-1" }] } },
  };
  const result = cleanDisplayMessages(original);
  assert.deepEqual(result.findings[0], {
    check: "Servicing data", source: "servicing_data", detail: "posted 3 payment(s) to DLQ1",
  });
  assert.equal(result.stage_report.mock_servicer.posted[0].transaction_type, "Trial");
  assert.equal(result.stage_report.mock_servicer.posted[0].reference, "MOCK-TP-123-1");
  assert.equal(original.findings[0].check, "MOCK servicer");
  assert.equal(original.stage_report.mock_servicer.posted[0].transaction_type, "Trial (MOCK)");
});

test("servicing display formatting covers labels, references and JSON without mutating data", () => {
  assert.equal(servicingDisplayText("Mock servicing data"), "Servicing data");
  assert.equal(servicingDisplayText("MOCK-TP-123-1"), "SERVICING-TP-123-1");
  assert.equal(servicingDisplayText(null), null);
  const original = { mock_servicer: { source: "mock_servicing", transaction_type: "Trial (MOCK)" } };
  assert.doesNotMatch(servicingDisplayText(JSON.stringify(original)), /mock/i);
  assert.equal(original.mock_servicer.source, "mock_servicing");
  assert.equal(servicingDisplayText("Current tax bill required"), "Current tax bill required");
});