import { useState } from "react";
import { decide, fillSession, markSubmitted, startCampaign, uploadResume } from "./api";
import "./styles.css";

const SAMPLE = {
  contact_info: {
    full_name: "Jane Doe",
    email: "jane.doe@example.com",
    phone: "+1-555-123-4567",
    location: "San Francisco, CA",
    linkedin_url: "https://www.linkedin.com/in/janedoe",
    github_url: null,
    portfolio_url: null,
  },
  professional_summary: "Software engineer with 3 years of experience building web applications.",
  technical_skills: ["Python", "JavaScript", "React", "FastAPI", "MongoDB"],
  soft_skills: [],
  education: [],
  work_experience: [
    {
      job_title: "Software Engineer",
      company: "Acme Corp",
      location: null,
      start_date: "2022",
      end_date: null,
      is_current: true,
      responsibilities: ["Built and maintained backend services in Python."],
    },
  ],
  internships: [],
  projects: [],
  certifications: [],
  achievements: [],
  languages: [],
  additional_information: null,
};

const SAMPLE_JOB = `Title: Backend Engineer
Company: Northwind
Location: Remote

Requirements
- Python
- FastAPI
- MongoDB
`;

export default function App() {
  const [profile, setProfile] = useState(null);
  const [jobText, setJobText] = useState(SAMPLE_JOB);
  const [questions, setQuestions] = useState("How many years of COBOL?");
  const [session, setSession] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = await uploadResume(file);
      setProfile(data.candidate_profile);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onAnalyze(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await startCampaign({
        candidate_profile: profile,
        job_text: jobText,
        questions: questions.split("\n").map((line) => line.trim()).filter(Boolean),
        request_package: true,
        use_llm: false,
      });
      setSession(data);
      const next = {};
      for (const answer of data.package?.answers || []) next[answer.field_key] = answer.value || "";
      setDrafts(next);
      setReport(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onDecision(decision) {
    setBusy(true);
    setError("");
    try {
      const answers = Object.entries(drafts).map(([field_key, value]) => ({ field_key, value }));
      const data = await decide(session.id, decision, decision === "skip" ? [] : answers);
      if (data.phase === "approved") {
        const filled = await fillSession(data.id);
        setReport(filled);
        setSession({ ...data, phase: filled.phase });
      } else {
        setSession(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitted() {
    setBusy(true);
    setError("");
    try {
      setSession(await markSubmitted(session.id));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const match = session?.match;

  return (
    <main>
      <h1>Job application assistant</h1>
      <p className="muted">
        It reads your resume and one job, drafts answers from facts on the resume, and stops before anything is sent.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <section className="card">
        <h2>1. Resume</h2>
        <input type="file" accept="application/pdf" onChange={onUpload} disabled={busy} />
        <div className="row">
          <button type="button" className="secondary" onClick={() => setProfile(SAMPLE)} disabled={busy}>
            Use sample profile
          </button>
        </div>
        {profile ? <p>Profile ready for {profile.contact_info?.full_name || "this candidate"}.</p> : <p className="muted">No profile yet.</p>}
      </section>

      <form className="card" onSubmit={onAnalyze}>
        <h2>2. Job</h2>
        <label>
          Job description
          <textarea rows={8} value={jobText} onChange={(event) => setJobText(event.target.value)} />
        </label>
        <label>
          Extra questions, one per line
          <textarea rows={3} value={questions} onChange={(event) => setQuestions(event.target.value)} />
        </label>
        <button type="submit" disabled={busy || !profile}>Analyze and draft</button>
      </form>

      {session ? (
        <section className="card">
          <h2>3. Review</h2>
          <p>
            <span className="pill">{match?.recommendation}</span> Score {match?.score} / threshold {match?.threshold}
          </p>
          <p>{session.analysis?.title} {session.analysis?.company ? `at ${session.analysis.company}` : ""}</p>
          {match?.deal_breakers?.length ? <p>Deal-breakers: {match.deal_breakers.join(" ")}</p> : null}
          {match?.overlaps?.length ? (
            <p>Matches: {match.overlaps.map((item) => item.requirement).join(", ")}</p>
          ) : null}
          {match?.gaps?.length ? (
            <p>Gaps: {match.gaps.map((item) => item.requirement).join(", ")}</p>
          ) : null}
          <table>
            <tbody>
              {(session.package?.answers || []).map((answer) => (
                <tr key={answer.field_key}>
                  <td>
                    {answer.label}
                    <div className="muted">{answer.sensitive ? "Left blank" : answer.evidence || answer.confidence}</div>
                  </td>
                  <td>
                    <input
                      aria-label={answer.label}
                      value={drafts[answer.field_key] || ""}
                      onChange={(event) => setDrafts({ ...drafts, [answer.field_key]: event.target.value })}
                      disabled={answer.sensitive}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {session.package?.cover_letter ? <p>{session.package.cover_letter}</p> : null}
          <div className="row">
            <button type="button" disabled={busy || session.phase !== "answer_review"} onClick={() => onDecision("approve")}>
              Approve and fill preview
            </button>
            <button type="button" className="secondary" disabled={busy || session.phase !== "answer_review"} onClick={() => onDecision("skip")}>
              Skip this job
            </button>
          </div>
        </section>
      ) : null}

      {report ? (
        <section className="card">
          <h2>4. Your submit</h2>
          <p className="muted">These values were written into a local preview. Submit was not clicked.</p>
          <ul>
            {report.wrote.map((field) => (
              <li key={field.field_key}>{field.label}: {field.value}</li>
            ))}
          </ul>
          <button type="button" disabled={busy || session?.phase === "submitted"} onClick={onSubmitted}>
            I submitted this myself
          </button>
          {session?.follow_up_draft ? (
            <p>
              Follow-up draft, copy only: {session.follow_up_draft}
            </p>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}
