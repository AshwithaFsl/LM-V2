# Data Management cases

Open **Build → Data Management**, select one case, and choose **Add to DB**.
Adding inserts the source MSP data, extracted documents, blank workflow stages,
and the servicing scenario in a single transaction. No existing loan is overwritten.

| Loan | Borrower | Preserved intake scenario |
| --- | --- | --- |
| 5550001001 | Amelia J. Carter | Clean package with two paystubs and a co-borrower |
| 5550001002 | Noah P. Bennett | MSP SSN 4421 versus document SSN 4412; identity review |
| 5550001003 | Grace L. Whitman | One paystub and the `only_one_paystub` flag |

`demo_cases.json` holds the supplied source values. `app/demo_cases.py` expands
shared fields and validates MSP, document, extraction-flag and servicing schemas.
The original document dates are preserved, not rebased to today's date. Expected
outcomes describe the intended scenarios; current rules and human decisions may
produce additional checks or holds. Auto-flow can advance cases beyond Intake;
otherwise run the stage manually. Nothing automatically approves an inbox item.

## Servicing data

All three cases include three `on_time` trial payment behaviors, completed ESCMOD
and PLNMTR tasks, an empty MES1 task list, closing-code dates, illustrative LSMR
terms, a 4.75% current note rate, and a neighbourhood document matching the loan.
The added servicing inputs do not repair Noah's SSN mismatch or Grace's missing
paystub and do not mark any stage completed.

Payments are **not inserted in advance** and no trial plan is pre-approved.
After the case reaches Trial Monitoring with an approved plan, the existing
servicer generates three payments at that plan's installment amounts and due
dates. Its simulated evaluation date advances through the final grace period,
so posted payment dates may be in the future relative to the machine clock.
Re-running the same plan replaces its generated payments rather than duplicating
them. This requires the existing `MOCK_SERVICER_ENABLED` setting to be enabled.
Frontend labels remain **Servicing data**; backend provenance is retained.

## API

- `GET /api/data-management/cases`: preset metadata, presence, current stage
  statuses, payment behaviors and live auto-flow state; no writes.
- `POST /api/data-management/cases/{loan_id}`: add a preset (201); existing case
  or a busy case returns 409. No request payload is needed.
- `DELETE /api/data-management/cases/{loan_id}`: remove the selected preset and
  its documents, servicing data, decisions, trial plans/installments, QC and run
  history (200). Missing case returns 404; queued/running cases return 409.

Only the three listed loan IDs are accepted; other IDs return 404. UI deletion
requires confirmation. Re-adding restores the original inputs, not prior history.
Mutations use the same per-loan in-process lock as the workflow engine and never
disable global auto-flow. This follows the application's single-process runner
architecture; distributed workers would need shared database/queue locking.
The application currently has no authentication boundary on its APIs. Keep this
demo management feature on a trusted local/development deployment; authentication
and authorization are required before exposing destructive APIs publicly.

API regression tests use the existing throwaway SQLite database and never the
configured application database. No cases are inserted just by opening this page
or starting the server; insertion requires **Add to DB**.