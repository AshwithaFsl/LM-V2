import Card from "../ui/Card";
import { KeyValues, Section, useStageCase } from "./CaseParts";
import { fg, mutedFg } from "./ProcessParts";
import { money } from "../../lib/caseDetails";

/** Shared live evidence used by the case drawer and the underwriter's inbox. */
export default function TrialUWEvidence({ evidence }) {
  if (!evidence) return null;
  return (
    <Section title="Evidence on file (live from MSP and documents)">
      <Card className="!p-4">
        <KeyValues rows={[
          ["Investor (DLQ1)", evidence.investor_type], ["UPB (DLQ1)", money(evidence.upb_balance)],
          ["Months delinquent", evidence.months_delinquent], ["Escrow (ANA1)", money(evidence.escrow_payment_amount)],
          ["Escrow current", evidence.escrow_current == null ? null : evidence.escrow_current ? "Yes" : "No"],
          ["Current payment (credit report)", money(evidence.current_payment)],
          ["Hardship", evidence.hardship_reason], ["Other income (MAA)", money(evidence.other_income_amount)],
        ]} />
        {!!evidence.income_sources?.length && (
          <ul className="mt-3 text-xs space-y-0.5" style={mutedFg}>
            {evidence.income_sources.map((source, index) => (
              <li key={`${source.type}-${index}`}>{source.type}: <span style={fg}>{money(source.gross_monthly_amount)}/mo</span></li>
            ))}
          </ul>
        )}
      </Card>
    </Section>
  );
}

export function LiveTrialUWEvidence({ loanId }) {
  // Share the case drawer's cache and five-second refresh, scoped to this loan.
  const query = useStageCase(3, loanId);
  if (query.isLoading) {
    return <Card><p role="status" className="text-sm" style={mutedFg}>Loading live underwriting evidence…</p></Card>;
  }
  if (query.isError) {
    return (
      <Card>
        <p role="alert" className="text-sm" style={mutedFg}>
          Could not refresh live underwriting evidence.{' '}
          <button type="button" className="underline" onClick={() => query.refetch()}>Try again</button>
        </p>
      </Card>
    );
  }
  const evidence = query.data?.data?.evidence;
  return evidence ? <TrialUWEvidence evidence={evidence} /> : (
    <Card><p className="text-sm" style={mutedFg}>No live underwriting evidence is available for this loan.</p></Card>
  );
}