import { useRef, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Database, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import Card, { PageHeader } from "../components/ui/Card";
import { PrimaryButton, StatusPill, fg, mutedFg } from "../components/process/ProcessParts";
import { apiDelete, apiGet, apiPost } from "../lib/api";

const CASES_API = "/api/data-management/cases";
const MUTATION_KEY = ["data-management"];
const STAGES = [
  ["intake", "Intake & Document Review"],
  ["retention_eligibility", "Retention Eligibility"],
  ["trial_uw", "Trial Underwriting"],
  ["trial_monitoring", "Trial Monitoring"],
  ["closing", "Final Modification & Closing"],
];

function PresenceBadge({ present }) {
  const color = present ? "hsl(142, 60%, 32%)" : "hsl(var(--muted-foreground))";
  return (
    <span className="text-xs font-medium rounded-full border px-2 py-0.5 whitespace-nowrap" style={{ color, borderColor: color }}>
      {present ? "Present in DB" : "Not in DB"}
    </span>
  );
}

export default function DataManagement() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState(null);
  const [notice, setNotice] = useState(null);
  const actionLock = useRef(false);
  const pendingCount = useIsMutating({ mutationKey: MUTATION_KEY });
  const { data, isPending, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["data-management", "cases"],
    queryFn: () => apiGet(CASES_API),
    refetchInterval: 10000,
  });
  const mutation = useMutation({
    mutationKey: MUTATION_KEY,
    retry: false,
    mutationFn: ({ action, loanId }) => {
      const path = `${CASES_API}/${encodeURIComponent(loanId)}`;
      return action === "add" ? apiPost(path, {}) : apiDelete(path);
    },
    onSuccess: (result, { action, loanId }) => {
      setNotice({
        type: "success",
        text: result?.message || `Case ${loanId} ${action === "add" ? "added to" : "deleted from"} the database.`,
      });
    },
    onError: (err) => setNotice({ type: "error", text: err.message }),
    // Refresh even after a conflict/not-found response: presence may have changed elsewhere.
    // Inactive queries are marked stale so other pages reload when next opened.
    onSettled: () => qc.invalidateQueries(),
  });
  const busy = pendingCount > 0 || mutation.isPending;
  const cases = data?.cases ?? [];
  const selected = cases.find((item) => item.loan_id === selectedId);
  const actionsDisabled = busy || isPending || isError || !selected;

  function selectCase(loanId) {
    if (busy || actionLock.current) return;
    setSelectedId(loanId);
    setNotice(null);
    mutation.reset();
  }

  async function act(action) {
    // The ref also prevents rapid clicks before React has rendered the busy state.
    if (actionLock.current || qc.isMutating({ mutationKey: MUTATION_KEY }) || actionsDisabled) return;
    if ((action === "add" && selected.present) || (action === "delete" && !selected.present)) return;
    actionLock.current = true;
    try {
      if (action === "delete" && !window.confirm(
        `Delete case ${selected.loan_id} (${selected.borrower_name})?\n\n`
        + "All case documents, execution history, trial plans, and decisions will be removed. "
        + "This cannot be undone. Adding the case again restores only the supplied source data, not its history.",
      )) return;
      setNotice(null);
      await mutation.mutateAsync({ action, loanId: selected.loan_id });
    } catch {
      // The mutation's onError callback displays the API error.
    } finally {
      actionLock.current = false;
    }
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 font-sans" aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Data Management" subtitle="Select one supplied case to add to or delete from the database." />
        <PrimaryButton icon={RefreshCw} onClick={() => refetch()} disabled={busy} busy={isFetching}>
          Refresh
        </PrimaryButton>
      </div>

      <Card className="flex items-start gap-3">
        <Database size={20} className="shrink-0 mt-0.5" style={mutedFg} />
        <div className="text-sm space-y-2" style={mutedFg}>
          <p style={fg}>Adding a case inserts its MSP record, extracted documents, empty stage statuses, and servicing data together.</p>
          <p>
            <strong style={fg}>Automatic flow: {isError || !data ? "Unknown" : data.auto_flow_enabled ? "Enabled" : "Disabled"}.</strong>{" "}
            Automatic processing depends on auto flow being enabled. Cases may progress through the workflow,
            subject to rules, required data, and human decisions; they do not necessarily stop at retention.
          </p>
          <p>Presence and stage status refresh every 10 seconds. Intended outcomes describe the scenarios, not guaranteed results.</p>
        </div>
      </Card>

      {isPending && (
        <p role="status" className="flex items-center gap-2 text-sm" style={mutedFg}>
          <LoaderCircle size={16} className="animate-spin" /> Loading supplied cases…
        </p>
      )}
      {isError && (
        <p role="alert" className="text-sm" style={{ color: "hsl(0, 72%, 48%)" }}>
          Could not refresh cases: {error.message}. Actions are disabled until a successful refresh.
        </p>
      )}
      {!isPending && !isError && cases.length === 0 && (
        <Card><p className="text-sm" style={mutedFg}>No supplied cases are available.</p></Card>
      )}

      {cases.length > 0 && (
        <fieldset disabled={busy} className="min-w-0">
          <legend className="text-sm font-semibold mb-3" style={fg}>Choose one case</legend>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {cases.map((item) => (
              <label key={item.loan_id} className={`block rounded-md ${busy ? "cursor-wait" : "cursor-pointer"}`}>
                <Card className={`h-full flex flex-col gap-3 ${selectedId === item.loan_id ? "ring-2 ring-[hsl(var(--primary))]" : ""}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <input
                      type="radio"
                      name="supplied-case"
                      value={item.loan_id}
                      checked={selectedId === item.loan_id}
                      onChange={() => selectCase(item.loan_id)}
                      aria-label={`${item.borrower_name}, loan ${item.loan_id}`}
                      className="h-4 w-4 accent-[hsl(var(--primary))]"
                    />
                    <PresenceBadge present={item.present} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold" style={fg}>{item.borrower_name}</h2>
                    <p className="font-mono text-xs mt-1" style={mutedFg}>{item.loan_id}</p>
                  </div>
                  <p className="text-sm font-medium" style={fg}>{item.scenario}</p>
                  <p className="text-sm" style={mutedFg}>{item.description}</p>
                  <div className="mt-auto text-sm pt-2" style={mutedFg}>
                    <p className="font-medium" style={fg}>Intended outcome (not guaranteed)</p>
                    <p className="mt-1">{item.expected_outcome}</p>
                  </div>
                </Card>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <Card className="flex flex-col gap-4">
        <h2 className="text-base font-semibold" style={fg}>Selected case</h2>
        {selected ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm" style={fg}>{selected.borrower_name} · <span className="font-mono">{selected.loan_id}</span></p>
              <PresenceBadge present={selected.present} />
            </div>
            <p className="text-sm" style={mutedFg}>{selected.scenario} — {selected.description}</p>
            <p className="text-sm" style={mutedFg}><strong>Intended outcome (not guaranteed):</strong> {selected.expected_outcome}</p>
            <section className="rounded-md border p-4 space-y-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--muted))" }}>
              <h3 className="text-sm font-semibold" style={fg}>Servicing data included</h3>
              <p className="text-sm" style={mutedFg}>{selected.servicing_description}</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(selected.trial_payments ?? []).map((payment, index) => (
                  <div key={index} className="rounded border p-3" style={{ borderColor: "hsl(var(--border))", background: "hsl(var(--card))" }}>
                    <p className="text-xs uppercase tracking-wide" style={mutedFg}>Installment {index + 1}</p>
                    <p className="text-sm font-semibold mt-1" style={{ color: "hsl(142, 60%, 32%)" }}>{payment.replace(/_/g, " ")}</p>
                    <p className="text-xs mt-1" style={mutedFg}>Amount and date from the approved plan</p>
                  </div>
                ))}
              </div>
              <p className="text-xs" style={mutedFg}>This is the configured payment schedule, not payments already received. View actual postings in Trial Monitoring after a monitoring run.</p>
            </section>
            {selected.present && selected.stages ? (
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {STAGES.map(([key, label]) => (
                  <div key={key}>
                    <dt className="text-xs mb-1" style={mutedFg}>{label}</dt>
                    <dd>{selected.stages[key] ? <StatusPill status={selected.stages[key]} /> : <span className="text-sm" style={mutedFg}>No status recorded</span>}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm" style={mutedFg}>
                {selected.present ? "Stage status is not available." : "This case is not in the database. Add it to view live stage status."}
              </p>
            )}
          </>
        ) : <p className="text-sm" style={mutedFg}>Choose a case above to view its status and available actions.</p>}

        <div className="flex flex-wrap items-center gap-3">
          <PrimaryButton icon={Plus} onClick={() => act("add")} disabled={actionsDisabled || selected?.present}
            busy={mutation.isPending && mutation.variables?.action === "add"}>
            Add to DB
          </PrimaryButton>
          <PrimaryButton icon={Trash2} onClick={() => act("delete")} disabled={actionsDisabled || !selected?.present}
            busy={mutation.isPending && mutation.variables?.action === "delete"}>
            Delete
          </PrimaryButton>
          {busy && <span role="status" className="text-xs" style={mutedFg}>Updating case data and refreshing pages…</span>}
        </div>
        <p className="text-xs" style={mutedFg}>Delete removes all documents, history, plans, and decisions for the selected case. Confirmation is required.</p>
        {notice && (
          <p role={notice.type === "error" ? "alert" : "status"} className="text-sm"
            style={{ color: notice.type === "error" ? "hsl(0, 72%, 48%)" : "hsl(142, 60%, 32%)" }}>
            {notice.text}
          </p>
        )}
      </Card>
    </div>
  );
}