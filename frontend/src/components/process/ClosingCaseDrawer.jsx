import Card from "../ui/Card";
import { StatusPill, fg, mutedFg } from "./ProcessParts";
import { RunTable } from "../runs/RunPrimitives";
import {
  CaseDrawerShell,
  CaseFooter,
  CaseLoading,
  FindingList,
  KeyValues,
  LatestRunCard,
  ResultBadge,
  RunHistory,
  Section,
  useStageCase,
} from "./CaseParts";
import { money, pct, resultColor } from "../../lib/caseDetails";
import { closingCheckResult, closingReviewedFindings } from "../../lib/closingReview";

const UW_ORDER = [
  "hold_tasks",
  "scra",
  "neighbourhood",
  "lsmr_terms",
  "lmt3_dates",
  "handoff",
];
const UW_LABELS = {
  hold_tasks: "TASK1 / MES1 hold tasks",
  scra: "SCRA rate threshold",
  neighbourhood: "Neighbourhood document",
  lsmr_terms: "LMSR modification terms",
  lmt3_dates: "LMT3 closing-code dates",
  handoff: "Underwriting handoff",
};
const TONE = {
  green: "hsl(142, 60%, 32%)",
  amber: "hsl(32, 90%, 38%)",
  red: "hsl(0, 72%, 48%)",
};
const QC_RESULT = {
  MATCHED: "pass",
  MISMATCH: "fail",
  UNABLE_TO_VERIFY: "review",
};
const QC_LABEL = {
  MATCHED: "Matched",
  MISMATCH: "Mismatch",
  UNABLE_TO_VERIFY: "Unable to Verify",
};
const row = {
  background: "hsl(var(--card))",
  borderBottom: "1px solid hsl(var(--border))",
};

/** The trial plan the Human Underwriter approved in Trial UW, and how its payments were received. */
function ApprovedPlanCard({ plan }) {
  if (!plan)
    return (
      <Card>
        <p className="text-sm" style={mutedFg}>
          No approved trial plan is recorded for this loan.
        </p>
      </Card>
    );
  const received = plan.installments.filter(
    (i) => i.status === "paid" || i.status === "late",
  ).length;
  return (
    <Card className="!p-4 space-y-3">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div className="min-w-0">
          <p className="font-sans text-sm font-semibold" style={fg}>
            {plan.plan_name}
          </p>
          <p className="font-mono text-xs mt-0.5" style={mutedFg}>
            {plan.plan_id}
          </p>
        </div>
        <div className="text-right">
          <StatusPill status="Approved" />
          <p className="font-serif text-2xl tabular-nums mt-1" style={fg}>
            {money(plan.trial_payment)}
            <span className="text-sm" style={mutedFg}>
              /mo
            </span>
          </p>
        </div>
      </div>
      <KeyValues
        columns={4}
        rows={[
          ["Principal & interest", money(plan.principal_interest)],
          ["Escrow", money(plan.escrow_payment)],
          ["Interest rate", `${Number(plan.interest_rate_pct).toFixed(3)}%`],
          ["Amortization", `${plan.amortization_months} months`],
          [
            "Trial payments",
            `${received} of ${plan.installments.length} received`,
          ],
          ["First due", plan.first_due_date],
          ["Housing ratio", pct(plan.housing_ratio)],
          ["UPB at approval", money(plan.upb_balance)],
        ]}
      />
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {plan.installments.map((i) => (
          <span key={i.installment_no} style={mutedFg}>
            #{i.installment_no} {i.due_date}:{" "}
            <span
              className="font-semibold uppercase"
              style={{ color: resultColor(i.status) }}
            >
              {i.status}
            </span>
            {i.received_date ? ` on ${i.received_date}` : ""}
          </span>
        ))}
      </div>
      <p className="text-xs" style={mutedFg}>
        Approved{" "}
        {plan.decided_at ? new Date(plan.decided_at).toLocaleString() : "—"} by{" "}
        {plan.decided_by ?? "not recorded"} in Trial Underwriting
        {plan.decision_note ? ` — “${plan.decision_note}”` : ""}
      </p>
    </Card>
  );
}

function displayQcValue(value) {
  if (value == null || value === "") return "Not available";
  if (typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value)
      .map(
        ([key, item]) => `${key.replaceAll("_", " ")}: ${displayQcValue(item)}`,
      )
      .join(" · ");
  }
  return String(value);
}

