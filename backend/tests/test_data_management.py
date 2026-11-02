"""Preset case lifecycle, concurrency boundaries, and transactional cleanup."""

from datetime import date, datetime, timezone

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import IntegrityError

from app import models
from app.core.database import Base, SessionLocal, engine
from app.demo_cases import demo_cases
from app.engine import runner
from app.engine.mock_servicer import post_trial_payments
from app.engine.scheduler import auto_flow

from .conftest import LOAN

API = "/api/data-management/cases"
DEMO_IDS = ("5550001001", "5550001002", "5550001003")
PUBLIC_FIELDS = ("loan_id", "borrower_name", "scenario", "description", "expected_outcome", "servicing_description")
T0 = datetime(2026, 11, 2, 12, 0, tzinfo=timezone.utc)


def _snapshot(db):
    """Include every column and table, so no-overwrite/rollback tests catch partial changes."""
    return {
        table.name: [dict(row._mapping) for row in db.execute(select(table).order_by(*table.primary_key.columns))]
        for table in Base.metadata.sorted_tables
    }


def _history(loan_id):
    """Seed paused and completed history, standalone/NULL-loan agents, and trial facts."""
    with SessionLocal() as db:
        db.add_all([
            models.WorkflowRun(id=f"wf-{loan_id}", loan_id=loan_id, status="paused", started_at=T0),
            models.WorkflowRun(id=f"wf-old-{loan_id}", loan_id=loan_id, status="completed", started_at=T0),
        ])
        db.flush()
        db.add_all([
            models.AgentRun(id=f"ar-{loan_id}", loan_id=loan_id, workflow_run_id=f"wf-{loan_id}",
                            stage_no=3, agent_name="trial_uw", status="paused", started_at=T0),
            models.AgentRun(id=f"ar-standalone-{loan_id}", loan_id=loan_id, stage_no=1,
                            agent_name="intake", status="completed", started_at=T0),
            models.AgentRun(id=f"ar-null-{loan_id}", loan_id=None, workflow_run_id=f"wf-old-{loan_id}",
                            stage_no=1, agent_name="intake", status="completed", started_at=T0),
        ])
        db.flush()
        db.add(models.Decision(
            id=f"dc-{loan_id}", loan_id=loan_id, agent_run_id=f"ar-{loan_id}", workflow_run_id=f"wf-{loan_id}",
            stage_no=3, gate="underwriter_review", team="Human Underwriter", title="Review demo plan",
            reason="Needs approval", status="pending", created_at=T0,
        ))
        db.add(models.TrialPlan(
            id=f"tp-{loan_id}", loan_id=loan_id, agent_run_id=f"ar-{loan_id}", option_no=1,
            plan_type="modification", plan_name="Demo trial", status="proposed", trial_payment=1000.0,
            principal_interest=800.0, escrow_payment=200.0, interest_rate_pct=4.0, amortization_months=360,
            trial_duration_months=3, grace_period_days=15, first_due_date=date(2026, 12, 1),
            upb_balance=180000.0, gross_monthly_income=4000.0, housing_ratio=25.0, created_at=T0,
        ))
        db.flush()
        db.add(models.TrialInstallment(
            plan_id=f"tp-{loan_id}", installment_no=1, due_date=date(2026, 12, 1),
            grace_end_date=date(2026, 12, 16), expected_amount=1000.0,
        ))
        db.add(models.ClosingQc(loan_id=loan_id, qc_note="Keep only until demo deletion", updated_at=T0))
        stages = db.get(models.LmStages, loan_id)
        stages.intake_status = "Complete"
        stages.retention_eligibility_status = "Facially Complete"
        stages.trial_uw_status = "In Human Review"
        db.commit()


def test_list_returns_only_public_preset_metadata_without_writing(loaded, monkeypatch):
    live = {"enabled": False}
    monkeypatch.setattr(auto_flow, "status", lambda: live)
    with SessionLocal() as db:
        before = _snapshot(db)

    response = loaded.get(API)
    assert response.status_code == 200
    body = response.json()
    assert body["auto_flow_enabled"] is False
    assert {case["loan_id"] for case in body["cases"]} == set(DEMO_IDS)
    presets = {case["loan_id"]: case for case in demo_cases()}
    for case in body["cases"]:
        assert set(case) == set(PUBLIC_FIELDS) | {"trial_payments", "present", "stages"}
        assert {field: case[field] for field in PUBLIC_FIELDS} == {
            field: presets[case["loan_id"]][field] for field in PUBLIC_FIELDS
        }
        assert case["trial_payments"] == presets[case["loan_id"]]["servicing"]["trial_payments"]
        assert case["present"] is False
        assert case["stages"] == {stage.key: None for stage in models.STAGES}

    live["enabled"] = True
    assert loaded.get(API).json()["auto_flow_enabled"] is True
    with SessionLocal() as db:
        assert _snapshot(db) == before


