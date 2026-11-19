"""Fetch a public job page. Refuses private networks and non-http URLs."""

import ipaddress
import socket
from urllib.parse import urlparse

import httpx

from app.core.exceptions import JobSourceError
from app.utils.text_utils import html_to_text

_BLOCKED_HOSTS = {"localhost", "metadata.google.internal"}


async def fetch_job_text(url: str, *, timeout: float = 10.0) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise JobSourceError("Job URL must be an http or https address.")
    _reject_host(parsed.hostname)

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            response = await client.get(url, headers={"User-Agent": "job-application-platform/0.1"})
        except httpx.HTTPError as exc:
            raise JobSourceError("The job page could not be downloaded.") from exc

    final = urlparse(str(response.url))
    if final.hostname:
        _reject_host(final.hostname)
    if response.status_code >= 400:
        raise JobSourceError(f"The job page returned status {response.status_code}.")

    text = html_to_text(response.text[:500_000])
    if len(text) < 40:
        raise JobSourceError("The job page did not contain enough readable text. Paste the description instead.")
    return text[:20_000]


def _reject_host(hostname: str) -> None:
    host = hostname.lower().rstrip(".")
    if host in _BLOCKED_HOSTS or host.endswith(".local"):
        raise JobSourceError("That address is not allowed.")
    try:
        ipaddress.ip_address(host)
        addresses = [host]
    except ValueError:
        try:
            infos = socket.getaddrinfo(host, None)
        except socket.gaierror as exc:
            raise JobSourceError("Could not resolve that job URL.") from exc
        addresses = [info[4][0] for info in infos]
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise JobSourceError("That address is not allowed.")
