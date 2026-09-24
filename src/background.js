const DEFAULT_STATE = {
  running: false,
  status: "Idle",
  applied: 0,
  skipped: 0,
  lastError: "",
};

let pendingStartTabId = null;
let ignoreHideUntil = 0;

function allowHideStop() {
  return Date.now() >= ignoreHideUntil && !pendingStartTabId;
}

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(["state", "answers"]);
  if (!stored.state) {
    await chrome.storage.local.set({ state: { ...DEFAULT_STATE } });
  }
  if (!stored.answers) {
    await chrome.storage.local.set({
      answers: {
        phone: "",
        email: "",
        city: "",
        yearsExperience: "",
        authorized: "",
        sponsorship: "",
        relocate: "",
        commute: "",
        salary: "",
        website: "",
        linkedinUrl: "",
        hearAbout: "LinkedIn",
        custom: [],
      },
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: String(error) });
  });
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!pendingStartTabId || tabId !== pendingStartTabId) return;
  if (info.status !== "complete") return;
  if (!isLinkedInUrl(tab.url)) return;

  pendingStartTabId = null;
  await delay(800);
  await sendToTab(tabId, { type: "START" });
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case "GET_STATE":
      return chrome.storage.local.get(["state"]).then((data) => data.state || { ...DEFAULT_STATE });
    case "START":
      return startFromPopup();
    case "STOP":
      return stopAll(message.status);
    case "NAVIGATING":
      ignoreHideUntil = Date.now() + 8000;
      return { ok: true };
    case "OPEN_OPTIONS":
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case "STATE": {
      const current = (await chrome.storage.local.get(["state"])).state || {};
      await chrome.storage.local.set({
        state: {
          ...current,
          running: Boolean(message.running),
          status: message.status || "Idle",
          applied: Number(message.applied) || 0,
          skipped: Number(message.skipped) || 0,
          lastError: message.lastError || "",
        },
      });
      return { ok: true };
    }
    case "CONTENT_READY":
      if (sender.tab && sender.tab.id === pendingStartTabId) {
        pendingStartTabId = null;
        await sendToTab(sender.tab.id, { type: "START" });
      }
      return { ok: true };
    default:
      return { ok: false, error: "Unknown message" };
  }
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!(await isRunning()) || !allowHideStop()) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isLinkedInUrl(tab.url)) await stopAll("Stopped · left the LinkedIn tab");
  } catch {
    /* tab may already be gone */
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (!(await isRunning()) || !allowHideStop()) return;
  const tabs = await chrome.tabs.query({ url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] });
  if (!tabs.length || tabs.every((tab) => tab.id === tabId)) {
    await stopAll("Stopped · LinkedIn tab closed");
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (!(await isRunning()) || !allowHideStop()) return;
  if (windowId !== chrome.windows.WINDOW_ID_NONE) return;
  await delay(350);
  if (!(await isRunning()) || !allowHideStop()) return;
  const tabs = await chrome.tabs.query({ url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] });
  const stillVisible = tabs.some((tab) => !tab.discarded && tab.active);
  if (!stillVisible) await stopAll("Stopped · LinkedIn was minimized");
});

async function isRunning() {
  const { state } = await chrome.storage.local.get(["state"]);
  return Boolean(state?.running);
}

async function startFromPopup() {
  ignoreHideUntil = Date.now() + 4000;
  const tab = await getLinkedInTab();
  if (!tab) {
    const created = await chrome.tabs.create({
      url: "https://www.linkedin.com/jobs/",
      active: true,
    });
    pendingStartTabId = created.id;
    await chrome.storage.local.set({
      state: { ...DEFAULT_STATE, running: true, status: "Opening LinkedIn…" },
    });
    return { ok: true, opened: true };
  }

  await chrome.tabs.update(tab.id, { active: true });
  const sent = await sendToTab(tab.id, { type: "START" });
  if (!sent) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["src/brain.js", "src/content.js"],
    });
    await delay(400);
    await sendToTab(tab.id, { type: "START" });
  }
  return { ok: true };
}

async function stopAll(status = "Stopped") {
  pendingStartTabId = null;
  const state = (await chrome.storage.local.get(["state"])).state || { ...DEFAULT_STATE };
  await chrome.storage.local.set({
    state: { ...state, running: false, resume: false, status },
  });

  const tabs = await chrome.tabs.query({ url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] });
  await Promise.all(tabs.map((tab) => sendToTab(tab.id, { type: "STOP", status })));
  return { ok: true };
}

function isLinkedInUrl(url) {
  return Boolean(url && /^https:\/\/(www\.)?linkedin\.com\//i.test(url));
}

async function getLinkedInTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isLinkedInUrl(active?.url)) return active;

  const [any] = await chrome.tabs.query({ url: ["https://www.linkedin.com/*", "https://linkedin.com/*"] });
  return any || null;
}

async function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, () => {
        const failed = Boolean(chrome.runtime.lastError);
        resolve(!failed);
      });
    } catch {
      resolve(false);
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
