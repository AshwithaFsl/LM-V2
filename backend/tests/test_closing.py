"""Stage 5 · Final Underwriting & Closing, automated MOD QC and Final Mod verdicts."""

from datetime import datetime, timedelta, timezone

import pytest
import yaml
from sqlalchemy import select

from app import models
from app.core.database import SessionLocal
from app.engine import runner
from app.engine.nodes.closing import evaluate_verdict
from app.engine.playbook import HARNESS_DIR

from .conftest import LOAN

T0 = datetime(2026, 10, 30, 12, 0, tzinfo=timezone.utc)
@pytest.fixture()
def clock(monkeypatch):
    now = {"t": T0}
    monkeypatch.setattr(runner, "now_utc", lambda: now["t"])
    return now


@pytest.fixture()
def closing_case(loaded, clock):
    """Trial completed, every Final UW input on file and consistent with MSP."""
    with SessionLocal() as db:
        lm = db.get(models.LmStages, LOAN)
        lm.intake_status, lm.retention_eligibility_status = "Complete", "Facially Complete"
        lm.trial_uw_status, lm.trial_monitoring_status = "Ready", "Completed"
        msp = db.get(models.Msp, LOAN)
        msp.task1 = {"tasks": [{"task_id": "BKCASH", "status": "Completed"}, {"task_id": "OTHER", "status": "Open"}]}
        msp.mes1 = {"tasks": []}
        msp.lsmr = {"current_interest_rate": 4.5, "new_interest_rate": 4.0, "new_term_months": 480,
                    "new_principal_balance": 212400.0, "new_payment_amount": 1272.0}
        msp.lmt3 = {**(msp.lmt3 or {}), "x65_date": "2026-10-05", "e74_date": "2026-10-06", "j03_date": "2026-10-07",
                    "x58_date": "2026-10-08", "e68_date": "2026-10-09"}
        db.get(models.ExtractedData, LOAN).neighbourhood_document = {
            "document_date": "10/01/2026", "borrower_name": "TEST BORROWER", "property_address": msp.property_address,
            "upb": 212400.0, "prior_partial_claim_amounts": [1500.0]}
        db.add(models.TrialPlan(
            id="TP-QC-TEST", loan_id=LOAN, option_no=1, plan_type="test", plan_name="Approved test trial",
            status="approved", trial_payment=1657.0, principal_interest=1272.0, escrow_payment=385.0,
            interest_rate_pct=4.0, amortization_months=480, trial_duration_months=3, grace_period_days=15,
            first_due_date=T0.date(), upb_balance=212400.0, gross_monthly_income=5000.0,
            current_payment=1800.0, housing_ratio=33.14, payment_change_pct=None, conditions=[], reason_codes=[],
            calculation={}, created_at=T0, decided_at=T0, decided_by="tester"))
        db.commit()
    return loaded


def _run(db):
    wf = runner.start_workflow(db, LOAN)
    db.commit()
    return wf


def _pending(db):
    return db.scalar(select(models.Decision).where(models.Decision.stage_no == 5, models.Decision.status == "pending"))


def _decide(client, approved=True, **body):
    with SessionLocal() as db:
        d = _pending(db)
    r = client.post(f"/api/decisions/{d.id}/decide", json={"decision": "approved" if approved else "rejected", "note": "n", **body})
    assert r.status_code == 200, r.text
    return d


def _set_state(state):
    with SessionLocal() as db:
        msp = db.get(models.Msp, LOAN)
        msp.dlq1 = {**msp.dlq1, "property_state": state}
        db.commit()


def _run_final_mod(db):
    row = db.get(models.ClosingQc, LOAN) or models.ClosingQc(loan_id=LOAN)
    row.borrower_property_verified = True
    row.principal_matches_msp = True
    row.new_terms_match_plan = True
    row.mod_approved_at = T0
    db.add(row)
    return runner.run_stage(db, LOAN, 5, start_at="fm_trial_outcome")


