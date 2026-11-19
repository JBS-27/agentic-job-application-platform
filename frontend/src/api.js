const API = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api/v1";

export async function uploadResume(file) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch(`${API}/resume/upload`, { method: "POST", body });
  return read(response);
}

export async function startCampaign(payload) {
  const response = await fetch(`${API}/applications`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return read(response);
}

export async function decide(sessionId, decision, answers) {
  const response = await fetch(`${API}/applications/${sessionId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decision, answers }),
  });
  return read(response);
}

export async function fillSession(sessionId) {
  const response = await fetch(`${API}/applications/${sessionId}/fill`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ engine: "html" }),
  });
  return read(response);
}

export async function markSubmitted(sessionId) {
  const response = await fetch(`${API}/applications/${sessionId}/submitted`, { method: "POST" });
  return read(response);
}

async function read(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Request failed");
  }
  return data;
}
