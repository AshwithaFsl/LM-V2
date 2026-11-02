/** A human approval resolves a review, not the underlying automated check. */
export function closingCheckResult(outcome, runId, reviews = []) {
  if (outcome !== "review") return { pass: "pass", hold: "fail" }[outcome] ?? outcome;
  const approved = runId && reviews.some((review) => review.agent_run_id === runId
    && review.status === "approved" && review.decided_at
    && ["underwriting_team_lead", "underwriting_sign_off"].includes(review.gate));
  return approved ? "reviewed" : "review";
}

/** Use the same approval-aware badge in All findings, preserving saved evidence. */
export function closingReviewedFindings(findings = [], runId, reviews = []) {
  return findings.map((finding) => {
    if (finding.group !== "final_underwriting" || finding.result !== "review") return finding;
    const result = closingCheckResult(finding.result, runId, reviews);
    return result === finding.result ? finding : { ...finding, result };
  });
}