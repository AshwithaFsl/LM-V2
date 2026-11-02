import test from "node:test";
import assert from "node:assert/strict";
import { closingCheckResult, closingReviewedFindings } from "../src/lib/closingReview.js";

const approval = { agent_run_id: "run-1", gate: "underwriting_sign_off", status: "approved", decided_at: "2026-11-02T12:00:00Z" };

test("approved closing reviews display Reviewed without changing passed or failed checks", () => {
  assert.equal(closingCheckResult("review", "run-1", [approval]), "reviewed");
  assert.equal(closingCheckResult("review", "run-1", [{ ...approval, gate: "underwriting_team_lead" }]), "reviewed");
  assert.equal(closingCheckResult("pass", "run-1", [approval]), "pass");
  assert.equal(closingCheckResult("hold", "run-1", [approval]), "fail");
});

test("pending, rejected, unrelated and previous-run approvals do not resolve a review", () => {
  assert.equal(closingCheckResult("review", "run-1"), "review");
  for (const change of [{ status: "pending" }, { status: "rejected" }, { agent_run_id: "old-run" },
    { gate: "underwriter_review" }, { decided_at: null }]) {
    assert.equal(closingCheckResult("review", "run-1", [{ ...approval, ...change }]), "review");
  }
});

test("All findings shows approved SCRA and handoff reviews as Reviewed without rewriting evidence", () => {
  const findings = [
    { group: "final_underwriting", check: "SCRA rate threshold", result: "review", detail: "Original review evidence" },
    { group: "final_underwriting", check: "Underwriting handoff", result: "review" },
    { group: "final_underwriting", check: "Tasks", result: "pass" },
    { group: "final_underwriting", check: "Document", result: "fail" },
    { group: "mod_qc", result: "review" },
  ];
  const display = closingReviewedFindings(findings, "run-1", [approval]);
  assert.deepEqual(display.map((finding) => finding.result), ["reviewed", "reviewed", "pass", "fail", "review"]);
  assert.equal(display[0].detail, "Original review evidence");
  assert.equal(findings[0].result, "review");
  assert.deepEqual(closingReviewedFindings(findings, "new-run", [approval]), findings);
  assert.deepEqual(closingReviewedFindings(findings, "run-1", [{ ...approval, status: "rejected" }]), findings);
  assert.deepEqual(closingReviewedFindings(findings, "run-1"), findings);
  assert.deepEqual(closingReviewedFindings(), []);
});