function AutomatedQcResults({ modQc }) {
  if (!modQc)
    return (
      <p className="text-sm" style={mutedFg}>
        Automated MOD QC has not run yet.
      </p>
    );
  return (
    <div
      className="rounded-md border divide-y"
      style={{
        borderColor: "hsl(var(--border))",
        background: "hsl(var(--card))",
      }}
    >
      {Object.values(modQc.checks).map((check) => (
        <section key={check.id} className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium" style={fg}>
              {check.label}
            </p>
            <ResultBadge
              result={
                check.status === "VERIFIED"
                  ? "pass"
                  : check.status === "MISMATCH_FOUND"
                    ? "fail"
                    : "review"
              }
            />
          </div>
          <div className="space-y-2">
            {check.fields.map((field) => (
              <div
                key={field.id}
                className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t pt-2 first:border-0 first:pt-0"
                style={{ borderColor: "hsl(var(--border))" }}
              >
                <div className="min-w-0">
                  <p className="text-xs font-medium" style={mutedFg}>
                    {field.label} · {field.left_label}
                  </p>
                  <p className="text-sm break-words" style={fg}>
                    {displayQcValue(field.left_value)}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-medium" style={mutedFg}>
                    {field.right_label}
                  </p>
                  <p className="text-sm break-words" style={fg}>
                    {displayQcValue(field.right_value)}
                  </p>
                </div>
                <div className="flex items-start sm:justify-end">
                  <ResultBadge result={QC_RESULT[field.status] ?? "review"} />
                </div>
                <p className="text-xs sm:col-span-3" style={mutedFg}>
                  {QC_LABEL[field.status] ?? field.status}: {field.reason}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="px-4 py-2 text-xs" style={mutedFg}>
        Evaluated {new Date(modQc.evaluated_at).toLocaleString()}
      </p>
    </div>
  );
}

export default function ClosingCaseDrawer({
  loan,
  onClose,
  onDocuments,
}) {
  const query = useStageCase(5, loan.loan_id);
  const data = query.data;
  const run = data?.latest_run;
  const d = data?.data;
  const report = run?.stage_report ?? {};
  const uw = report.uw_results ?? {};
  const modQc = report.mod_qc;
  const fm = report.final_mod;
  // Hide retired checks from saved runs without changing persisted results/statuses.
  const finalModChecks = Object.entries(fm?.checks ?? {})
    .filter(([id, check]) => id !== "recording_sla" && check.id !== "recording_sla")
    .map(([, check]) => check);
  const findings = closingReviewedFindings(run?.findings, run?.id, d?.underwriting_reviews).filter(
    (finding) =>
      finding.check_id !== "recording_sla" &&
      finding.check !== "Recording & SLA",
  );
  const actionChecks = (fm?.action?.show_checks ?? []).filter(
    (id) => id !== "recording_sla",
  );
  const status =
    data?.status ??
    loan.status ??
    (loan.position === "waiting" ? "Waiting" : "Not reached");
  return (
    <CaseDrawerShell
      title={loan.borrower_name}
      subtitle={`Loan ${loan.loan_id} · Final Underwriting & Closing`}
      status={status}
      onClose={onClose}
      footer={
        <CaseFooter
          loan={loan}
          data={data}
          onDocuments={onDocuments}
          onClose={onClose}
        />
      }
    >
      <CaseLoading query={query} label="closing case" />
      {data && (
        <>
          <LatestRunCard
            run={run ? { ...run, findings } : run}
            remark={data.remark}
            emptyText="Final Underwriting has not run for this loan yet."
          />

          {fm && (
            <Card className="!p-4 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                  className="font-serif text-xl"
                  style={{ color: TONE[fm.tone] ?? "inherit" }}
                >
                  {fm.verdict_label}
                </p>
                <span className="text-xs" style={mutedFg}>
                  QC {fm.facts.qc_pass} / {fm.facts.qc_total} verified
                </span>
              </div>
              <p className="text-sm" style={fg}>
                {fm.description}
              </p>
              {fm.action && (
                <p className="text-xs" style={mutedFg}>
                  Action: <span style={fg}>{fm.action.label}</span> (
                  {fm.action.severity})
                  {actionChecks.length > 0 && ` — see ${actionChecks.join(", ")}`}
                </p>
              )}
            </Card>
          )}

          <Section title="Approved trial plan">
            <ApprovedPlanCard plan={d.approved_plan} />
          </Section>

          <Section
            title="Final Underwriting checks"
            count={Object.keys(uw).length || null}
          >
            {Object.keys(uw).length ? (
              <div
                className="rounded-md border divide-y"
                style={{
                  borderColor: "hsl(var(--border))",
                  background: "hsl(var(--card))",
                }}
              >
                {UW_ORDER.filter((k) => uw[k]).map((k) => (
                  <div key={k} className="px-4 py-2.5 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={fg}>
                        {UW_LABELS[k]}
                      </p>
                      <p className="text-xs mt-0.5" style={mutedFg}>
                        {uw[k].detail}
                      </p>
                    </div>
                    <ResultBadge
                      result={
                        closingCheckResult(uw[k].outcome, run?.id, d.underwriting_reviews)
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={mutedFg}>
                {run?.start_at === "automated_mod_qc"
                  ? "This run re-checked MOD QC; Underwriting results are on the earlier run."
                  : run?.start_at === "fm_trial_outcome"
                    ? "This run re-checked Final Mod only; Underwriting results are on the earlier run."
                    : "No underwriting results saved yet."}
              </p>
            )}
          </Section>

          <Section title="Automated MOD QC">
            <AutomatedQcResults modQc={modQc} />
            <p className="text-xs" style={mutedFg}>
              {d.qc?.mod_approved_at
                ? `Underwriting signed off ${new Date(d.qc.mod_approved_at).toLocaleString()} by ${d.qc.mod_approved_by ?? "not recorded"}.`
                : "Underwriting plan not signed off yet."}
            </p>
          </Section>

          <Section
            title="Final Mod checks"
            count={fm ? finalModChecks.length : null}
          >
            {fm ? (
              <div
                className="rounded-md border divide-y"
                style={{
                  borderColor: "hsl(var(--border))",
                  background: "hsl(var(--card))",
                }}
              >
                {finalModChecks.map((c) => (
                  <div
                    key={c.id}
                    className="px-4 py-2.5 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={fg}>
                        {c.label}
                        {c.tags.includes("qc") && (
                          <span
                            className="ml-2 text-[10px] uppercase"
                            style={mutedFg}
                          >
                            QC
                          </span>
                        )}
                      </p>
                      <p className="text-xs mt-0.5" style={mutedFg}>
                        {c.message}
                      </p>
                    </div>
                    <ResultBadge result={c.status} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm" style={mutedFg}>
                The Final Mod checks run after MOD QC and Human Sign-off approve
                the Underwriting plan.
              </p>
            )}
          </Section>

          <Section title="TASK1 / MES1 tasks">
            {d.tasks.TASK1 == null && d.tasks.MES1 == null ? (
              <p className="text-sm" style={mutedFg}>
                Neither TASK1 nor MES1 has been loaded from MSP.
              </p>
            ) : (
              <RunTable
                columns={["Screen", "Task", "Status", "Opened", "Completed"]}
                empty={
                  [...(d.tasks.TASK1 ?? []), ...(d.tasks.MES1 ?? [])].length
                    ? null
                    : "No tasks on either screen."
                }
              >
                {["TASK1", "MES1"].flatMap((src) =>
                  (d.tasks[src] ?? []).map((t, i) => (
                    <tr key={`${src}-${i}`} style={row}>
                      <td
                        className="px-4 py-2 text-xs font-mono"
                        style={mutedFg}
                      >
                        {src}
                      </td>
                      <td className="px-4 py-2 text-xs font-mono" style={fg}>
                        {t.task_id}
                      </td>
                      <td className="px-4 py-2 text-xs" style={fg}>
                        {t.status}
                      </td>
                      <td className="px-4 py-2 text-xs" style={mutedFg}>
                        {t.opened_date ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs" style={mutedFg}>
                        {t.completed_date ?? "—"}
                      </td>
                    </tr>
                  )),
                )}
              </RunTable>
            )}
          </Section>

          <Section title="LMSR new modification terms">
            {d.lsmr ? (
              <Card className="!p-4">
                <KeyValues
                  rows={[
                    [
                      "Current rate",
                      d.lsmr.current_interest_rate != null
                        ? `${d.lsmr.current_interest_rate}%`
                        : null,
                    ],
                    [
                      "New rate",
                      d.lsmr.new_interest_rate != null
                        ? `${d.lsmr.new_interest_rate}%`
                        : null,
                    ],
                    [
                      "New term",
                      d.lsmr.new_term_months != null
                        ? `${d.lsmr.new_term_months} months`
                        : null,
                    ],
                    ["New principal", money(d.lsmr.new_principal_balance)],
                    ["New payment", money(d.lsmr.new_payment_amount)],
                    [
                      "Approved trial payment",
                      d.approved_plan
                        ? money(d.approved_plan.trial_payment)
                        : null,
                    ],
                  ]}
                />
              </Card>
            ) : (
              <p className="text-sm" style={mutedFg}>
                MSP LMSR has not been loaded for this loan.
              </p>
            )}
          </Section>

          <Section title="LMT3 closing-code dates">
            <Card className="!p-4">
              <KeyValues
                columns={4}
                rows={Object.entries(d.lmt3_dates).map(([k, v]) => [
                  k.split("_")[0].toUpperCase(),
                  v,
                ])}
              />
            </Card>
          </Section>

          <Section title="Neighbourhood document">
            {d.neighbourhood_document ? (
              <Card className="!p-4">
                <KeyValues
                  rows={[
                    ["Document date", d.neighbourhood_document.document_date],
                    ["Borrower", d.neighbourhood_document.borrower_name],
                    ["Property", d.neighbourhood_document.property_address],
                    ["UPB", money(d.neighbourhood_document.upb)],
                    [
                      "Prior partial claims",
                      (
                        d.neighbourhood_document.prior_partial_claim_amounts ??
                        []
                      )
                        .map(money)
                        .join(", ") || "None",
                    ],
                  ]}
                />
              </Card>
            ) : (
              <p className="text-sm" style={mutedFg}>
                No neighbourhood document has been extracted for this loan.
              </p>
            )}
          </Section>

          {run && (
            <Section title="All findings" count={findings.length}>
              <FindingList findings={findings} />
            </Section>
          )}
          <RunHistory runs={data.runs} />
        </>
      )}
    </CaseDrawerShell>
  );
}
