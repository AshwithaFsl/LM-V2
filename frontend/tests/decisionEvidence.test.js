import test from "node:test";
import assert from "node:assert/strict";
import { formatQcValue } from "../src/lib/decisionEvidence.js";

test("formats the actual borrower, property, balance, rate and term evidence", () => {
  assert.equal(formatQcValue("Alexandra M. Rivera", "Borrower name"), "Alexandra M. Rivera");
  assert.equal(formatQcValue("123 Main Street", "Property address"), "123 Main Street");
  assert.equal(formatQcValue(212400, "Principal balance"), "$212,400.00");
  assert.equal(formatQcValue("6.875", "New interest rate"), "6.875%");
  assert.equal(formatQcValue(360, "New loan term"), "360 months");
});

test("shows payment components and total without object placeholders", () => {
  const payment = { principal_interest: 1395.32, escrow_payment: 385, total_payment: 1780.32 };
  assert.equal(formatQcValue(payment, "New monthly payment"), "P&I: $1,395.32 · Escrow: $385.00 · Total: $1,780.32");
  assert.equal(payment.total_payment, 1780.32);
});

test("does not invent missing evidence or hide zero and false values", () => {
  assert.equal(formatQcValue(null), "Not recorded");
  assert.equal(formatQcValue(undefined), "Not recorded");
  assert.equal(formatQcValue(""), "Not recorded");
  assert.equal(formatQcValue(0, "Principal balance"), "$0.00");
  assert.equal(formatQcValue(false), "No");
  assert.equal(formatQcValue({ total_payment: null }), "Total: Not recorded");
});