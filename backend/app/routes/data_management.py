"""Add and remove the three demo cases without changing other loans or auto-flow."""

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..core.database import get_db
from ..demo_cases import demo_cases
from ..engine import runner
from ..engine.scheduler import auto_flow

router = APIRouter(prefix="/api/data-management", tags=["data-management"])

# Keep the mutation boundary explicit even if the demo catalog grows later.
PRESET_IDS = frozenset(("5550001001", "5550001002", "5550001003"))
PUBLIC_FIELDS = ("loan_id", "borrower_name", "scenario", "description", "expected_outcome", "servicing_description")


def _preset(loan_id: str) -> dict:
    if loan_id in PRESET_IDS:
        for case in demo_cases():
            if case["loan_id"] == loan_id:
                return case
    raise HTTPException(status_code=404, detail="Demo case not found")


@contextmanager
def _mutation(db: Session, loan_id: str) -> Iterator[None]:
    lock = runner.loan_lock(loan_id)
    if not lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="Case is being processed; try again when it is idle")
    try:
        yield
        db.commit()
    except IntegrityError as err:
        db.rollback()
        raise HTTPException(status_code=409, detail="Case data changed or conflicts with existing records; refresh and try again") from err
    except Exception:
        db.rollback()
        raise
    finally:
        lock.release()


def _ensure_idle(db: Session, loan_id: str) -> None:
    # Paused runs are intentionally deletable, including their pending decisions.
    workflow_ids = select(models.WorkflowRun.id).where(models.WorkflowRun.loan_id == loan_id)
    active_workflow = db.scalar(select(models.WorkflowRun.id).where(
        models.WorkflowRun.loan_id == loan_id,
        models.WorkflowRun.status.in_(("queued", "running")),
    ).limit(1))
    active_agent = db.scalar(select(models.AgentRun.id).where(
        or_(models.AgentRun.loan_id == loan_id, models.AgentRun.workflow_run_id.in_(workflow_ids)),
        models.AgentRun.status.in_(("queued", "running")),
    ).limit(1))
    if active_workflow is not None or active_agent is not None:
        raise HTTPException(status_code=409, detail="Case has a queued or running workflow or agent run")


@router.get("/cases")
def list_cases(db: Session = Depends(get_db)) -> dict:
    cases = []
    for case in demo_cases():
        loan_id = case["loan_id"]
        if loan_id not in PRESET_IDS:
            continue
        present = db.get(models.Msp, loan_id) is not None
        stages = db.get(models.LmStages, loan_id) if present else None
        cases.append({
            **{field: case[field] for field in PUBLIC_FIELDS},
            "trial_payments": case["servicing"]["trial_payments"],
            "present": present,
            "stages": {stage.key: getattr(stages, f"{stage.key}_status") if stages else None for stage in models.STAGES},
        })
    return {"cases": cases, "auto_flow_enabled": bool(auto_flow.status()["enabled"])}


@router.post("/cases/{loan_id}", status_code=201)
def add_case(loan_id: str, db: Session = Depends(get_db)) -> dict:
    case = _preset(loan_id)
    with _mutation(db, loan_id):
        if db.get(models.Msp, loan_id) is not None:
            raise HTTPException(status_code=409, detail="Case already exists; existing data was not changed")
        _ensure_idle(db, loan_id)
        now = datetime.now(timezone.utc)
        db.add(models.Msp(**case["msp"]))
        db.flush()  # The root must exist before any dependent row is inserted.
        db.add_all([
            models.ExtractedData(**case["documents"], extracted_at=now),
            models.LmStages(loan_id=loan_id),
            models.MockServicing(**case["servicing"], loaded_at=now),
        ])
    return {"loan_id": loan_id, "message": f"Demo case {loan_id} added"}


@router.delete("/cases/{loan_id}")
def delete_case(loan_id: str, db: Session = Depends(get_db)) -> dict:
    _preset(loan_id)
    with _mutation(db, loan_id):
        if db.get(models.Msp, loan_id) is None:
            raise HTTPException(status_code=404, detail="Demo case is not present")
        _ensure_idle(db, loan_id)

        # Capture ownership before deleting anything. History uses SET NULL on the
        # loan FK, so deleting just MSP would leave orphaned workflow/agent runs.
        workflow_ids = list(db.scalars(select(models.WorkflowRun.id).where(models.WorkflowRun.loan_id == loan_id)))
        agent_ids = list(db.scalars(select(models.AgentRun.id).where(or_(
            models.AgentRun.loan_id == loan_id, models.AgentRun.workflow_run_id.in_(workflow_ids),
        ))))
        plan_ids = list(db.scalars(select(models.TrialPlan.id).where(models.TrialPlan.loan_id == loan_id)))

        # Explicit child-first deletes work even where FK cascades are disabled
        # (the existing SQLite test fixtures), and avoid ORM relationship nulling.
        db.execute(delete(models.Decision).where(or_(
            models.Decision.loan_id == loan_id,
            models.Decision.agent_run_id.in_(agent_ids),
            models.Decision.workflow_run_id.in_(workflow_ids),
        )))
        db.execute(delete(models.TrialInstallment).where(models.TrialInstallment.plan_id.in_(plan_ids)))
        db.execute(delete(models.TrialPlan).where(models.TrialPlan.loan_id == loan_id))
        for model in (models.ClosingQc, models.MockServicing, models.ExtractedData, models.LmStages):
            db.execute(delete(model).where(model.loan_id == loan_id))
        db.execute(delete(models.AgentRun).where(models.AgentRun.id.in_(agent_ids)))
        db.execute(delete(models.WorkflowRun).where(models.WorkflowRun.id.in_(workflow_ids)))
        db.execute(delete(models.Msp).where(models.Msp.loan_id == loan_id))
    return {"loan_id": loan_id, "message": f"Demo case {loan_id} and its related data and run history deleted"}