def test_automatic_mod_qc_compares_pi_plus_escrow_totals(closing_case):
    with SessionLocal() as db:
        _run(db)
        run = db.scalar(select(models.AgentRun).where(models.AgentRun.stage_no == 5))
        uw = run.output["stage_report"]["uw_results"]
        assert {k: v["outcome"] for k, v in uw.items()} == {
            "hold_tasks": "pass", "scra": "pass", "neighbourhood": "pass", "lsmr_terms": "pass", "lmt3_dates": "pass", "handoff": "pass"}
        checks = run.output["stage_report"]["mod_qc"]["checks"]
        assert checks["borrower_property"]["status"] == "VERIFIED"
        assert all(field["status"] == "MATCHED" for field in checks["borrower_property"]["fields"])
        assert checks["principal_balance"]["status"] == "VERIFIED"
        assert [field["status"] for field in checks["new_terms"]["fields"]] == ["MATCHED"] * 4
        payment = checks["new_terms"]["fields"][-1]
        assert payment["left_value"] == {"principal_interest": 1272.0, "escrow_payment": 385.0, "total_payment": 1657.0}
        assert payment["right_value"] == {"principal_interest": 1272.0, "escrow_payment": 385.0, "total_payment": 1657.0}
        assert checks["new_terms"]["status"] == "VERIFIED"
        assert runner.stage_status(db, LOAN, 5) == "In Human Review"
        assert _pending(db).gate == "underwriting_sign_off"
        qc = db.get(models.ClosingQc, LOAN)
        assert qc.qc_by == "automated-mod-qc" and qc.borrower_property_verified is True
        assert qc.principal_matches_msp is True and qc.new_terms_match_plan is True


@pytest.mark.parametrize("field, update, expected", [
    ("borrower_name", "Different Borrower", "borrower_property"),
    ("property_address", "9 Other St", "borrower_property"),
])
def test_automatic_identity_comparison_reports_only_mismatched_field(closing_case, field, update, expected):
    with SessionLocal() as db:
        application = db.get(models.ExtractedData, LOAN).application_form
        db.get(models.ExtractedData, LOAN).application_form = {**application, field: update}
        db.commit()
        _run(db)
        run = db.scalar(select(models.AgentRun).where(models.AgentRun.stage_no == 5))
        identity = run.output["stage_report"]["mod_qc"]["checks"][expected]
        mismatches = [f for f in identity["fields"] if f["status"] == "MISMATCH"]
        assert identity["status"] == "MISMATCH_FOUND"
        assert len(mismatches) == 1 and mismatches[0]["left_value"] == update
        assert all(f["status"] == "MATCHED" for f in identity["fields"] if f is not mismatches[0])


@pytest.mark.parametrize("target, key, value", [
    ("principal", "new_principal_balance", 200000.0),
    ("lsmr", "new_interest_rate", 4.25),
    ("payment", "new_payment_amount", 1300.0),
])
def test_automatic_financial_comparisons_report_mismatches(closing_case, target, key, value):
    with SessionLocal() as db:
        msp = db.get(models.Msp, LOAN)
        msp.lsmr = {**msp.lsmr, key: value}
        db.commit()
        _run(db)
        run = db.scalar(select(models.AgentRun).where(models.AgentRun.stage_no == 5))
        checks = run.output["stage_report"]["mod_qc"]["checks"]
        group = checks["principal_balance" if target == "principal" else "new_terms"]
        assert group["status"] == "MISMATCH_FOUND"
        assert any(field["status"] == "MISMATCH" for field in group["fields"])


def test_automatic_mod_qc_marks_missing_sources_unable_to_verify(closing_case):
    with SessionLocal() as db:
        msp = db.get(models.Msp, LOAN)
        msp.lsmr = {**msp.lsmr, "new_interest_rate": None}
        extracted = db.get(models.ExtractedData, LOAN)
        extracted.application_form = {**extracted.application_form, "borrower_name": None}
        db.commit()
        _run(db)
        assert _pending(db).gate == "underwriting_team_lead"
    _decide(closing_case)
    with SessionLocal() as db:
        run = db.scalar(select(models.AgentRun).where(models.AgentRun.stage_no == 5))
        checks = run.output["stage_report"]["mod_qc"]["checks"]
        assert next(f for f in checks["borrower_property"]["fields"] if f["id"] == "borrower_name")["status"] == "UNABLE_TO_VERIFY"
        assert next(f for f in checks["new_terms"]["fields"] if f["id"] == "interest_rate_pct")["status"] == "UNABLE_TO_VERIFY"


