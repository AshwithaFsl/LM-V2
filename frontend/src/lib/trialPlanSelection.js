/** Compare total trial payment (P&I + escrow), not income or P&I alone. */
export function selectableTrialPlans(plans = []) {
  return plans.filter((plan) => plan.status === "proposed"
    && typeof plan.trial_payment === "number" && Number.isFinite(plan.trial_payment)
    && typeof plan.current_payment === "number" && Number.isFinite(plan.current_payment)
    && plan.trial_payment > 0 && plan.current_payment > 0
    && plan.trial_payment <= plan.current_payment);
}

/** Inbox presentation only; keep saved audit findings and completed decisions intact. */
export function trialDecisionFindings(decision) {
  const findings = decision.findings ?? [];
  if (decision.stage_no !== 3) return findings;
  const plans = decision.trial_plans ?? [];
  const byId = new Map(plans.map((plan) => [plan.plan_id, plan]));
  const eligible = new Set(selectableTrialPlans(plans).map((plan) => plan.plan_id));
  return findings
    .filter((finding) => !/^Payment terms\s*·/i.test(finding.check ?? ""))
    .map((finding) => {
      const plan = byId.get(finding.plan_id);
      if (decision.status !== "pending" || !plan || plan.status !== "proposed" || eligible.has(plan.plan_id)) {
        return finding;
      }
      const increased = typeof plan.current_payment === "number" && plan.current_payment > 0
        && typeof plan.trial_payment === "number" && plan.trial_payment > plan.current_payment;
      return {
        ...finding,
        result: "not_eligible",
        detail: increased
          ? "Not eligible — total monthly trial payment exceeds the current mortgage payment. This plan cannot be selected."
          : "Not eligible — a valid trial payment and current mortgage payment must be verified before selection.",
      };
    });
}