@pytest.mark.parametrize("loan_id", DEMO_IDS)
def test_add_inserts_complete_preset_and_lists_live_stages(client, loan_id):
    case = next(case for case in demo_cases() if case["loan_id"] == loan_id)
    enabled = auto_flow.enabled
    before = datetime.now(timezone.utc)
    response = client.post(f"{API}/{loan_id}")
    after = datetime.now(timezone.utc)
    assert response.status_code == 201, response.text
    assert response.json()["loan_id"] == loan_id and response.json()["message"]
    assert auto_flow.enabled is enabled

    with SessionLocal() as db:
        for model, payload in ((models.Msp, case["msp"]), (models.ExtractedData, case["documents"]),
                               (models.MockServicing, case["servicing"])):
            row = db.get(model, loan_id)
            assert row is not None
            for field, value in payload.items():
                assert getattr(row, field) == value
        # SQLite drops timezone information; the application supplies UTC values.
        extracted_at = runner.as_utc(db.get(models.ExtractedData, loan_id).extracted_at)
        loaded_at = runner.as_utc(db.get(models.MockServicing, loan_id).loaded_at)
        assert before <= extracted_at <= after
        assert loaded_at == extracted_at
        stages = db.get(models.LmStages, loan_id)
        for stage in models.STAGES:
            assert getattr(stages, f"{stage.key}_status") is None
            assert getattr(stages, f"{stage.key}_remark") == ""
        assert db.scalar(select(models.WorkflowRun.id)) is None
        assert db.scalar(select(models.AgentRun.id)) is None
        stages.intake_status = "Complete"
        db.commit()

    listed = next(case for case in client.get(API).json()["cases"] if case["loan_id"] == loan_id)
    assert listed["present"] is True
    assert listed["stages"] == {stage.key: "Complete" if stage.no == 1 else None for stage in models.STAGES}


def test_duplicate_does_not_overwrite_existing_data_or_history(client):
    loan_id = DEMO_IDS[0]
    assert client.post(f"{API}/{loan_id}").status_code == 201
    _history(loan_id)
    with SessionLocal() as db:
        db.get(models.Msp, loan_id).borrower_name = "Do not overwrite"
        db.get(models.ExtractedData, loan_id).flags = {"manual_review": True}
        db.get(models.MockServicing, loan_id).trial_payments = ["missed"]
        db.commit()
        before = _snapshot(db)
    response = client.post(f"{API}/{loan_id}")
    assert response.status_code == 409
    with SessionLocal() as db:
        assert _snapshot(db) == before


@pytest.mark.parametrize("method", ("post", "delete"))
@pytest.mark.parametrize("loan_id", (LOAN, "5550001004", "unknown"))
def test_nonpreset_mutations_are_rejected_without_changes(loaded, method, loan_id):
    with SessionLocal() as db:
        before = _snapshot(db)
    response = getattr(loaded, method)(f"{API}/{loan_id}")
    assert response.status_code == 404
    with SessionLocal() as db:
        assert _snapshot(db) == before


def test_delete_missing_preset_is_404(client):
    assert client.delete(f"{API}/{DEMO_IDS[0]}").status_code == 404


def test_delete_removes_all_related_rows_and_histories_but_preserves_other_loans(loaded):
    _history(LOAN)
    assert loaded.post(f"{API}/{DEMO_IDS[1]}").status_code == 201
    _history(DEMO_IDS[1])
    with SessionLocal() as db:
        before = _snapshot(db)

    loan_id = DEMO_IDS[0]
    assert loaded.post(f"{API}/{loan_id}").status_code == 201
    _history(loan_id)
    enabled = auto_flow.enabled
    response = loaded.delete(f"{API}/{loan_id}")
    assert response.status_code == 200, response.text
    assert response.json()["loan_id"] == loan_id and response.json()["message"]
    assert auto_flow.enabled is enabled
    with SessionLocal() as db:
        # Includes standalone and NULL-loan agents, old workflows, pending decisions,
        # trial plans/installments, QC, documents, servicing and the root itself.
        assert _snapshot(db) == before
    listed = next(case for case in loaded.get(API).json()["cases"] if case["loan_id"] == loan_id)
    assert listed["present"] is False
    assert listed["stages"] == {stage.key: None for stage in models.STAGES}
    assert loaded.delete(f"{API}/{loan_id}").status_code == 404


