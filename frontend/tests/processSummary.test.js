import test from "node:test";
import assert from "node:assert/strict";
import { processLoans, processSummary } from "../src/lib/processSummary.js";

const loans = [
  { loan_id: "1", position: "not_reached", status: null },
  { loan_id: "2", position: "waiting", status: null },
  ...["Ready", "Declined", "UW In Progress", "Hold Docs Pending", "Hold Approval Pending", "In Human Review"]
    .map((status, i) => ({ loan_id: String(i + 3), position: "worked", status })),
];
const counts = { "Not reached": 1, Waiting: 1, Ready: 1, "UW In Progress": 1,
  "Hold Docs Pending": 1, "Hold Approval Pending": 1, Declined: 1, "In Human Review": 1 };

test("Trial UW shows reached count including cases whose status cards are hidden", () => {
  assert.deepEqual(processSummary(3, { loans, counts }), [
    ["Reached", 7], ["Waiting", 1], ["Ready", 1], ["Declined", 1], ["In Human Review", 1],
  ]);
});

test("Reached lists all and only cases that reached the stage", () => {
  assert.deepEqual(processLoans(loans, "Reached"), loans.slice(1));
  assert.deepEqual(processLoans(loans), loans.slice(1));
  assert.deepEqual(processLoans(loans, "Ready"), [loans[2]]);
  assert.deepEqual(processLoans(loans, "Not reached"), [loans[0]]);
});

test("other stages replace Not reached and preserve their remaining status cards", () => {
  for (const stage of [1, 2, 4, 5]) {
    assert.deepEqual(processSummary(stage, { loans, counts }), [
      ["Reached", 7], ...Object.entries(counts).filter(([status]) => status !== "Not reached"),
    ]);
  }
});

test("all five stages support empty and entirely unreached cases", () => {
  for (const stage of [1, 2, 3, 4, 5]) {
    assert.deepEqual(processSummary(stage), [["Reached", 0]]);
    assert.deepEqual(processSummary(stage, { loans: [loans[0]], counts: { "Not reached": 1 } }), [["Reached", 0]]);
  }
  assert.deepEqual(processLoans(), []);
});