"""The supplied three SQL cases, expanded into validated ORM payloads.

Source dates and intake defects are preserved. Supplementary servicing inputs do
not pre-approve a plan or manufacture a completed stage: the existing servicer
posts payments from the approved plan only when Trial Monitoring executes.
"""

import json
from pathlib import Path

from .schemas.extracted_data import DocumentSet, ExtractionFlags
from .schemas.mock import MockLoanIn
from .schemas.msp import MspLoanIn

CATALOG = Path(__file__).resolve().parents[1] / "data" / "demo_cases.json"
ZERO_INCOME_TYPES = (
    "Self-employment income",
    "Unemployment benefit income",
    "Taxable Social Security/pension/disability/other public assistance",
    "Non-taxable Social Security or disability income",
    "Rental income",
    "Investment or insurance income",
)


def _case(raw: dict) -> dict:
    p = raw["profile"]
    loan_id, name = raw["loan_id"], raw["borrower_name"]
    coborrower = p["coborrower_name"]
    notes = ["Borrower submitted MAA,Paystubs,Credit Report,Bank Statement via email and They Are uploaded in MIR."]
    for role in (["Borrower", "Co Borrower"] if coborrower else ["Borrower"]):
        notes.extend([
            f"Income For {role} Income source: {p['employer']}. No other income.",
            f"Wage Paid Semi-Monthly For {role}",
            f"The Source Of {role} Wages Is {p['employer']}",
        ])

    # Import the exact supplied servicing values, rather than recalculating
    # seed terms. Approval later replaces live LSMR with the selected plan.
    servicing = MockLoanIn.model_validate(raw["servicing"]).model_dump(mode="json", exclude_none=True)
    supplemental = servicing["servicing_data"]
    msp = MspLoanIn.model_validate({
        "loan_id": loan_id, "borrower_name": name, "coborrower_name": coborrower,
        "borrower_ssn_last4": p["borrower_ssn_last4"], "coborrower_ssn_last4": p["coborrower_ssn_last4"],
        "property_address": p["address"], "mailing_address": p["address"], "loan_type": "Asset",
        "bankruptcy": {"status": "None"}, "foreclosure": {"status": "None"}, "hoa": p["hoa"],
        "servicing_data": {
            **supplemental,
            "ANA1": {"tax_bill_date": p["tax_bill_date"], "escrow_current": True,
                     "tax_bill_on_file": True, "escrow_payment_amount": p["escrow"]},
            "DLQ1": {**supplemental["DLQ1"], "due_date": p["due_date"], "loan_type": "Asset",
                     "upb_balance": p["upb"], "investor_type": "GSE", "property_state": p["state"],
                     "mailing_address": p["address"], "property_address": p["address"],
                     "months_delinquent": p["months_delinquent"], "number_of_borrowers": 2 if coborrower else 1},
            "HAZ1": p["insurance"],
            "LMT1": {"mod_status": None, "loan_type_status": "", "status_description": "Partially Claimed"},
            "LMT3": {**p["review_dates"], **supplemental["LMT3"]},
            "NOTS": {"notes": notes, "latest_note_date": p["latest_note_date"]},
            "USR2": {"status": "Partially-Claimed"},
        },
    }).model_dump(mode="json")
    screens = msp.pop("servicing_data")
    msp.update({code.lower(): value for code, value in screens.items()})

    docs = DocumentSet.model_validate({
        "application_form": {
            "type": "MAA", "borrower_name": name.upper(), "coborrower_name": coborrower.upper() if coborrower else None,
            "borrower_ssn_last4": p["document_ssn_last4"], "coborrower_ssn_last4": p["coborrower_ssn_last4"],
            "property_address": p["address"], "mailing_address": p["address"],
            "occupancy_status": "Primary residence; Owner occupied", "desired_workflow": "Keep the property",
            "hardship_reason": p["hardship"], "hardship_start_date": p["hardship_start"], "hoa_indicated": p["hoa"]["hoa_exists"],
            "income_sources": [
                {"type": "Gross wages/salaries/overtime/commissions/tips/bonuses", "gross_monthly_amount": p["monthly_income"]},
                *[{"type": kind, "gross_monthly_amount": 0} for kind in ZERO_INCOME_TYPES],
            ],
            "other_income_amount": 0, "other_income_description": None,
            "borrower_signature": True, "borrower_signature_date": p["signature_date"],
            "coborrower_signature": bool(coborrower), "coborrower_signature_date": p["signature_date"] if coborrower else None,
        },
        "paystubs": [{
            **stub, "employee_name": name, "employer_name": p["employer"], "employer_ein": p["employer_ein"],
            "pay_frequency": "Semi-Monthly", "gross_current_period": p["monthly_income"] / 2,
            "net_pay": p["net_pay"], "annual_salary": p["annual_salary"],
            "has_ytd_earnings": True, "has_variable_pay": False, "is_handwritten": False,
        } for stub in p["paystubs"]],
        "bank_statement": {**p["bank"], "account_holder_name": name, "coborrower_on_account": coborrower},
        "credit_report": {
            **p["credit"], "borrower_name": name, "coborrower_name": coborrower,
            "borrower_ssn_last4": p["document_ssn_last4"], "coborrower_ssn_last4": p["coborrower_ssn_last4"],
            "mortgage_balance": p["upb"], "total_debt": None, "revolving_utilization": None,
            "collections": 0, "derogatory_marks": 1, "public_records": 0, "hardship_reason": f"{p['hardship']} (per MAA)",
        },
        "letter_of_explanation": None,
        "neighbourhood_document": servicing["neighbourhood_document"],
    }).model_dump(mode="json")
    return {
        **{key: raw[key] for key in ("loan_id", "borrower_name", "scenario", "description", "expected_outcome")},
        "msp": msp,
        "documents": {"loan_id": loan_id, "extraction_status": "success",
                      "flags": ExtractionFlags(only_one_paystub=len(p["paystubs"]) == 1).model_dump(), **docs},
        "servicing": {key: servicing[key] for key in ("loan_id", "scenario", "trial_payments")},
        "servicing_description": "Three on-time payments, using approved trial amounts and due dates. "
                                 "Servicing tasks, closing dates, modification terms and neighbourhood document are included. "
                                 "Payments are posted when Trial Monitoring runs; earlier checks and approvals are still required.",
    }


def demo_cases() -> list[dict]:
    """Return fresh payloads so callers cannot mutate the reusable source catalog."""
    return [_case(raw) for raw in json.loads(CATALOG.read_text(encoding="utf-8"))["cases"]]