"""Map approved answers onto a local HTML form. Never clicks Submit."""

import re
from html import escape

from app.schemas.application import ApprovedField, FillReport

_SUBMIT = re.compile(r"submit|send application|apply now", re.I)


def fill_html(html: str, approved: list[ApprovedField]) -> tuple[str, FillReport]:
    """Rewrite input values in a copy of the HTML. Submit controls are left alone."""
    if not html.strip():
        html = demo_form_html()
    writes: list[ApprovedField] = []
    updated = html
    for field in approved:
        if _SUBMIT.search(field.label):
            continue
        updated, wrote = _write_labeled_input(updated, field)
        if wrote:
            writes.append(field)
    report = FillReport(wrote=writes, unmapped_required=[], submit_clicked=False, phase="awaiting_submit")
    return updated, report


def assert_no_submit_click(clicked_labels: list[str]) -> None:
    for label in clicked_labels:
        if _SUBMIT.search(label):
            raise RuntimeError("The filler tried to click submit.")


def demo_form_html() -> str:
    fields = [
        ("Full name", "text"),
        ("Email", "email"),
        ("Phone", "tel"),
        ("City", "text"),
        ("Years of experience", "text"),
        ("Technical skills", "text"),
    ]
    rows = []
    for label, kind in fields:
        rows.append(
            f"<label>{escape(label)}<input name=\"{escape(label)}\" type=\"{kind}\" /></label>"
        )
    return (
        "<form>"
        + "".join(rows)
        + "<button type=\"submit\">Submit</button></form>"
    )


def _write_labeled_input(html: str, field: ApprovedField) -> tuple[str, bool]:
    pattern = re.compile(
        rf"(<label>\s*{re.escape(field.label)}\s*<input\b[^>]*?)(/?>)",
        re.I,
    )
    match = pattern.search(html)
    if not match:
        return html, False
    tag = match.group(1)
    tag = re.sub(r"\svalue=\"[^\"]*\"", "", tag)
    replacement = f"{tag} value=\"{escape(field.value, quote=True)}\"{match.group(2)}"
    return html[: match.start()] + replacement + html[match.end() :], True