@pytest.mark.parametrize("loan_id", DEMO_IDS)
def test_deleted_case_can_be_readded_from_pristine_preset(client, loan_id):
    assert client.post(f"{API}/{loan_id}").status_code == 201
    _history(loan_id)
    assert client.delete(f"{API}/{loan_id}").status_code == 200
    assert client.post(f"{API}/{loan_id}").status_code == 201
    with SessionLocal() as db:
        assert db.get(models.Msp, loan_id) is not None
        assert db.get(models.ExtractedData, loan_id) is not None
        assert db.get(models.MockServicing, loan_id) is not None
        stages = db.get(models.LmStages, loan_id)
        assert all(getattr(stages, f"{stage.key}_status") is None for stage in models.STAGES)
        for model in (models.Decision, models.TrialPlan, models.TrialInstallment, models.ClosingQc,
                      models.AgentRun, models.WorkflowRun):
            assert db.scalar(select(model)) is None


@pytest.mark.parametrize("method", ("post", "delete"))
def test_mutations_fail_immediately_when_loan_lock_is_held(client, monkeypatch, method):
    loan_id = DEMO_IDS[0]
    if method == "delete":
        assert client.post(f"{API}/{loan_id}").status_code == 201
    with SessionLocal() as db:
        before = _snapshot(db)

    # Assert nonblocking acquisition before touching the held real lock, so a
    # regression fails rather than hanging the test runner indefinitely.
    lock = runner.loan_lock(loan_id)

    class HeldLock:
        def acquire(self, blocking=True):
            assert blocking is False
            return lock.acquire(blocking=blocking)

        def release(self):
            pytest.fail("A failed acquisition must not release another caller's lock")

    with lock:
        with monkeypatch.context() as patch:
            patch.setattr(runner, "loan_lock", lambda requested: HeldLock() if requested == loan_id else None)
            response = getattr(client, method)(f"{API}/{loan_id}")
        assert response.status_code == 409
        assert lock.locked()
    with SessionLocal() as db:
        assert _snapshot(db) == before
    assert getattr(client, method)(f"{API}/{loan_id}").status_code == (201 if method == "post" else 200)


@pytest.mark.parametrize("kind", ("workflow", "agent", "linked_agent"))
@pytest.mark.parametrize("status", ("queued", "running"))
def test_delete_rejects_active_runs_and_releases_lock(client, kind, status):
    loan_id = DEMO_IDS[0]
    assert client.post(f"{API}/{loan_id}").status_code == 201
    _history(loan_id)
    model, run_id = {
        "workflow": (models.WorkflowRun, f"wf-{loan_id}"),
        "agent": (models.AgentRun, f"ar-standalone-{loan_id}"),
        "linked_agent": (models.AgentRun, f"ar-null-{loan_id}"),
    }[kind]
    with SessionLocal() as db:
        db.get(model, run_id).status = status
        db.commit()
        before = _snapshot(db)
    assert client.delete(f"{API}/{loan_id}").status_code == 409
    assert not runner.loan_lock(loan_id).locked()
    with SessionLocal() as db:
        assert _snapshot(db) == before
        db.get(model, run_id).status = "paused"
        db.commit()
    assert client.delete(f"{API}/{loan_id}").status_code == 200


@pytest.mark.parametrize("method, statement_prefix", (
    ("post", "INSERT INTO extracted_data"),
    ("post", "INSERT INTO mock_servicing"),
    ("delete", "DELETE FROM msp"),
))
def test_partial_integrity_failure_rolls_back_every_change_and_allows_retry(loaded, method, statement_prefix):
    loan_id = DEMO_IDS[0]
    if method == "delete":
        assert loaded.post(f"{API}/{loan_id}").status_code == 201
        _history(loan_id)
    with SessionLocal() as db:
        before = _snapshot(db)
    failed = []

    def fail_statement(conn, cursor, statement, parameters, context, executemany):
        if statement.startswith(statement_prefix):
            failed.append(statement)
            raise IntegrityError(statement, parameters, RuntimeError("Injected integrity failure"))

    # Only the existing throwaway test engine is used. Fail after an earlier
    # INSERT/DELETE succeeded, not before the transaction has done any work.
    event.listen(engine, "before_cursor_execute", fail_statement)
    try:
        response = getattr(loaded, method)(f"{API}/{loan_id}")
    finally:
        event.remove(engine, "before_cursor_execute", fail_statement)
    assert failed
    assert response.status_code == 409, response.text
    assert not runner.loan_lock(loan_id).locked()
    with SessionLocal() as db:
        assert _snapshot(db) == before
    assert getattr(loaded, method)(f"{API}/{loan_id}").status_code == (201 if method == "post" else 200)


