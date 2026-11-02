const hiddenTrialUWStatuses = new Set(["UW In Progress", "Hold Docs Pending", "Hold Approval Pending"]);

export function processStatus(loan) {
  return loan.status ?? (loan.position === "waiting" ? "Waiting" : "Not reached");
}

export function processLoans(loans = [], filter = null) {
  return loans.filter((loan) => !filter || filter === "Reached"
    ? loan.position !== "not_reached"
    : processStatus(loan) === filter);
}

export function processSummary(stageNo, data) {
  const counts = Object.entries(data?.counts ?? {});
  return [
    ["Reached", processLoans(data?.loans).length],
    ...counts.filter(([status]) => status !== "Not reached" && status !== "Reached"
      && (stageNo !== 3 || !hiddenTrialUWStatuses.has(status))),
  ];
}