def test_automatic_mod_qc_marks_missing_escrow_unable_to_verify(closing_case):
    with SessionLocal() as db:
        msp = db.get(models.Msp, LOAN)
        msp.ana1 = {**msp.ana1, "escrow_payment_amount": None}
        db.commit()
        _run(db)
        run = db.scalar(select(models.AgentRun).where(models.AgentRun.stage_no == 5))
        payment = run.output["stage_report"]["mod_qc"]["checks"]["new_terms"]["fields"][-1]
        assert payment["status"] == "UNABLE_TO_VERIFY"
        assert "MSP ANA1.escrow_payment_amount" in payment["reason"]
        assert payment["left_value"]["total_payment"] is None
        assert payment["right_value"]["total_payment"] == 1657.0
        assert runner.stage_status(db, LOAN, 5) == "Sign Off & In Progress"


def test_automatic_mod_qc_recheck_starts_at_qc_without_repeating_underwriting(closing_case):
    with SessionLocal() as db:
        msp = db.get(models.Msp, LOAN)
        msp.ana1 = {**msp.ana1, "escrow_payment_amount": None}
        db.commit()
        _run(db)
        assert runner.stage_status(db, LOAN, 5) == "Sign Off & In Progress"
        assert runner.entry_node(db, LOAN, 5) == "automated_mod_qc"
        msp.ana1 = {**msp.ana1, "escrow_payment_amount": 385.0}
        db.commit()
    assert closing_case.post(f"/api/processes/5/run", json={"loan_id": LOAN}).json()["queued"] == 1
    with SessionLocal() as db:
        runs = list(db.scalars(select(models.AgentRun).where(models.AgentRun.stage_no == 5)))
        rerun = next(run for run in runs if (run.input or {}).get("start_at") == "automated_mod_qc")
        assert rerun.input["start_at"] == "automated_mod_qc"
        assert rerun.status == "paused"
        assert rerun.output["paused_at"]["status"] == "In Human Review"
        assert _pending(db).gate == "underwriting_sign_off"
        assert not any(trace["node"].startswith("uw_") for trace in rerun.trace)


def test_final_mod_requires_completed_trial_monitoring(closing_case):
    with SessionLocal() as db:
        db.get(models.LmStages, LOAN).trial_monitoring_status = "Within Plan"
        db.commit()
        run = runner.run_stage(db, LOAN, 5)
        db.commit()
        assert run.status == "failed"
        assert "Trial Monitoring is Completed" in run.error


def test_recording_state_does_not_add_a_final_mod_check(closing_case, clock):
    _set_state("OH")
    with SessionLocal() as db:
        run = _run_final_mod(db)
        db.commit()
        assert runner.stage_status(db, LOAN, 5) == "Signed Off"
        assert run.output["stage_report"]["final_mod"]["facts"]["qc_complete"] is True
        assert set(run.output["stage_report"]["final_mod"]["checks"]) == {
            "trial_outcome", "borrower_property", "principal_balance", "new_terms",
        }


@pytest.mark.parametrize("recorded", (False, True))
def test_recording_and_elapsed_time_no_longer_change_verdict(closing_case, clock, recorded):
    _set_state("NY")
    clock["t"] = T0 + timedelta(days=20)
    with SessionLocal() as db:
        qc = db.get(models.ClosingQc, LOAN) or models.ClosingQc(loan_id=LOAN)
        qc.borrower_property_verified = True
        qc.principal_matches_msp = True
        qc.new_terms_match_plan = True
        qc.mod_approved_at = T0
        qc.recorded_date = (T0 + timedelta(days=19)).date() if recorded else None
        db.add(qc)
        run = runner.run_stage(db, LOAN, 5, start_at="fm_trial_outcome")
        db.commit()
        assert runner.stage_status(db, LOAN, 5) == "Signed Off"
        assert _pending(db) is None
        assert "recording_sla" not in run.output["stage_report"]["final_mod"]["checks"]


