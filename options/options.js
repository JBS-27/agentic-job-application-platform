const FIELDS = [
  "phone",
  "email",
  "city",
  "yearsExperience",
  "authorized",
  "sponsorship",
  "relocate",
  "commute",
  "salary",
  "website",
  "linkedinUrl",
  "hearAbout",
  "resumeText",
];

const customRoot = document.getElementById("custom");
const savedEl = document.getElementById("saved");

function addPair(question = "", answer = "") {
  const row = document.createElement("div");
  row.className = "pair";
  row.innerHTML = `
    <input class="q" placeholder="Question contains…" value="${escapeAttr(question)}" />
    <input class="a" placeholder="Answer" value="${escapeAttr(answer)}" />
    <button type="button" class="remove">Remove</button>
  `;
  row.querySelector(".remove").addEventListener("click", () => row.remove());
  customRoot.appendChild(row);
}

function escapeAttr(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

function readCustom() {
  return [...customRoot.querySelectorAll(".pair")]
    .map((row) => ({
      question: row.querySelector(".q").value.trim(),
      answer: row.querySelector(".a").value.trim(),
    }))
    .filter((row) => row.question && row.answer);
}

async function load() {
  const stored = await chrome.storage.local.get(["answers", "resumeText"]);
  const data = stored.answers || {};
  for (const key of FIELDS) {
    const el = document.getElementById(key);
    if (!el) continue;
    if (key === "resumeText") el.value = stored.resumeText || "";
    else if (data[key] != null) el.value = data[key];
  }
  customRoot.replaceChildren();
  (data.custom || []).forEach((row) => addPair(row.question, row.answer));
  if (!customRoot.children.length) addPair();
}

document.getElementById("addCustom").addEventListener("click", () => addPair());
document.getElementById("resetSetup").addEventListener("click", async () => {
  await chrome.storage.local.set({ setupComplete: false });
  savedEl.hidden = false;
  savedEl.textContent = "Setup will show again on next Start";
  setTimeout(() => {
    savedEl.hidden = true;
    savedEl.textContent = "Saved";
  }, 2000);
});

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const answers = { custom: readCustom() };
  for (const key of FIELDS) {
    if (key === "resumeText") continue;
    answers[key] = document.getElementById(key).value.trim();
  }
  await chrome.storage.local.set({
    answers,
    resumeText: document.getElementById("resumeText").value.trim(),
  });
  savedEl.hidden = false;
  setTimeout(() => {
    savedEl.hidden = true;
  }, 1600);
});

load();
