"""Playwright fill for a local HTML document. Does not open job sites or click Submit."""

from urllib.parse import urlparse

from app.core.exceptions import JobSourceError
from app.schemas.application import ApprovedField, FillReport
from app.services.automation.form_filler import assert_no_submit_click, demo_form_html


async def fill_local_html(html: str, approved: list[ApprovedField]) -> FillReport:
    document = html.strip() or demo_form_html()
    if _is_remote_url(document):
        raise JobSourceError("Browser fill only accepts a local HTML form, not a job-site URL.")
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise JobSourceError("Playwright is not installed in this environment.") from exc

    wrote: list[ApprovedField] = []
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content(document)
        for field in approved:
            if "submit" in field.label.lower():
                continue
            locator = page.locator(f"label:has-text('{field.label}') input")
            if await locator.count() == 0:
                continue
            await locator.first.fill(field.value)
            wrote.append(field)
        await browser.close()
    assert_no_submit_click([])
    return FillReport(wrote=wrote, unmapped_required=[], submit_clicked=False, phase="awaiting_submit")


def _is_remote_url(value: str) -> bool:
    stripped = value.strip().lower()
    if not (stripped.startswith("http://") or stripped.startswith("https://")):
        return False
    host = urlparse(stripped).hostname or ""
    return host not in {"localhost", "127.0.0.1"}
