(() => {
  function extensionAlive() {
    try {
      return Boolean(chrome?.runtime?.id);
    } catch {
      return false;
    }
  }

  function isInvalidContext(error) {
    return /extension context invalidated/i.test(String(error && (error.message || error)));
  }

  if (window.__easyApplyHelper?.retire) {
    try {
      window.__easyApplyHelper.retire();
    } catch {
      /* previous helper already dead */
    }
  }

  if (!extensionAlive()) return;

  const MAX_JOBS = 100;
  const ASK_IDLE_MS = 4000;
  const ASK_DROPDOWN_IDLE_MS = 5500;
  const MAX_STEPS = 12;
  const BETWEEN_JOBS_MS = [900, 1600];
  const REQUIRED_FIELDS = ["phone", "yearsExperience", "authorized", "sponsorship"];

  const state = {
    running: false,
    applied: 0,
    skipped: 0,
    processed: new Set(),
    answers: {},
    skillYears: {},
    resumeText: "",
    modalResolver: null,
    navigating: false,
    ignoreHideUntil: 0,
    hideTimer: 0,
    askIdleTimer: 0,
    askFocusTimer: 0,
    dead: false,
  };

  function retire() {
    state.dead = true;
    state.running = false;
    clearTimeout(state.hideTimer);
    clearTimeout(state.askIdleTimer);
    clearInterval(state.askFocusTimer);
    try {
      document.getElementById("eah-overlay")?.remove();
      document.getElementById("eah-ask")?.remove();
      document.getElementById("eah-setup")?.remove();
      document.getElementById("eah-details")?.remove();
    } catch {
      /* page may already be gone */
    }
  }

  window.__easyApplyHelper = { retire };

  window.addEventListener("unhandledrejection", (event) => {
    if (!isInvalidContext(event.reason)) return;
    event.preventDefault();
    retire();
  });
  window.addEventListener("error", (event) => {
    if (!isInvalidContext(event.error || event.message)) return;
    event.preventDefault();
    retire();
  });

  function swallowLastError() {
    try {
      void chrome.runtime.lastError;
    } catch {
      retire();
    }
  }

  function safeSend(message) {
    if (state.dead || !extensionAlive()) return;
    try {
      chrome.runtime.sendMessage(message, swallowLastError);
    } catch {
      retire();
    }
  }

  function storageGet(keys) {
    return new Promise((resolve) => {
      if (state.dead || !extensionAlive()) {
        resolve({});
        return;
      }
      try {
        chrome.storage.local.get(keys, (result) => {
          swallowLastError();
          resolve(result || {});
        });
      } catch {
        retire();
        resolve({});
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve) => {
      if (state.dead || !extensionAlive()) {
        resolve();
        return;
      }
      try {
        chrome.storage.local.set(value, () => {
          swallowLastError();
          resolve();
        });
      } catch {
        retire();
        resolve();
      }
    });
  }

  class StoppedError extends Error {
    constructor() {
      super("Stopped");
      this.name = "StoppedError";
    }
  }

  try {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (state.dead || !extensionAlive()) return;
      if (message.type === "START") {
        // Starting a job run should not leave the message response pending until it finishes.
        start().catch((error) => console.warn("Easy Apply helper", error));
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === "STOP") {
        stop(message.status || "Stopped");
        sendResponse({ ok: true });
      }
      return true;
    });
  } catch {
    retire();
    return;
  }

  safeSend({ type: "CONTENT_READY" });
  watchLinkedInVisibility();
  maybeResume();

  async function maybeResume() {
    const saved = (await storageGet(["state"])).state;
    if (saved?.running && saved.resume) start();
  }

  async function start() {
    if (state.running) return;
    // Claim the run before awaiting storage, so CONTENT_READY and START cannot race.
    state.running = true;
    const saved = (await storageGet(["state"])).state || {};
    const resuming = Boolean(saved.running && saved.resume);
    state.navigating = false;
    state.ignoreHideUntil = Date.now() + 2500;
    state.applied = resuming ? Number(saved.applied) || 0 : 0;
    state.skipped = resuming ? Number(saved.skipped) || 0 : 0;
    state.processed = new Set();
    const memory = await storageGet(["answers", "skillYears", "resumeText", "setupComplete"]);
    state.answers = memory.answers || {};
    state.skillYears = memory.skillYears || {};
    state.resumeText = memory.resumeText || "";
    await storageSet({
      state: {
        ...saved,
        running: true,
        resume: false,
        searchNavigationAttempted: resuming ? Boolean(saved.searchNavigationAttempted) : false,
      },
    });
    ensureOverlay();
    report("Checking LinkedIn login…");

    try {
      if (!isLoggedIn()) {
        stop("Log into LinkedIn first");
        return;
      }
      await dismissAll();
      if (!memory.setupComplete) {
        report("Review your details before Easy Apply");
        const confirmed = await showSetupPreview();
        if (!confirmed) {
          if (state.running) stop("Setup cancelled");
          return;
        }
      } else if (missingRequired(state.answers).length) {
        const filled = await askForMissingDetails(state.answers, missingRequired(state.answers));
        if (!filled) {
          if (state.running) stop("Details needed before Easy Apply");
          return;
        }
        state.answers = filled;
        await persistMemory();
      }
      await setPhase("jobs");
      report("Starting Easy Apply");
      const ready = await searchEasyApply();
      if (!ready) return;
      await applyLoop();
      if (state.running) {
        stop(state.applied + state.skipped >= MAX_JOBS ? "Done · reached 100" : "Done");
      }
    } catch (error) {
      if (error instanceof StoppedError) return;
      if (isInvalidContext(error)) {
        retire();
        return;
      }
      console.warn("Easy Apply helper", error);
      stop(error.message || "Error");
    }
  }

  function watchLinkedInVisibility() {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") scheduleHideStop();
      else clearTimeout(state.hideTimer);
    });
    window.addEventListener("pagehide", () => {
      if (!state.navigating) scheduleHideStop();
    });
  }

  function scheduleHideStop() {
    clearTimeout(state.hideTimer);
    state.hideTimer = setTimeout(() => {
      if (!state.running || state.navigating) return;
      if (Date.now() < state.ignoreHideUntil) return;
      if (document.visibilityState !== "hidden") return;
      stop("Stopped · LinkedIn was hidden");
    }, 280);
  }

  function stop(status) {
    state.running = false;
    state.navigating = false;
    clearTimeout(state.hideTimer);
    if (state.modalResolver) {
      const resolve = state.modalResolver;
      state.modalResolver = null;
      resolve(null);
    }
    removeDetailsForm();
    clearTimeout(state.askIdleTimer);
    clearInterval(state.askFocusTimer);
    qs("#eah-setup")?.remove();
    qs("#eah-ask")?.remove();
    report(status || "Stopped");
    const overlayStatus = document.getElementById("eah-status");
    if (overlayStatus) overlayStatus.textContent = status || "Stopped";
  }

  async function prepareAnswers() {
    assertRunning();
    report("Reading your LinkedIn profile…");

    if (!onOwnProfile()) {
      await navigateAndResume("https://www.linkedin.com/in/me/", {
        phase: "profile",
        status: "Opening your profile…",
      });
      return false;
    }

    await waitFor(() => Boolean(qs("main h1") || qs("h1")), 10000);
    await sleep(800);
    const existing = (await storageGet(["answers"])).answers || {};
    const scraped = await scrapeOwnProfile();
    const merged = mergeAnswers(existing, scraped);
    state.answers = merged;
    await storageSet({ answers: merged });

    const missing = missingRequired(merged);
    if (missing.length) {
      report("Fill the missing details to continue");
      const filled = await askForMissingDetails(merged, missing);
      if (!filled) {
        if (state.running) stop("Details needed before Easy Apply");
        return false;
      }
      state.answers = filled;
      await storageSet({ answers: filled });
    }

    await setPhase("jobs");
    report("Profile ready · starting Easy Apply");
    return true;
  }

  function mergeAnswers(existing, scraped) {
    const out = { ...(existing || {}) };
    for (const [key, value] of Object.entries(scraped || {})) {
      if (value && !String(out[key] || "").trim()) out[key] = String(value).trim();
    }
    if (out.fullName) {
      const parts = out.fullName.split(/\s+/).filter(Boolean);
      if (!out.firstName && parts[0]) out.firstName = parts[0];
      if (!out.lastName && parts.length > 1) out.lastName = parts.slice(1).join(" ");
    }
    if (!out.hearAbout) out.hearAbout = "LinkedIn";
    return out;
  }

  function missingRequired(answers) {
    return REQUIRED_FIELDS.filter((key) => !String(answers?.[key] || "").trim());
  }

  async function setPhase(phase) {
    const saved = (await storageGet(["state"])).state || {};
    await storageSet({
      state: { ...saved, running: true, resume: false, phase },
    });
  }

  function onOwnProfile() {
    if (/^\/in\/me\/?$/i.test(location.pathname)) return true;
    if (!/^\/in\//i.test(location.pathname)) return false;
    return Boolean(
      qs('a[href*="/edit/intro/"]') ||
        findByText(document, "button", ["Edit profile", "Add profile section", "Open to"]) ||
        findByText(document, "a", ["Edit profile", "Add profile section"])
    );
  }

  async function scrapeOwnProfile() {
    const data = {};
    const name = (qs("main h1") || qs("h1"))?.innerText?.trim();
    if (name) data.fullName = name.replace(/\s+/g, " ");

    const city = scrapeLocation();
    if (city) data.city = city;

    if (/^\/in\//i.test(location.pathname) && !/\/in\/me\/?$/i.test(location.pathname)) {
      data.linkedinUrl = `${location.origin}${location.pathname.replace(/\/$/, "")}`;
    }

    Object.assign(data, scrapeLooseContact(document.body.innerText || ""));

    const contactBtn =
      qs('a[href*="overlay/contact-info"]') ||
      qs("#top-card-text-details-contact-info") ||
      findByText(document, "a", ["Contact info"]) ||
      findByText(document, "button", ["Contact info"]);
    if (contactBtn) {
      click(contactBtn);
      const opened = await waitFor(() => contactModal(), 6000);
      if (opened) {
        await sleep(400);
        Object.assign(data, scrapeContactModal());
        closeContactModal();
        await sleep(350);
      }
    }

    if (!data.linkedinUrl) {
      const profileLink = qs('a[href*="linkedin.com/in/"]');
      if (profileLink?.href) data.linkedinUrl = profileLink.href.split("?")[0];
    }

    const years = await scrapeYearsExperience();
    if (years) data.yearsExperience = years;

    const site = scrapeWebsiteFromAbout();
    if (site && !data.website) data.website = site;

    return data;
  }

  function scrapeLocation() {
    const nodes = [
      ...document.querySelectorAll(
        ".pv-text-details__left-panel .text-body-small, span.text-body-small.inline, .text-body-small.t-black--light, span.t-black--light"
      ),
    ];
    for (const el of nodes) {
      const text = (el.innerText || "").split("·")[0].trim();
      if (!text || text.length > 80 || /@|connection|follower|contact|message/i.test(text)) continue;
      if (/,\s*\w/.test(text) || /\b(India|Remote|United|UK|USA|Canada|Germany|Singapore)\b/i.test(text)) {
        return text;
      }
    }
    return "";
  }

  function scrapeLooseContact(text) {
    const data = {};
    const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email) data.email = email[0];
    const phone = text.match(/(\+\d[\d\s().-]{8,}\d)/);
    if (phone) data.phone = phone[1].replace(/\s+/g, " ").trim();
    return data;
  }

  function contactModal() {
    return [...document.querySelectorAll('div[role="dialog"], dialog[open], .artdeco-modal')].find((el) =>
      /contact info|your profile|email|phone/i.test(el.innerText || "")
    );
  }

  function scrapeContactModal() {
    const modal = contactModal();
    if (!modal) return {};
    const data = {};
    const mail = modal.querySelector('a[href^="mailto:"]');
    if (mail) data.email = decodeURIComponent(mail.href.replace(/^mailto:/i, "")).split("?")[0];
    const tel = modal.querySelector('a[href^="tel:"]');
    if (tel) data.phone = (tel.innerText || tel.href.replace(/^tel:/i, "")).trim();
    const linkedin = [...modal.querySelectorAll('a[href*="linkedin.com/in/"]')][0];
    if (linkedin) data.linkedinUrl = linkedin.href.split("?")[0];
    const site = [...modal.querySelectorAll('a[href^="http"]')].find((a) => {
      const href = a.href || "";
      return !/linkedin\.com/i.test(href);
    });
    if (site) data.website = site.href;
    if (!data.phone || !data.email) {
      Object.assign(data, scrapeLooseContact(modal.innerText || ""));
    }
    return data;
  }

  function closeContactModal() {
    const modal = contactModal();
    if (!modal) return;
    const dismiss =
      modal.querySelector('button[aria-label*="Dismiss"]') ||
      modal.querySelector(".artdeco-modal__dismiss") ||
      findByText(modal, "button", ["Close", "Dismiss"]);
    if (dismiss) click(dismiss);
  }

  async function scrapeYearsExperience() {
    const experienceRoot =
      qs("#experience")?.closest("section") ||
      [...document.querySelectorAll("section")].find((section) =>
        /experience/i.test((section.querySelector("h2, h3")?.innerText || "").trim())
      );
    experienceRoot?.scrollIntoView({ block: "center" });
    await sleep(400);
    const text = (experienceRoot || document).innerText || "";
    const years = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)]
      .map((match) => Number(match[1]))
      .filter((year) => year >= 1985 && year <= new Date().getFullYear());
    if (years.length) {
      return String(Math.max(0, new Date().getFullYear() - Math.min(...years)));
    }
    const duration = text.match(/(\d+)\s*(?:yrs?|years?)/i);
    return duration ? duration[1] : "";
  }

  function scrapeWebsiteFromAbout() {
    const about =
      qs("#about")?.closest("section") ||
      [...document.querySelectorAll("section")].find((section) =>
        /^about$/i.test((section.querySelector("h2, h3")?.innerText || "").trim())
      );
    const link = [...(about || document).querySelectorAll('a[href^="http"]')].find(
      (a) => !/linkedin\.com/i.test(a.href)
    );
    return link?.href || "";
  }

  function askForMissingDetails(answers, missing) {
    return new Promise((resolve) => {
      state.modalResolver = (value) => {
        state.modalResolver = null;
        resolve(value);
      };
      renderDetailsForm(answers, missing, state.modalResolver);
    });
  }

  async function persistMemory(extra = {}) {
    await storageSet({
      answers: state.answers,
      skillYears: state.skillYears,
      resumeText: state.resumeText,
      ...extra,
    });
  }

  function removeDetailsForm() {
    qs("#eah-details")?.remove();
  }

  function renderDetailsForm(answers, missing, resolve) {
    removeDetailsForm();
    const missingSet = new Set(missing);
    const fields = [
      ["phone", "Phone", "tel"],
      ["email", "Email", "email"],
      ["city", "City", "text"],
      ["yearsExperience", "Years of experience", "text"],
      ["authorized", "Authorized to work", "select"],
      ["sponsorship", "Need visa sponsorship", "select"],
      ["relocate", "Willing to relocate", "select"],
      ["commute", "Comfortable commuting / on-site", "select"],
      ["salary", "Expected salary (optional)", "text"],
      ["website", "Website / portfolio", "url"],
      ["linkedinUrl", "LinkedIn URL", "url"],
    ];

    const box = document.createElement("div");
    box.id = "eah-details";
    box.innerHTML = `
      <div class="eah-card">
        <h2>Confirm your details</h2>
        <p>Values found on your LinkedIn profile are filled in. Anything LinkedIn does not show needs to be entered before Easy Apply starts.</p>
        <form id="eah-form"></form>
        <div class="eah-actions">
          <button type="submit" form="eah-form">Save and start</button>
          <button type="button" id="eah-cancel">Cancel</button>
        </div>
      </div>
    `;
    const form = box.querySelector("#eah-form");
    for (const [key, label, type] of fields) {
      const required = missingSet.has(key);
      const wrap = document.createElement("label");
      wrap.className = required ? "eah-missing" : "";
      const hint = answers[key]
        ? "From your LinkedIn profile or saved answers"
        : required
          ? "Not on your profile — required"
          : "Not on your profile";
      wrap.innerHTML =
        type === "select"
          ? `<span>${label}${required ? " *" : ""}</span><select name="${key}">
              <option value=""></option>
              <option>Yes</option>
              <option>No</option>
            </select><small>${hint}</small>`
          : `<span>${label}${required ? " *" : ""}</span><input name="${key}" type="${type}" /><small>${hint}</small>`;
      const input = wrap.querySelector("input, select");
      input.value = answers[key] || "";
      form.appendChild(wrap);
    }

    Object.assign(box.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(15, 20, 25, 0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    });

    const style = document.createElement("style");
    style.textContent = `
      #eah-details .eah-card { width: min(520px, 100%); max-height: 90vh; overflow: auto; background: #fff; color: #1b1f23; border-radius: 12px; padding: 20px 22px; font: 14px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; box-shadow: 0 16px 40px rgba(0,0,0,.25); }
      #eah-details h2 { margin: 0 0 6px; font-size: 18px; }
      #eah-details p { margin: 0 0 14px; color: #5e6b73; }
      #eah-details label { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; font-weight: 650; font-size: 12px; }
      #eah-details label.eah-missing span { color: #b24020; }
      #eah-details input, #eah-details select { font: 14px/1.4 inherit; font-weight: 400; padding: 8px 10px; border: 1px solid #d5dee4; border-radius: 8px; }
      #eah-details small { font-weight: 400; color: #5e6b73; }
      #eah-details .eah-actions { display: flex; gap: 8px; margin-top: 14px; }
      #eah-details button { border: 0; border-radius: 8px; padding: 10px 12px; font: inherit; font-weight: 650; cursor: pointer; }
      #eah-details button[type="submit"] { background: #0a66c2; color: #fff; }
      #eah-details #eah-cancel { background: #fff; border: 1px solid #d5dee4; }
    `;
    box.appendChild(style);
    document.documentElement.appendChild(box);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const next = { ...answers };
      for (const [key] of fields) {
        next[key] = String(new FormData(form).get(key) || "").trim();
      }
      const stillMissing = missingRequired(next);
      if (stillMissing.length) {
        form.querySelector(`[name="${stillMissing[0]}"]`)?.focus();
        return;
      }
      removeDetailsForm();
      resolve(next);
    });
    box.querySelector("#eah-cancel").addEventListener("click", () => {
      removeDetailsForm();
      resolve(null);
    });
  }

  function waitForModal() {
    return new Promise((resolve) => {
      state.modalResolver = (value) => {
        state.modalResolver = null;
        resolve(value);
      };
    });
  }

  async function showSetupPreview() {
    qs("#eah-setup")?.remove();
    const brain = getBrain();
    const box = document.createElement("div");
    box.id = "eah-setup";
    box.innerHTML = `
      <div class="eah-card">
        <h2>Preview before Easy Apply</h2>
        <p>Upload or paste your resume once. We fill what we can. Confirm the preview, then automation starts. New questions during apply are asked only once and remembered.</p>
        <label>Resume (PDF or TXT)
          <input id="eah-resume-file" type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" />
        </label>
        <label>Or paste resume text
          <textarea id="eah-resume-text" rows="5" placeholder="Paste resume text if PDF cannot be read"></textarea>
        </label>
        <p id="eah-resume-status" class="eah-note">No resume loaded yet.</p>
        <form id="eah-setup-form"></form>
        <div id="eah-skills"></div>
        <div class="eah-actions">
          <button type="submit" form="eah-setup-form">Looks good, start Easy Apply</button>
          <button type="button" id="eah-setup-cancel">Cancel</button>
        </div>
      </div>
    `;
    styleHost(box);
    document.documentElement.appendChild(box);

    const form = box.querySelector("#eah-setup-form");
    const fields = [
      ["phone", "Phone *", "tel"],
      ["email", "Email", "email"],
      ["city", "City", "text"],
      ["yearsExperience", "Overall years of experience *", "text"],
      ["authorized", "Authorized to work *", "select"],
      ["sponsorship", "Need visa sponsorship *", "select"],
      ["relocate", "Willing to relocate", "select"],
      ["commute", "Comfortable commuting to the job location", "select"],
      ["salary", "Expected salary", "text"],
      ["website", "Website / portfolio", "url"],
      ["linkedinUrl", "LinkedIn URL", "url"],
    ];
    for (const [key, label, type] of fields) {
      const wrap = document.createElement("label");
      wrap.innerHTML =
        type === "select"
          ? `<span>${label}</span><select name="${key}"><option value=""></option><option>Yes</option><option>No</option></select>`
          : `<span>${label}</span><input name="${key}" type="${type}" />`;
      wrap.querySelector("input, select").value = state.answers[key] || "";
      form.appendChild(wrap);
    }
    box.querySelector("#eah-resume-text").value = state.resumeText || "";
    renderSkillEditor(box.querySelector("#eah-skills"), state.skillYears);
    if (state.resumeText) {
      box.querySelector("#eah-resume-status").textContent = "Using the resume saved from last time.";
    }

    const applyParsed = (parsed) => {
      state.resumeText = parsed.resumeText || state.resumeText;
      state.skillYears = { ...state.skillYears, ...(parsed.skillYears || {}) };
      state.answers = mergeAnswers(state.answers, parsed);
      for (const [key] of fields) {
        const el = form.querySelector(`[name="${key}"]`);
        if (el && parsed[key]) el.value = parsed[key];
      }
      renderSkillEditor(box.querySelector("#eah-skills"), state.skillYears);
      box.querySelector("#eah-resume-status").textContent = parsed.resumeText
        ? `Resume read · ${parsed.resumeText.split(/\s+/).length} words`
        : "Could not read that file. Paste the text instead.";
    };

    box.querySelector("#eah-resume-file").addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const text = await brain.readResumeFile(file);
      box.querySelector("#eah-resume-text").value = text;
      applyParsed(brain.parseResume(text));
    });
    box.querySelector("#eah-resume-text").addEventListener("change", (event) => {
      applyParsed(brain.parseResume(event.target.value));
    });

    const pending = waitForModal();
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const next = { ...state.answers };
      for (const [key] of fields) next[key] = String(new FormData(form).get(key) || "").trim();
      next.custom = state.answers.custom || [];
      if (missingRequired(next).length) {
        form.querySelector(`[name="${missingRequired(next)[0]}"]`)?.focus();
        return;
      }
      state.answers = next;
      state.resumeText = box.querySelector("#eah-resume-text").value.trim();
      state.skillYears = readSkillEditor(box.querySelector("#eah-skills"));
      await persistMemory({ setupComplete: true });
      box.remove();
      state.modalResolver?.(state.answers);
    });
    box.querySelector("#eah-setup-cancel").addEventListener("click", () => {
      box.remove();
      state.modalResolver?.(null);
    });
    return pending;
  }

  function renderSkillEditor(root, skillYears) {
    const rows = Object.entries(skillYears || {}).slice(0, 12);
    root.innerHTML = `<h3>Skill years from resume</h3>
      <p class="eah-note">Used for questions like “How many years … with AI?”. Edit if needed.</p>
      ${rows.length ? rows.map(([skill, years]) => `<div class="eah-skill"><input class="s" value="${escapeHtml(skill)}" /><input class="y" value="${escapeHtml(years)}" /></div>`).join("") : "<p class='eah-note'>No skill years found yet. They will be added when a new question is answered.</p>"}
      <button type="button" id="eah-add-skill" class="eah-secondary">Add skill</button>`;
    root.querySelector("#eah-add-skill")?.addEventListener("click", () => {
      const data = readSkillEditor(root);
      data[""] = "";
      renderSkillEditor(root, data);
    });
  }

  function readSkillEditor(root) {
    const data = {};
    for (const row of root.querySelectorAll(".eah-skill")) {
      const skill = row.querySelector(".s").value.trim().toLowerCase();
      const years = row.querySelector(".y").value.trim();
      if (skill && years) data[skill] = years;
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  }

  function styleHost(box) {
    Object.assign(box.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      background: "rgba(15, 20, 25, 0.45)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    });
    const style = document.createElement("style");
    style.textContent = `
      #eah-setup .eah-card, #eah-ask .eah-card { width: min(560px, 100%); max-height: 92vh; overflow: auto; background: #fff; color: #1b1f23; border-radius: 12px; padding: 20px 22px; font: 14px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; box-shadow: 0 16px 40px rgba(0,0,0,.25); }
      #eah-setup h2, #eah-ask h2, #eah-setup h3 { margin: 0 0 6px; }
      #eah-setup p, #eah-ask p, .eah-note { color: #5e6b73; margin: 0 0 12px; }
      #eah-setup label, #eah-ask label { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; font-weight: 650; font-size: 12px; }
      #eah-setup input, #eah-setup select, #eah-setup textarea, #eah-ask input, #eah-ask select { font: 14px/1.4 inherit; font-weight: 400; padding: 8px 10px; border: 1px solid #d5dee4; border-radius: 8px; }
      #eah-setup .eah-actions, #eah-ask .eah-actions { display: flex; gap: 8px; margin-top: 14px; }
      #eah-setup button, #eah-ask button { border: 0; border-radius: 8px; padding: 10px 12px; font: inherit; font-weight: 650; cursor: pointer; }
      #eah-setup button[type="submit"], #eah-ask button[type="submit"] { background: #0a66c2; color: #fff; }
      #eah-setup-cancel, #eah-ask-skip { background: #fff; border: 1px solid #d5dee4; }
      .eah-secondary { background: #fff; border: 1px solid #d5dee4; margin-top: 8px; }
      .eah-skill { display: grid; grid-template-columns: 1fr 90px; gap: 8px; margin: 6px 0; }
    `;
    box.appendChild(style);
  }

  function getBrain() {
    if (window.EasyApplyBrain) return window.EasyApplyBrain;
    return {
      inferAnswer: () => ({ value: "" }),
      remember: (_label, _answer, answers, skillYears) => ({ answers, skillYears }),
      normalize,
      cleanQuestion: (value) => String(value || "").replace(/\*/g, "").replace(/\s+/g, " ").trim(),
      isYearsQuestion: (label) => /year/i.test(label) && /experience|work|skill/i.test(label),
      isYesNoQuestion: (label) => /^(are|do|have|will|can|would|is)\b/i.test(label),
      extractSkillFromQuestion: () => "",
      lookupSkillYears: () => "",
      parseResume: (text) => ({ resumeText: text, skillYears: {} }),
      readResumeFile: (file) => (file ? file.text() : Promise.resolve("")),
    };
  }

  async function askUnknownQuestions(unknowns) {
    qs("#eah-ask")?.remove();
    clearTimeout(state.askIdleTimer);
    const brain = getBrain();
    const frame = document.createElement("iframe");
    frame.id = "eah-ask";
    frame.setAttribute("allow", "clipboard-write");
    Object.assign(frame.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      width: "100vw",
      height: "100vh",
      border: "0",
      background: "transparent",
    });
    document.documentElement.appendChild(frame);

    const doc = frame.contentDocument;
    if (!doc) {
      frame.remove();
      return false;
    }

    const fields = unknowns
      .map((item, index) => {
        const suggestion = escapeHtml(item.suggestion || "");
        const label = escapeHtml(item.label);
        const hint = item.skill ? `Skill: ${escapeHtml(item.skill)}` : "Saved after you continue";
        if (item.kind === "yesno") {
          return `<label><span>${label}</span>
            <select name="q${index}" required>
              <option value=""></option>
              <option ${item.suggestion === "Yes" ? "selected" : ""}>Yes</option>
              <option ${item.suggestion === "No" ? "selected" : ""}>No</option>
            </select><small>${hint}</small></label>`;
        }
        return `<label><span>${label}</span>
          <input name="q${index}" type="${item.kind === "years" ? "number" : "text"}" min="0" step="1" value="${suggestion}" autocomplete="off" />
          <small>${hint}</small></label>`;
      })
      .join("");

    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8" />
      <style>
        html, body { margin: 0; height: 100%; background: rgba(15,20,25,.45); font: 14px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; }
        body { display: flex; align-items: center; justify-content: center; padding: 20px; }
        .card { width: min(560px, 100%); background: #fff; color: #1b1f23; border-radius: 12px; padding: 20px 22px; box-shadow: 0 16px 40px rgba(0,0,0,.25); }
        h2 { margin: 0 0 6px; font-size: 18px; }
        p { margin: 0 0 12px; color: #5e6b73; }
        label { display: flex; flex-direction: column; gap: 4px; margin: 10px 0; font-weight: 650; font-size: 12px; }
        input, select { font: 14px/1.4 inherit; font-weight: 400; padding: 10px 12px; border: 1px solid #d5dee4; border-radius: 8px; }
        small { font-weight: 400; color: #5e6b73; }
        .actions { display: flex; gap: 8px; margin-top: 14px; }
        button { border: 0; border-radius: 8px; padding: 10px 12px; font: inherit; font-weight: 650; cursor: pointer; }
        button[type="submit"] { background: #0a66c2; color: #fff; }
        #skip { background: #fff; border: 1px solid #d5dee4; }
      </style></head><body>
        <div class="card">
          <h2>New question — answer once</h2>
          <p>${unknowns.some((item) => item.kind === "yesno") ? "Dropdown questions wait 5 seconds so you can read the options. If nothing is chosen, this job is skipped." : "Type in the box below. If nothing is typed for 4 seconds, this job is skipped."}</p>
          <form id="form">${fields}
            <div class="actions">
              <button type="submit">Save and continue</button>
              <button type="button" id="skip">Skip this job</button>
            </div>
          </form>
        </div>
      </body></html>`);
    doc.close();

    const form = doc.getElementById("form");
    const firstField = form.querySelector("input, select");
    report("Waiting for a new question…");

    const finish = (value) => {
      clearTimeout(state.askIdleTimer);
      clearInterval(state.askFocusTimer);
      if (frame.isConnected) frame.remove();
      state.modalResolver?.(value);
    };

    const idleMsFor = (target) => {
      const field = target && target.tagName ? target : doc.activeElement;
      if (field?.tagName === "SELECT" || unknowns.some((item) => item.kind === "yesno")) {
        return ASK_DROPDOWN_IDLE_MS;
      }
      return ASK_IDLE_MS;
    };

    const bumpIdle = (event) => {
      clearTimeout(state.askIdleTimer);
      const wait = idleMsFor(event?.target);
      state.askIdleTimer = setTimeout(() => {
        if (!state.running || !frame.isConnected) return;
        report("No answer · skipped this job");
        finish(false);
      }, wait);
    };

    const pending = waitForModal();
    form.addEventListener("keydown", (event) => {
      event.stopPropagation();
      bumpIdle(event);
    });
    form.addEventListener("keyup", (event) => {
      event.stopPropagation();
      bumpIdle(event);
    });
    form.addEventListener("input", bumpIdle);
    form.addEventListener("mousedown", bumpIdle);
    form.addEventListener("focusin", bumpIdle);
    form.addEventListener("change", bumpIdle);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      unknowns.forEach((item, index) => {
        const value = String(data.get(`q${index}`) || "").trim();
        if (!value) return;
        const remembered = brain.remember(item.label, value, state.answers, state.skillYears);
        state.answers = remembered.answers;
        state.skillYears = remembered.skillYears;
      });
      await persistMemory();
      finish(true);
    });
    doc.getElementById("skip").addEventListener("click", () => finish(false));

    state.askFocusTimer = setInterval(() => {
      if (!frame.isConnected) {
        clearInterval(state.askFocusTimer);
        return;
      }
      try {
        const active = doc.activeElement;
        if (active?.tagName === "SELECT") return;
        if (active !== firstField && !form.contains(active)) firstField?.focus();
      } catch {
        /* iframe may already be gone */
      }
    }, 400);

    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        firstField?.focus();
        firstField?.select?.();
      } catch {
        /* ignore */
      }
    }, 50);
    bumpIdle();
    return pending;
  }

  async function searchEasyApply() {
    assertRunning();
    report("Opening Easy Apply jobs…");
    await dismissAll();
    const searchNavigationAttempted = Boolean((await storageGet(["state"])).state?.searchNavigationAttempted);

    if (onJobsSearch() && jobCards().length) {
      await enableEasyApplyFilter();
      await dismissAll();
      report(`Found ${jobCards().length} jobs`);
      return true;
    }

    if (!onJobsSearch()) {
      if (searchNavigationAttempted) {
        stop("Could not open Easy Apply job search");
        return false;
      }
      await navigateAndResume("https://www.linkedin.com/jobs/search/?f_AL=true", {
        phase: "jobs",
        status: "Opening Easy Apply jobs…",
        searchNavigationAttempted: true,
      });
      return false;
    }

    await enableEasyApplyFilter();
    await sleep(800);
    if (!jobCards().length && !/[?&]f_AL=true/i.test(location.search) && !searchNavigationAttempted) {
      await navigateAndResume("https://www.linkedin.com/jobs/search/?f_AL=true", {
        phase: "jobs",
        status: "Opening Easy Apply jobs…",
        searchNavigationAttempted: true,
      });
      return false;
    }

    const found = await waitFor(() => jobCards().length > 0, 12000);
    if (!found) {
      stop("No Easy Apply jobs on this page");
      return false;
    }
    report(`Found ${jobCards().length} jobs`);
    return true;
  }

  async function typeIntoSearch(text) {
    const input = firstVisible([
      "input.jobs-search-box__text-input",
      'input[aria-label*="Search by title"]',
      'input[aria-label*="Search job titles"]',
      'input[id*="jobs-search-box-keyword"]',
      "input.search-global-typeahead__input",
      'input[placeholder="Search"]',
      'input[aria-label="Search"]',
    ]);
    if (!input) return false;

    click(input);
    await sleep(250);
    setReactValue(input, "");
    await sleep(120);
    setReactValue(input, text);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));

    const form = input.closest("form");
    const searchBtn =
      form?.querySelector('button[type="submit"]') ||
      findByText(document, "button", ["Search"]);
    if (searchBtn) click(searchBtn);
    else input.form?.requestSubmit?.();

    return true;
  }

  async function enableEasyApplyFilter() {
    const already =
      qs('button[aria-pressed="true"][aria-label*="Easy Apply"]') ||
      [...document.querySelectorAll("button")].find((btn) => {
        const text = (btn.innerText || "").trim();
        return /easy apply/i.test(text) && (btn.getAttribute("aria-checked") === "true" || btn.getAttribute("aria-pressed") === "true");
      });
    if (already) return;

    const pill = [...document.querySelectorAll("button, label")].find((el) => {
      const label = `${el.getAttribute("aria-label") || ""} ${el.innerText || ""}`;
      return /easy apply/i.test(label) && visible(el) && !el.classList.contains("jobs-apply-button");
    });
    if (pill) {
      click(pill);
      await sleep(900);
    }
  }

  async function navigateAndResume(url, extra = {}) {
    state.navigating = true;
    state.ignoreHideUntil = Date.now() + 8000;
    safeSend({ type: "NAVIGATING" });
    const saved = (await storageGet(["state"])).state || {};
    await storageSet({
      state: {
        ...saved,
        running: true,
        resume: true,
        applied: state.applied,
        skipped: state.skipped,
        status: extra.status || "Opening LinkedIn…",
        phase: extra.phase || saved.phase || "jobs",
        searchNavigationAttempted: Boolean(extra.searchNavigationAttempted || saved.searchNavigationAttempted),
      },
    });
    location.assign(url);
  }

  async function applyLoop() {
    let page = 1;
    while (state.running && state.applied + state.skipped < MAX_JOBS) {
      assertRunning();
      if (securityWall()) {
        stop("LinkedIn asked for a security check");
        return;
      }
      await dismissAll();
      await scrollJobList();
      const cards = unseenCards();
      if (!cards.length) {
        if (await goNextPage(page + 1)) {
          page += 1;
          await sleep(1200);
          continue;
        }
        break;
      }

      for (const card of cards) {
        assertRunning();
        if (state.applied + state.skipped >= MAX_JOBS) break;
        const id = jobId(card);
        if (id) state.processed.add(id);
        await handleCard(card);
        await sleep(rand(...BETWEEN_JOBS_MS));
      }
    }
  }

  async function handleCard(card) {
    await dismissAll();
    const title = (card.innerText || "").split("\n").filter(Boolean)[0] || "job";
    report(`Opening ${title}`);
    const link =
      card.querySelector("a.job-card-container__link, a.job-card-list__title--link, a[href*='/jobs/view/']") ||
      card.querySelector("a") ||
      card;
    click(link);
    await sleep(1200);
    await dismissAll();
    await waitFor(() => easyApplyButton() || alreadyApplied(), 5000);

    if (alreadyApplied()) {
      state.skipped += 1;
      report(`Already applied · skipped ${state.skipped}`);
      return;
    }

    const easyBtn = easyApplyButton();
    if (!easyBtn) {
      state.skipped += 1;
      report("No Easy Apply button · skipped");
      return;
    }

    report(`Easy Apply · ${title}`);
    click(easyBtn);
    await sleep(500);
    await dismissAll();
    const opened = await waitFor(() => applyModal() || successVisible(), 8000);
    if (!opened) {
      state.skipped += 1;
      report("Form did not open · skipped");
      return;
    }

    const submitted = await fillApplication();
    if (submitted) {
      state.applied += 1;
      report(`Applied ${state.applied}`);
      await dismissAll();
    } else {
      state.skipped += 1;
      await discardModal();
      await dismissAll();
      report(`Could not finish form · skipped ${state.skipped}`);
    }
  }

  async function fillApplication() {
    try {
      let lastSignature = "";
      let stuck = 0;

      for (let step = 0; step < MAX_STEPS; step += 1) {
        assertRunning();
        await dismissAll();
        const modal = applyModal();
        if (!modal) {
          if (successVisible()) {
            await dismissSuccess();
            return true;
          }
          return false;
        }

        if (successVisible()) {
          await dismissSuccess();
          return true;
        }

        const filled = await fillVisibleFields(modal);
        if (!filled?.ok) {
          report(`Skipping · cannot answer: ${filled?.reason || "a required field"}`);
          return false;
        }

        skipOptionalInApply(modal);
        const action = progressButton(modal);
        const signature = fieldSignature(modal) + (action?.label || "");
        if (signature === lastSignature) stuck += 1;
        else stuck = 0;
        lastSignature = signature;
        if (stuck >= 3) return false;

        if (!action) {
          if (successVisible()) {
            await dismissSuccess();
            return true;
          }
          return false;
        }

        report(action.label);
        click(action.button);
        await sleep(700);
        await dismissAll();

        if (action.kind === "submit") {
          await waitFor(() => successVisible() || !applyModal() || hasFieldErrors(applyModal() || modal), 8000);
          if (successVisible() || !applyModal()) {
            await dismissSuccess();
            return true;
          }
          if (hasFieldErrors(applyModal() || modal)) return false;
        } else if (hasFieldErrors(applyModal() || modal)) {
          const retry = await fillVisibleFields(applyModal() || modal);
          if (!retry?.ok) return false;
        }
      }
      return false;
    } catch (error) {
      if (error instanceof StoppedError) throw error;
      if (isInvalidContext(error)) {
        retire();
        return false;
      }
      return false;
    }
  }

  function progressButton(modal) {
    const root = applyFooter(modal);
    const submit = exactButton(root, ["submit application", "submit"]);
    if (submit) return { button: submit, kind: "submit", label: "Submit" };
    const review = exactButton(root, ["review your application", "review"]);
    if (review) return { button: review, kind: "review", label: "Review" };
    const next = exactButton(root, ["continue to next step", "next", "continue"]);
    if (next) return { button: next, kind: "next", label: "Next" };
    return null;
  }

  function applyFooter(modal) {
    return (
      modal.querySelector("footer") ||
      modal.querySelector(".artdeco-modal__actionbar") ||
      modal.querySelector(".jobs-easy-apply-modal__content") ||
      modal
    );
  }

  function exactButton(root, names) {
    if (!root) return null;
    const wanted = names.map(normalize);
    return [...root.querySelectorAll("button")].find((btn) => {
      if (!visible(btn) || btn.disabled || btn.getAttribute("aria-disabled") === "true") return false;
      if (btn.closest("#eah-overlay, #eah-details, #eah-setup, #eah-ask")) return false;
      const label = normalize(btn.getAttribute("aria-label") || "");
      const text = normalize(btn.innerText || "");
      return wanted.some((name) => {
        const hit = (value) => (name.length <= 8 ? value === name : value === name || value.startsWith(`${name} `));
        return hit(label) || hit(text);
      });
    });
  }

  async function dismissAll() {
    for (let i = 0; i < 4; i += 1) {
      if (!dismissInterruptions()) break;
      await sleep(280);
    }
  }

  function dismissInterruptions() {
    if (state.dead || !extensionAlive()) return false;
    try {
      const apply = applyModal();
      const dismissNames = new Set([
        "not now",
        "maybe later",
        "no thanks",
        "no, thanks",
        "got it",
        "skip for now",
        "don't send",
        "dont send",
        "continue without premium",
        "keep using linkedin",
      ]);

      const buttons = [...document.querySelectorAll("button, [role='button']")];
      for (const btn of buttons) {
        if (!visible(btn)) continue;
        if (btn.closest("#eah-overlay, #eah-details, #eah-setup, #eah-ask")) continue;
        if (apply && apply.contains(btn)) continue;
        let text = "";
        try {
          text = normalize(btn.innerText || btn.getAttribute("aria-label") || "");
        } catch {
          continue;
        }
        if (!text) continue;
        if (dismissNames.has(text) || /^not now\b/.test(text)) {
          click(btn);
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  function skipOptionalInApply(modal) {
    const next = progressButton(modal);
    if (next) return false;
    const skip = exactButton(modal, ["skip", "skip this question"]);
    if (!skip) return false;
    click(skip);
    return true;
  }

  async function fillVisibleFields(modal, asked = false) {
    if (!modal || state.dead || !extensionAlive()) return { ok: false, reason: "Stopped" };
    try {
      return await fillVisibleFieldsInner(modal, asked);
    } catch (error) {
      if (error instanceof StoppedError) throw error;
      if (isInvalidContext(error)) {
        retire();
        return { ok: false, reason: "Stopped" };
      }
      return { ok: false, reason: error.message || "Could not fill" };
    }
  }

  async function fillVisibleFieldsInner(modal, asked = false) {
    const unknowns = [];
    const groups = [
      ...modal.querySelectorAll(
        ".jobs-easy-apply-form-section__grouping, .fb-dash-form-element, fieldset, .artdeco-text-input, label"
      ),
    ];
    const seen = new Set();

    for (const input of modal.querySelectorAll("input, textarea, select")) {
      if (!isFillable(input) || seen.has(input)) continue;
      seen.add(input);

      const label = fieldLabel(input, modal);
      if (shouldLeaveAlone(label, input)) continue;
      if (hasValue(input)) continue;

      const required = isRequired(input, label);
      const inferred = answerFor(label, input);
      if (inferred.sensitive && required) return { ok: false, reason: "Sensitive question" };
      if (!inferred.value) {
        if (required) unknowns.push(describeUnknown(label, input, inferred));
        continue;
      }

      const wrote = await writeField(input, inferred.value, modal);
      if (!wrote && required) unknowns.push(describeUnknown(label, input, inferred));
      await sleep(180);
    }

    for (const group of groups) {
      const radios = [...group.querySelectorAll('input[type="radio"]')];
      if (!radios.length || radios.some((r) => r.checked)) continue;
      const label = (group.innerText || "").split("\n")[0] || fieldLabel(radios[0], modal);
      const inferred = answerFor(label, radios[0]);
      const required = /required|\*/i.test(group.innerText || "") || isRequired(radios[0], label);
      if (inferred.sensitive && required) return { ok: false, reason: "Sensitive question" };
      if (!inferred.value) {
        if (required) unknowns.push({ ...describeUnknown(label, radios[0], inferred), kind: "yesno" });
        continue;
      }
      const match = radios.find((r) => radioMatches(r, inferred.value, group));
      if (match) click(match);
      else if (isYesNo(radios) && required) {
        unknowns.push({ ...describeUnknown(label, radios[0], inferred), kind: "yesno" });
      }
    }

    const unique = dedupeUnknowns(unknowns);
    if (unique.length && !asked) {
      const learned = await askUnknownQuestions(unique);
      if (!learned) return { ok: false, reason: unique[0].label };
      return fillVisibleFields(modal, true);
    }
    if (unique.length && asked) return { ok: false, reason: unique[0].label };

    uncheckFollow(modal);
    return { ok: true };
  }

  function describeUnknown(label, input, inferred) {
    const brain = getBrain();
    const years = brain.isYearsQuestion(label);
    return {
      label: brain.cleanQuestion(label),
      kind: years ? "years" : brain.isYesNoQuestion(label, input) ? "yesno" : "text",
      skill: inferred.skill || brain.extractSkillFromQuestion(label),
      suggestion:
        inferred.value ||
        (years ? brain.lookupSkillYears(inferred.skill || brain.extractSkillFromQuestion(label), state.skillYears, state.resumeText, state.answers.yearsExperience) : ""),
    };
  }

  function dedupeUnknowns(items) {
    const seen = new Set();
    return items.filter((item) => {
      const key = getBrain().normalize(item.label);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function writeField(input, answer, modal) {
    if (input.type === "file") return true;
    if (input.type === "checkbox") {
      const wantChecked = /yes|true|agree/i.test(String(answer));
      if (input.checked !== wantChecked) click(input);
      return true;
    }
    if (input.tagName === "SELECT") {
      return selectOption(input, answer);
    }
    if (input.getAttribute("role") === "combobox" || input.getAttribute("aria-autocomplete") === "list") {
      setReactValue(input, answer);
      await sleep(400);
      const option =
        qs('div[role="option"]') ||
        qs("li.basic-typeahead__triggered-content") ||
        modal.querySelector('[role="option"]');
      if (option) click(option);
      return true;
    }
    setReactValue(input, answer);
    return true;
  }

  function selectOption(select, answer) {
    const wanted = normalize(answer);
    const options = [...select.options];
    const match =
      options.find((o) => normalize(o.text) === wanted || normalize(o.value) === wanted) ||
      options.find((o) => normalize(o.text).includes(wanted) || wanted.includes(normalize(o.text)));
    if (!match || !match.value) return false;
    select.value = match.value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function answerFor(label, input) {
    return getBrain().inferAnswer(label, input, state.answers, state.skillYears, state.resumeText);
  }

  function shouldLeaveAlone(label, input) {
    const q = normalize(label);
    if (input.type === "file") return true;
    if (/resume|cv|cover letter/.test(q)) return true;
    if (/password/.test(q)) return true;
    return false;
  }

  function radioMatches(radio, answer, group) {
    const wanted = normalize(answer);
    const text = normalize(
      `${radio.value} ${radio.getAttribute("aria-label") || ""} ${labelText(radio, group)}`
    );
    if (wanted === "yes") return /^(yes|true|y)\b/.test(text) || text === "yes";
    if (wanted === "no") return /^(no|false|n)\b/.test(text) || text === "no";
    return text.includes(wanted) || wanted.includes(text);
  }

  function isYesNo(radios) {
    const texts = radios.map((r) => normalize(r.value || labelText(r, r.closest("fieldset") || document)));
    return texts.some((t) => t === "yes") && texts.some((t) => t === "no");
  }

  function uncheckFollow(modal) {
    const follow = [...modal.querySelectorAll('input[type="checkbox"]')].find((box) =>
      /follow/i.test(fieldLabel(box, modal))
    );
    if (follow?.checked) click(follow);
  }

  function alreadyApplied() {
    const btn = qs(".jobs-apply-button--top-card button") || qs("button.jobs-apply-button") || qs(".jobs-s-apply button");
    const text = `${btn?.innerText || ""} ${btn?.getAttribute("aria-label") || ""}`;
    return /applied|manage application/i.test(text);
  }

  function easyApplyButton() {
    const roots = [
      qs(".jobs-apply-button--top-card"),
      qs(".jobs-s-apply"),
      qs(".job-details-jobs-unified-top-card"),
      qs(".jobs-unified-top-card"),
      qs(".jobs-details__main-content"),
    ].filter(Boolean);

    const match = (btn) => {
      if (!visible(btn) || btn.disabled) return false;
      if (btn.closest(".search-reusables__filter-trigger-wrap, .scaffold-layout__list, header, #global-nav")) {
        return false;
      }
      const text = `${btn.innerText || ""} ${btn.getAttribute("aria-label") || ""}`;
      return /easy apply/i.test(text);
    };

    for (const root of roots) {
      const hit = [...root.querySelectorAll("button.jobs-apply-button, button")].find(match);
      if (hit) return hit;
    }
    return [...document.querySelectorAll("button.jobs-apply-button")].find(match) || null;
  }

  function applyModal() {
    return (
      qs(".jobs-easy-apply-modal") ||
      [...document.querySelectorAll('div[role="dialog"], dialog[open], .artdeco-modal')].find((el) => {
        const text = el.innerText || "";
        return /apply to|easy apply/i.test(text) && /next|review|submit|contact info|resume/i.test(text);
      }) ||
      qs(".jobs-easy-apply-content")
    );
  }

  function successVisible() {
    const nodes = [
      applyModal(),
      ...document.querySelectorAll('div[role="dialog"], dialog[open], .artdeco-modal, .artdeco-toast-item'),
    ].filter(Boolean);
    return nodes.some((el) =>
      /application was sent|application submitted|your application was sent/i.test(el.innerText || "")
    );
  }

  async function dismissSuccess() {
    try {
      await sleep(400);
      const modal = applyModal() || document;
      const done = exactButton(modal, ["done", "dismiss", "close"]) || findAction(modal, ["Done"]);
      if (done) click(done);
      await sleep(300);
      await dismissAll();
    } catch (error) {
      if (error instanceof StoppedError) throw error;
      if (isInvalidContext(error)) retire();
    }
  }

  async function discardModal() {
    const modal = applyModal();
    if (!modal) return;
    const dismiss =
      modal.querySelector('button[aria-label*="Dismiss"]') ||
      modal.querySelector(".artdeco-modal__dismiss");
    if (dismiss) click(dismiss);
    await sleep(400);
    const discard = findByText(document, "button", ["Discard", "Confirm"]);
    if (discard) click(discard);
    await sleep(350);
  }

  function findAction(root, names) {
    const buttons = [...root.querySelectorAll("button")];
    for (const name of names) {
      const hit = buttons.find((btn) => {
        if (!visible(btn) || btn.disabled) return false;
        const text = `${btn.getAttribute("aria-label") || ""} ${btn.innerText || ""}`.trim();
        return text.toLowerCase() === name.toLowerCase() || new RegExp(name, "i").test(text);
      });
      if (hit) return hit;
    }
    return null;
  }

  function onJobsSearch() {
    return /\/jobs(\/|$)/.test(location.pathname);
  }

  function jobCards() {
    return [
      ...document.querySelectorAll(
        "div.job-card-container, li.jobs-search-results__list-item, div[data-job-id], li.scaffold-layout__list-item, .job-card-job-posting-card-wrapper"
      ),
    ].filter((card) => visible(card) && (card.querySelector("a[href*='/jobs']") || card.getAttribute("data-job-id")));
  }

  function unseenCards() {
    return jobCards().filter((card) => {
      const id = jobId(card);
      return id && !state.processed.has(id);
    });
  }

  function jobId(card) {
    return (
      card.getAttribute("data-job-id") ||
      card.querySelector("[data-job-id]")?.getAttribute("data-job-id") ||
      card.querySelector("a[href*='/jobs/view/']")?.href?.match(/\/jobs\/view\/(\d+)/)?.[1] ||
      (card.innerText || "").slice(0, 80)
    );
  }

  async function scrollJobList() {
    const list =
      qs(".jobs-search-results-list") ||
      qs(".scaffold-layout__list") ||
      document.scrollingElement;
    if (!list) return;
    for (let i = 0; i < 4; i += 1) {
      list.scrollTop += 500;
      await sleep(250);
    }
  }

  async function goNextPage(page) {
    const pager = qs(".artdeco-pagination") || qs(".jobs-search-pagination");
    const next =
      qs(`button[aria-label="Page ${page}"]`) ||
      qs("button.artdeco-pagination__button--next") ||
      (pager && exactButton(pager, ["next"]));
    if (!next || next.disabled || applyModal()?.contains(next)) return false;
    click(next);
    return true;
  }

  function isLoggedIn() {
    if (isLoginRoute()) return false;
    if (visibleLoginForm()) return false;
    if (securityWall()) return false;
    if (isAppRoute()) return true;
    return Boolean(
      qs(".feed-identity-module") ||
        qs(".scaffold-layout__sidebar") ||
        qs(".share-box-feed-entry") ||
        qs(".global-nav__me") ||
        qs("#global-nav") ||
        qs("nav.global-nav") ||
        qs('header a[href*="/feed"]') ||
        qs('a[href*="/jobs/"]')
    );
  }

  function isLoginRoute() {
    return /\/(login|uas\/login|checkpoint|signup|start\/)/i.test(location.pathname);
  }

  function isAppRoute() {
    return /\/(feed|jobs|in\/|mynetwork|messaging|notifications|search|preload|my-items|hiring)/i.test(
      location.pathname
    );
  }

  function visibleLoginForm() {
    const email = qs('input[name="session_key"]');
    const form = qs("form.login__form") || email;
    return Boolean(form && actuallyVisible(form));
  }

  function securityWall() {
    const captcha = qs("#captcha-internal") || qs(".challenge-page");
    return Boolean(captcha && actuallyVisible(captcha));
  }

  function actuallyVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function ensureOverlay() {
    if (qs("#eah-overlay")) return;
    const box = document.createElement("div");
    box.id = "eah-overlay";
    box.innerHTML = `
      <strong>Easy Apply</strong>
      <span id="eah-status">Starting…</span>
      <button type="button" id="eah-stop">Stop</button>
    `;
    Object.assign(box.style, {
      position: "fixed",
      zIndex: "2147483646",
      right: "16px",
      bottom: "16px",
      display: "flex",
      flexDirection: "column",
      gap: "6px",
      minWidth: "220px",
      padding: "12px 14px",
      background: "#0a66c2",
      color: "#fff",
      borderRadius: "10px",
      font: "13px/1.35 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,.2)",
    });
    document.documentElement.appendChild(box);
    const stopBtn = box.querySelector("#eah-stop");
    Object.assign(stopBtn.style, {
      border: "0",
      borderRadius: "6px",
      padding: "6px 8px",
      background: "#fff",
      color: "#0a66c2",
      fontWeight: "700",
      cursor: "pointer",
    });
    stopBtn.addEventListener("click", () => stop("Stopped"));
  }

  function report(status) {
    if (state.dead || !extensionAlive()) return;
    const overlayStatus = document.getElementById("eah-status");
    if (overlayStatus) overlayStatus.textContent = status;
    safeSend({
      type: "STATE",
      running: state.running,
      status,
      applied: state.applied,
      skipped: state.skipped,
    });
  }

  function assertRunning() {
    if (state.dead || !extensionAlive()) {
      retire();
      throw new StoppedError();
    }
    if (!state.running) throw new StoppedError();
  }

  function qs(selector, root = document) {
    return root.querySelector(selector);
  }

  function firstVisible(selectors) {
    for (const selector of selectors) {
      const el = qs(selector);
      if (el && visible(el)) return el;
    }
    return null;
  }

  function visible(el) {
    return actuallyVisible(el);
  }

  function click(el) {
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent("mousedown", opts));
    el.dispatchEvent(new MouseEvent("mouseup", opts));
    // A manual click event plus el.click() activated controls twice (including filter toggles).
    if (typeof el.click === "function") el.click();
    else el.dispatchEvent(new MouseEvent("click", opts));
  }

  function setReactValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    el.focus();
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isFillable(input) {
    if (!visible(input)) return false;
    if (input.disabled || input.readOnly) return false;
    if (["hidden", "submit", "button", "reset", "image"].includes(input.type)) return false;
    if (input.type === "radio") return false;
    return true;
  }

  function hasValue(input) {
    if (input.tagName === "SELECT") return Boolean(input.value);
    return Boolean(String(input.value || "").trim());
  }

  function isRequired(input, label) {
    return (
      input.required ||
      input.getAttribute("aria-required") === "true" ||
      /\*/.test(label) ||
      /required/i.test(label)
    );
  }

  function hasFieldErrors(modal) {
    return Boolean(
      modal.querySelector(".artdeco-inline-feedback--error, .fb-dash-form-element__error-text, [role='alert']")
    );
  }

  function fieldSignature(modal) {
    return [...modal.querySelectorAll("label, legend")]
      .map((el) => (el.innerText || "").trim())
      .filter(Boolean)
      .join("|");
  }

  function fieldLabel(input, root) {
    if (input.labels?.[0]) return input.labels[0].innerText || "";
    const labelled = input.getAttribute("aria-label") || input.getAttribute("placeholder") || "";
    if (labelled) return labelled;
    const wrap = input.closest(".jobs-easy-apply-form-section__grouping, .fb-dash-form-element, fieldset, div");
    return (wrap?.querySelector("label, legend, span")?.innerText || wrap?.innerText || "").split("\n")[0];
  }

  function labelText(input, root) {
    const id = input.id && root.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    return (id?.innerText || input.parentElement?.innerText || "").trim();
  }

  function findByText(root, tag, names) {
    const nodes = [...root.querySelectorAll(tag)];
    return nodes.find((el) => {
      if (!visible(el)) return false;
      const text = (el.innerText || "").trim();
      return names.some((name) => text === name || text.includes(name));
    });
  }

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function sleep(ms) {
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (!state.running) {
          reject(new StoppedError());
          return;
        }
        if (Date.now() - started >= ms) {
          resolve();
          return;
        }
        setTimeout(tick, 80);
      };
      tick();
    });
  }

  async function waitFor(check, timeout) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      assertRunning();
      if (check()) return true;
      await sleep(200);
    }
    return false;
  }
})();