def test_open_hold_task_escalates_to_team_lead(closing_case):
    with SessionLocal() as db:
        msp = db.get(models.Msp, LOAN)
        msp.task1 = {"tasks": [{"task_id": "FCCOST", "status": "Open"}]}
        db.commit()
        _run(db)
        d = _pending(db)
        assert d.gate == "underwriting_team_lead" and d.team == "Team Lead" and "FCCOST" in d.reason
    _decide(closing_case)
    with SessionLocal() as db:
        assert _pending(db).gate == "underwriting_sign_off"
        assert runner.stage_status(db, LOAN, 5) == "In Human Review"


@pytest.mark.parametrize("change, key, outcome", [
    (lambda m, d: setattr(m, "lsmr", {**m.lsmr, "current_interest_rate": 5.5}), "scra", "review"),
    (lambda m, d: setattr(d, "neighbourhood_document", None), "neighbourhood", "hold"),
    (lambda m, d: setattr(d, "neighbourhood_document", {**d.neighbourhood_document, "document_date": "01/01/2025"}), "neighbourhood", "hold"),
    (lambda m, d: setattr(d, "neighbourhood_document", {**d.neighbourhood_document, "upb": 100.0}), "neighbourhood", "review"),
    (lambda m, d: setattr(m, "lsmr", {**m.lsmr, "new_term_months": None}), "lsmr_terms", "review"),
    (lambda m, d: setattr(m, "lmt3", {**m.lmt3, "e68_date": "2026-10-10"}), "lmt3_dates", "review"),  # Saturday
    (lambda m, d: setattr(m, "lmt3", {**m.lmt3, "j03_date": "2026-10-06"}), "lmt3_dates", "review"),  # not strictly after
    (lambda m, d: (setattr(m, "task1", None), setattr(m, "mes1", None)), "hold_tasks", "review"),
])
def test_each_underwriting_check(closing_case, change, key, outcome):
    with SessionLocal() as db:
        change(db.get(models.Msp, LOAN), db.get(models.ExtractedData, LOAN))
        db.commit()
        _run(db)
        run = db.scalar(select(models.AgentRun).where(models.AgentRun.stage_no == 5))
        assert run.output["stage_report"]["uw_results"][key]["outcome"] == outcome
        assert _pending(db).gate == "underwriting_team_lead"


def test_verdict_rules_first_match():
    rules = yaml.safe_load((HARNESS_DIR / "closing" / "rules.yaml").read_text(encoding="utf-8"))["final_mod_closing"]
    def checks(trial, recording, *qc):
        out = {"trial_outcome": {"status": trial, "tags": []}, "recording_sla": {"status": recording, "tags": []}}
        out.update({f"q{i}": {"status": s, "tags": ["qc"]} for i, s in enumerate(qc)})
        return out
    assert evaluate_verdict(checks("flagged", "flagged", "pass"), rules)[0] == "denied"
    assert evaluate_verdict(checks("pass", "flagged", "pass"), rules)[0] == "signed_off"
    assert evaluate_verdict(checks("pending", "pass", "pass", "skipped"), rules)[0] == "sign_off_in_progress"
    assert evaluate_verdict(checks("pass", "pass", "pass", "pass"), rules)[0] == "signed_off"
    assert evaluate_verdict(checks("pass", "pending", "pass", "pass"), rules)[0] == "signed_off"


def test_closing_record_validation(closing_case):
    assert closing_case.put(f"/api/cases/5/{LOAN}/closing-record", json={"recorded_date": "2026-10-30"}).status_code == 409  # not signed off
    assert closing_case.put(f"/api/cases/5/{LOAN}/closing-record", json={}).status_code == 422
    assert closing_case.put(f"/api/cases/5/{LOAN}/closing-record", json={"principal_matches_msp": True}).status_code == 422
    case = closing_case.get(f"/api/cases/5/{LOAN}").json()
    assert case["data"]["lsmr"]["new_term_months"] == 480 and case["data"]["tasks"]["TASK1"]
