import test from "node:test";
import assert from "node:assert/strict";
import { selectableTrialPlans, trialDecisionFindings } from "../src/lib/trialPlanSelection.js";

const plan = (id, payment, current = 2180) => ({
  plan_id: id, status: "proposed", trial_payment: payment, current_payment: current,
});

test("keeps the lower-payment 40-year option and hides the increased 30-year option", () => {
  const flex = plan("flex", 2148.99);
  const standard = plan("standard", 2260.61);
  assert.deepEqual(selectableTrialPlans([flex, standard]), [flex]);
  assert.equal(standard.status, "proposed"); // Display filtering does not rewrite history.
});

test("allows equal payments but excludes even a one-cent increase", () => {
  const equal = plan("equal", 2180);
  assert.deepEqual(selectableTrialPlans([equal, plan("increase", 2180.01)]), [equal]);
});

test("compares the total payment rather than income, P&I, or a rounded change percentage", () => {
  const increased = { ...plan("increase", 2180.01), principal_interest: 1500,
    gross_monthly_income: 7000, payment_change_pct: 0 };
  assert.deepEqual(selectableTrialPlans([increased]), []);
});

test("excludes non-proposed plans and missing or invalid payment comparisons", () => {
  for (const invalid of [null, undefined, 0, -1, NaN, Infinity, "", "2180", true]) {
    assert.deepEqual(selectableTrialPlans([{ ...plan("bad-current", 1000), current_payment: invalid }]), []);
    assert.deepEqual(selectableTrialPlans([plan("bad-trial", invalid)]), []);
  }
  for (const status of ["approved", "declined", "not_selected", "superseded"]) {
    assert.deepEqual(selectableTrialPlans([{ ...plan("old", 1000), status }]), []);
  }
  assert.deepEqual(selectableTrialPlans(), []);
});

test("inbox removes payment terms and marks the increased plan not eligible without changing audit data", () => {
  const decision = {
    stage_no: 3, status: "pending",
    trial_plans: [plan("flex", 2148.99), plan("standard", 2260.61)],
    findings: [
      { check: "Delinquency", result: "neutral" },
      { check: "Payment terms · Standard Modification Trial · 30-year", result: "review" },
      { check: "Trial plan · Flex", plan_id: "flex", result: "review", detail: "Awaiting review" },
      { check: "Trial plan · Standard", plan_id: "standard", result: "review", detail: "Awaiting review" },
    ],
  };
  const rows = trialDecisionFindings(decision);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].result, "review");
  assert.equal(rows[2].result, "not_eligible");
  assert.match(rows[2].detail, /exceeds the current mortgage payment/);
  assert.equal(decision.findings.length, 4);
  assert.equal(decision.findings[3].result, "review");
  assert.equal(decision.findings[3].detail, "Awaiting review");
  assert.deepEqual(trialDecisionFindings({ ...decision, stage_no: 2 }), decision.findings);
  assert.equal(trialDecisionFindings({ ...decision, status: "approved" })[2].result, "review");
});

test("missing payment evidence has a distinct explanation and unmatched findings are preserved", () => {
  const rows = trialDecisionFindings({ stage_no: 3, status: "pending",
    trial_plans: [plan("missing", 1000, null)],
    findings: [{ plan_id: "missing", result: "review" }, { plan_id: "unknown", result: "review" }],
  });
  assert.equal(rows[0].result, "not_eligible");
  assert.match(rows[0].detail, /must be verified/);
  assert.equal(rows[1].result, "review");
});