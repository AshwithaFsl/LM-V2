import { useRef, useState } from "react";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import Card, { PageHeader } from "../components/ui/Card";
import { PrimaryButton, fg, mutedFg } from "../components/process/ProcessParts";
import { apiDelete, apiGet, apiPost } from "../lib/api";

const CASES_API = "/api/data-management/cases";
const MUTATION_KEY = ["data-management"];

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
  const actionsDisabled = busy || isPending || isError;

  async function act(action, selected) {
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
        <PageHeader title="Data Management" subtitle="Add or delete a case from the database." />
        <PrimaryButton icon={RefreshCw} onClick={() => refetch()} disabled={busy} busy={isFetching}>
          Refresh
        </PrimaryButton>
      </div>

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
        <section aria-labelledby="cases-heading" className="min-w-0">
          <h2 id="cases-heading" className="text-sm font-semibold mb-3" style={fg}>Choose one case</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {cases.map((item) => (
                <Card key={item.loan_id} className="h-full flex flex-col gap-3">
                  <div className="flex justify-end">
                    <PresenceBadge present={item.present} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold" style={fg}>{item.borrower_name}</h3>
                    <p className="font-mono text-xs mt-1" style={mutedFg}>{item.loan_id}</p>
                  </div>
                  <p className="text-sm font-medium" style={fg}>{item.scenario}</p>
                  <div className="mt-auto pt-3 flex flex-wrap items-center gap-3" role="group" aria-label={`Actions for ${item.borrower_name}, loan ${item.loan_id}`}>
                    <PrimaryButton icon={Plus} onClick={() => act("add", item)} disabled={actionsDisabled || item.present}
                      busy={mutation.isPending && mutation.variables?.loanId === item.loan_id && mutation.variables?.action === "add"}>
                      Add
                    </PrimaryButton>
                    <PrimaryButton icon={Trash2} onClick={() => act("delete", item)} disabled={actionsDisabled || !item.present}
                      busy={mutation.isPending && mutation.variables?.loanId === item.loan_id && mutation.variables?.action === "delete"}>
                      Delete
                    </PrimaryButton>
                  </div>
                </Card>
            ))}
          </div>
        </section>
      )}

      {busy && <p role="status" className="text-xs" style={mutedFg}>Updating case data and refreshing pages…</p>}
        {notice && (
          <p role={notice.type === "error" ? "alert" : "status"} className="text-sm"
            style={{ color: notice.type === "error" ? "hsl(0, 72%, 48%)" : "hsl(142, 60%, 32%)" }}>
            {notice.text}
          </p>
        )}
    </div>
  );
}