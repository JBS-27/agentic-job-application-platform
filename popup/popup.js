const statusEl = document.getElementById("status");
const countsEl = document.getElementById("counts");
const startBtn = document.getElementById("start");
const stopBtn = document.getElementById("stop");
const optionsBtn = document.getElementById("options");

function render(state) {
  const running = Boolean(state?.running);
  const status = state?.status || "Idle";
  statusEl.textContent = status;
  statusEl.className = "status";
  if (running) statusEl.classList.add("running");
  else if (/stop|error|login/i.test(status)) statusEl.classList.add("stopped");

  countsEl.textContent = `Applied ${state?.applied || 0} · Skipped ${state?.skipped || 0}`;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

async function refresh() {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  render(state);
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: "START" });
  await refresh();
});

stopBtn.addEventListener("click", async () => {
  stopBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: "STOP" });
  await refresh();
});

optionsBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.state) render(changes.state.newValue);
});

refresh();