def test_catalog_preserves_supplied_intake_defects_and_source_dates():
    amelia, noah, grace = demo_cases()
    assert amelia["msp"]["borrower_name"] == "Amelia J. Carter"
    assert amelia["msp"]["coborrower_name"] == "Owen R. Carter"
    assert amelia["documents"]["application_form"]["borrower_ssn_last4"] == "3141"
    assert len(amelia["documents"]["paystubs"]) == 2
    assert noah["msp"]["borrower_ssn_last4"] == "4421"
    assert noah["documents"]["application_form"]["borrower_ssn_last4"] == "4412"
    assert noah["documents"]["credit_report"]["borrower_ssn_last4"] == "4412"
    assert len(grace["documents"]["paystubs"]) == 1
    assert grace["documents"]["flags"]["only_one_paystub"] is True
    for case in (amelia, noah, grace):
        assert case["documents"]["paystubs"][-1]["pay_date"] == "10/01/2026"
        assert case["documents"]["letter_of_explanation"] is None
        assert case["msp"]["dlq1"]["payment_history"] is None
        assert case["msp"]["lmt3"]["review_start_date"] is not None
        assert case["msp"]["lmt3"]["x65_date"] == "2026-10-19"
        assert case["documents"]["neighbourhood_document"]["upb"] == case["msp"]["dlq1"]["upb_balance"]
        assert case["servicing"]["trial_payments"] == ["on_time"] * 3
    # Callers cannot corrupt the reusable source catalog.
    amelia["documents"]["paystubs"].clear()
    assert len(demo_cases()[0]["documents"]["paystubs"]) == 2


@pytest.mark.parametrize("loan_id, balance, payment", (
    ("5550001001", 268400.0, 1643.61),
    ("5550001002", 198750.0, 1217.09),
    ("5550001003", 156300.0, 957.14),
))
def test_added_servicing_matches_supplied_sql(client, loan_id, balance, payment):
    assert client.post(f"{API}/{loan_id}").status_code == 201
    with SessionLocal() as db:
        msp = db.get(models.Msp, loan_id)
        assert {key: msp.lsmr[key] for key in (
            "current_interest_rate", "new_interest_rate", "new_term_months",
            "new_principal_balance", "new_payment_amount",
        )} == {
            "current_interest_rate": 4.75, "new_interest_rate": 6.875, "new_term_months": 480,
            "new_principal_balance": balance, "new_payment_amount": payment,
        }
        assert msp.dlq1["interest_rate"] == 4.75
        assert msp.mes1 == {"tasks": []}
        assert msp.task1 == {"tasks": [
            {"task_id": "ESCMOD", "status": "Completed", "description": "Escrow modification",
             "opened_date": "2026-09-01", "completed_date": "2026-09-18"},
            {"task_id": "PLNMTR", "status": "Completed", "description": "Plan monitoring",
             "opened_date": "2026-09-01", "completed_date": "2026-09-25"},
        ]}
        assert [msp.lmt3[key] for key in ("x65_date", "e74_date", "j03_date", "x58_date", "e68_date")] == [
            "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23",
        ]
        assert db.get(models.ExtractedData, loan_id).neighbourhood_document == {
            "document_date": "09/15/2026", "borrower_name": msp.borrower_name,
            "property_address": msp.property_address, "upb": balance, "prior_partial_claim_amounts": [],
        }
        servicing = db.get(models.MockServicing, loan_id)
        assert servicing.scenario == "Trial complete; closing inputs clean"
        assert servicing.trial_payments == ["on_time"] * 3


@pytest.mark.parametrize("loan_id", DEMO_IDS)
def test_servicing_posts_three_plan_relative_payments_without_duplicates(client, loan_id):
    assert client.post(f"{API}/{loan_id}").status_code == 201
    plan = {"plan_id": f"TP-{loan_id}-test", "installments": [
        {"installment_no": i + 1, "due_date": due, "grace_end_date": grace, "expected_amount": 1234.56}
        for i, (due, grace) in enumerate([
            ("2026-12-01", "2026-12-16"), ("2027-01-01", "2027-01-16"), ("2027-02-01", "2027-02-16"),
        ])
    ]}
    with SessionLocal() as db:
        report = post_trial_payments(db, loan_id, plan)
        assert report["as_of"] == "2027-02-17"
        assert [p["payment_date"] for p in report["posted"]] == [i["due_date"] for i in plan["installments"]]
        assert all(p["amount"] == 1234.56 for p in report["posted"])
        post_trial_payments(db, loan_id, plan)
        history = db.get(models.Msp, loan_id).dlq1["payment_history"]
        assert len(history) == 3
        assert len({p["reference"] for p in history}) == 3
        # Demonstrates payment generation only; no stage is advanced or plan approved.
        assert db.get(models.LmStages, loan_id).trial_monitoring_status is None
