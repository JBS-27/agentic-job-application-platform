(() => {
  const SKILL_ALIASES = {
    ai: ["artificial intelligence", "machine learning", "ml", "deep learning", "genai", "generative ai"],
    "machine learning": ["ml", "ai", "artificial intelligence"],
    python: ["django", "flask", "pandas"],
    javascript: ["js", "node", "nodejs", "react", "typescript", "ts"],
    typescript: ["ts", "javascript"],
    java: ["spring", "spring boot"],
    react: ["reactjs", "react.js", "javascript"],
    sql: ["mysql", "postgres", "postgresql", "database"],
    aws: ["amazon web services", "cloud"],
    excel: ["microsoft excel", "spreadsheet"],
  };

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[*•·]/g, " ")
      .replace(/\(.*?\)/g, " ")
      .replace(/[^a-z0-9+#.\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanQuestion(value) {
    return String(value || "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenOverlap(a, b) {
    const left = new Set(normalize(a).split(" ").filter((w) => w.length > 2));
    const right = new Set(normalize(b).split(" ").filter((w) => w.length > 2));
    if (!left.size || !right.size) return 0;
    let hit = 0;
    for (const word of left) if (right.has(word)) hit += 1;
    return hit / Math.min(left.size, right.size);
  }

  function sameSkill(a, b) {
    const left = normalize(a);
    const right = normalize(b);
    if (!left || !right) return false;
    if (left === right || left.includes(right) || right.includes(left)) return true;
    const leftAliases = SKILL_ALIASES[left] || [];
    const rightAliases = SKILL_ALIASES[right] || [];
    return leftAliases.includes(right) || rightAliases.includes(left);
  }

  function extractSkillFromQuestion(label) {
    const text = cleanQuestion(label);
    const match =
      text.match(/years?\s+(?:of\s+)?(?:work\s+)?experience\s+(?:do you have\s+)?(?:with|in|using|on)\s+(.+?)(?:\?|$)/i) ||
      text.match(/experience\s+(?:with|in|using|on)\s+(.+?)(?:\?|$)/i) ||
      text.match(/how many years.+(?:with|in|using|on)\s+(.+?)(?:\?|$)/i) ||
      text.match(/proficiency (?:with|in)\s+(.+?)(?:\?|$)/i);
    if (!match) return "";
    return match[1].replace(/\s+and\s+.*$/i, "").trim();
  }

  function isYearsQuestion(label) {
    return /year/i.test(label) && /experience|work|skill|proficiency/i.test(label);
  }

  function isYesNoQuestion(label, input) {
    if (input?.type === "radio") return true;
    return /^(are|do|have|will|can|would|is)\b/i.test(cleanQuestion(label)) || /authorized|sponsor|relocat|commute|comfortable|willing|eligible/i.test(label);
  }

  function isSensitive(label) {
    return /gender|race|ethnicity|veteran|disability|lgbt|sexual|religion|hispanic|white|black|asian/i.test(label);
  }

  function isCommute(label) {
    return /commute|commuting|this job'?s location|travel to (this|the) (office|location|site)/i.test(label);
  }

  function lookupSkillYears(skill, skillYears, resumeText, fallbackYears) {
    if (!skill) return "";
    const wanted = normalize(skill);
    for (const [key, value] of Object.entries(skillYears || {})) {
      if (value && sameSkill(wanted, key)) return String(value);
    }
    const resume = normalize(resumeText || "");
    if (resume && (resume.includes(wanted) || (SKILL_ALIASES[wanted] || []).some((alias) => resume.includes(alias)))) {
      const explicit = resumeText.match(new RegExp(`(\\d+)\\+?\\s*(?:years?|yrs?).{0,20}${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"));
      if (explicit) return explicit[1];
      return fallbackYears || "";
    }
    return "";
  }

  function matchCustom(label, custom) {
    const q = normalize(label);
    let best = null;
    let bestScore = 0;
    for (const row of custom || []) {
      const rq = normalize(row.question);
      if (!rq || !row.answer) continue;
      if (q.includes(rq) || rq.includes(q)) return row.answer;
      const skillA = extractSkillFromQuestion(label);
      const skillB = extractSkillFromQuestion(row.question);
      if (skillA && skillB && sameSkill(skillA, skillB) && isYearsQuestion(label) && isYearsQuestion(row.question)) {
        return row.answer;
      }
      const score = tokenOverlap(q, rq);
      if (score > bestScore) {
        bestScore = score;
        best = row.answer;
      }
    }
    return bestScore >= 0.74 ? best : "";
  }

  function inferAnswer(label, input, answers, skillYears, resumeText) {
    const q = normalize(label);
    const a = answers || {};
    const type = (input?.type || "").toLowerCase();
    if (isSensitive(label)) return { value: "", sensitive: true };
    if (/first name|given name/.test(q)) return { value: a.firstName || "" };
    if (/last name|surname|family name/.test(q)) return { value: a.lastName || "" };
    if (/^(full )?name$/.test(q)) return { value: a.fullName || "" };
    if (/phone|mobile/.test(q) || type === "tel") return { value: a.phone || "" };
    if (type === "email" || (/email/.test(q) && !/company/.test(q))) return { value: a.email || "" };
    if (/city|current city|current location/.test(q) && !/relocat|commute/.test(q)) return { value: a.city || "" };
    if (isCommute(label)) return { value: a.commute || "" };
    if (/authorized to work|legally authorized|work authorization|eligible to work|right to work/.test(q)) {
      return { value: a.authorized || "" };
    }
    if (/sponsorship|visa sponsor|require sponsor/.test(q)) return { value: a.sponsorship || "" };
    if (/relocat/.test(q)) return { value: a.relocate || "" };
    if (/salary|compensation|expected pay|desired pay|pay expectation/.test(q)) return { value: a.salary || "" };
    if (/website|portfolio|github|personal site/.test(q)) return { value: a.website || "" };
    if (/linkedin/.test(q) && /url|profile|link/.test(q)) return { value: a.linkedinUrl || "" };
    if (/hear about|how did you find/.test(q)) return { value: a.hearAbout || "LinkedIn" };

    if (isYearsQuestion(label)) {
      const skill = extractSkillFromQuestion(label);
      if (skill) {
        const skillYearsValue = lookupSkillYears(skill, skillYears, resumeText, a.yearsExperience);
        if (skillYearsValue) return { value: skillYearsValue, skill };
      } else if (a.yearsExperience) {
        return { value: a.yearsExperience };
      }
    }

    const custom = matchCustom(label, a.custom);
    if (custom) return { value: custom };
    if (type === "number" && /year/.test(q)) return { value: a.yearsExperience || "" };
    return { value: "", skill: extractSkillFromQuestion(label) };
  }

  function remember(label, answer, answers, skillYears) {
    const nextAnswers = { ...(answers || {}), custom: [...((answers && answers.custom) || [])] };
    const nextSkills = { ...(skillYears || {}) };
    const cleaned = cleanQuestion(label);
    const value = String(answer || "").trim();
    if (!cleaned || !value) return { answers: nextAnswers, skillYears: nextSkills };

    if (isCommute(label)) nextAnswers.commute = value;
    if (/relocat/i.test(label)) nextAnswers.relocate = value;
    if (/authorized to work|legally authorized|eligible to work/i.test(label)) nextAnswers.authorized = value;
    if (/sponsorship|visa sponsor/i.test(label)) nextAnswers.sponsorship = value;

    const skill = extractSkillFromQuestion(label);
    if (skill && isYearsQuestion(label)) {
      nextSkills[normalize(skill)] = value;
      const short = normalize(skill).split(" ")[0];
      if (short && short.length > 2) nextSkills[short] = value;
    }

    const existing = nextAnswers.custom.find(
      (row) => normalize(row.question) === normalize(cleaned) || tokenOverlap(row.question, cleaned) >= 0.8
    );
    if (existing) existing.answer = value;
    else nextAnswers.custom.push({ question: cleaned, answer: value });

    return { answers: nextAnswers, skillYears: nextSkills };
  }

  function parseResume(text) {
    const raw = String(text || "").replace(/\u0000/g, " ");
    const data = { resumeText: raw };
    const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (email) data.email = email[0];
    const phone = raw.match(/(\+\d[\d\s().-]{8,}\d)|(\b\d{10}\b)/);
    if (phone) data.phone = (phone[1] || phone[2]).replace(/\s+/g, " ").trim();
    const site = raw.match(/https?:\/\/(?!.*(linkedin|facebook|twitter))[^\s)]+/i);
    if (site) data.website = site[0];
    const linkedin = raw.match(/https?:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_-]+/i);
    if (linkedin) data.linkedinUrl = linkedin[0];

    const city = raw.match(/\b([A-Z][a-zA-Z]+(?:,\s*[A-Z][a-zA-Z]+){1,2})\b/);
    if (city) data.city = city[1];

    const years = raw.match(/(\d+)\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:experience|work)/i);
    if (years) data.yearsExperience = years[1];
    if (!data.yearsExperience) {
      const dates = [...raw.matchAll(/\b((?:19|20)\d{2})\b/g)].map((m) => Number(m[1])).filter((y) => y >= 1988 && y <= new Date().getFullYear());
      if (dates.length) data.yearsExperience = String(Math.max(0, new Date().getFullYear() - Math.min(...dates)));
    }

    const skillYears = {};
    const skillHits = raw.matchAll(/(\d+)\+?\s*(?:years|yrs)\s+(?:of\s+)?(?:experience\s+)?(?:with|in|using)?\s*([A-Za-z][A-Za-z0-9.+# \/]{1,40})/gi);
    for (const hit of skillHits) {
      const name = normalize(hit[2]);
      if (name && name.length > 1 && !/experience|company|university/.test(name)) skillYears[name] = hit[1];
    }

    const known = [
      "python",
      "java",
      "javascript",
      "typescript",
      "react",
      "node",
      "sql",
      "aws",
      "docker",
      "kubernetes",
      "c++",
      "c#",
      "excel",
      "artificial intelligence",
      "machine learning",
      "ai",
      "html",
      "css",
      "git",
    ];
    const lower = raw.toLowerCase();
    for (const skill of known) {
      if (lower.includes(skill) && !skillYears[normalize(skill)] && data.yearsExperience) {
        skillYears[normalize(skill)] = data.yearsExperience;
      }
    }

    data.skillYears = skillYears;
    return data;
  }

  function unescapePdf(value) {
    return value
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\");
  }

  function extractPdfText(bytes) {
    const latin = new TextDecoder("latin1").decode(bytes);
    const chunks = [];
    const tj = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let match;
    while ((match = tj.exec(latin))) chunks.push(unescapePdf(match[1]));
    const arr = /\[(.*?)\]\s*TJ/g;
    while ((match = arr.exec(latin))) {
      const parts = match[1].match(/\(((?:\\.|[^\\)])*)\)/g) || [];
      chunks.push(parts.map((part) => unescapePdf(part.slice(1, -1))).join(""));
    }
    return chunks.join(" ").replace(/\s+/g, " ").trim();
  }

  async function readResumeFile(file) {
    if (!file) return "";
    const name = file.name.toLowerCase();
    if (name.endsWith(".txt") || name.endsWith(".md") || file.type.startsWith("text/")) {
      return file.text();
    }
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return extractPdfText(bytes);
    }
    return file.text().catch(() => "");
  }

  window.EasyApplyBrain = {
    normalize,
    cleanQuestion,
    extractSkillFromQuestion,
    isYearsQuestion,
    isYesNoQuestion,
    isSensitive,
    isCommute,
    inferAnswer,
    remember,
    parseResume,
    readResumeFile,
    lookupSkillYears,
  };
})();
