import { ResumeDoc, buildHeader, buildEducation, buildSkills, tailorResume, scoreDoc } from './tailor';
import { AtsReport, buildVocabulary, extractJdKeywords } from './ats';

export interface AiTailorResult {
  ok: boolean;
  resume: ResumeDoc;
  report: AtsReport;
  usedAi: boolean;
}

export async function aiTailorResume(
  ai: any,
  master: any,
  jd: string
): Promise<AiTailorResult> {
  // If AI binding is missing, fall back directly to deterministic tailor
  if (!ai) {
    const fallback = await tailorResume({ master, jd });
    return {
      ok: fallback.ok,
      resume: fallback.resume,
      report: fallback.report,
      usedAi: false,
    };
  }

  // Extract ATS keywords deterministically from JD to guide the LLM
  const vocab = buildVocabulary(master);
  const targetKeywords = extractJdKeywords(jd, vocab);
  const keywordListStr = targetKeywords
    .map((k) => `• ${k.display} (${k.group} - frequency: ${k.inJd}x)`)
    .join('\n');

  const prompt = `You are a Principal Technical Recruiter and ATS Optimization Expert.
Your task is to tailor a software engineer's resume for a specific Job Description (JD).

### TARGET JOB DESCRIPTION:
${jd.slice(0, 3500)}

### CRITICAL ATS KEYWORDS REQUIRED BY THIS JOB (MUST BE INCLUDED):
${keywordListStr || '• React\n• TypeScript\n• Next.js\n• Python\n• Django'}

### CANDIDATE MASTER PROFILE (REAL FACTS ONLY - DO NOT INVENT UNLISTED FACTS):
${JSON.stringify(
  {
    identity: master.identity,
    summary_variants: master.summary_variants,
    skills: master.skills,
    experience: (master.experience || []).map((e: any) => ({
      id: e.id,
      title: e.title,
      company: e.company,
      stack: e.stack,
      bullets: (e.bullets || []).map((b: any) => (typeof b === 'string' ? b : b.text)),
    })),
    projects: (master.projects || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      stack: p.stack,
      bullets: (p.bullets || []).map((b: any) => (typeof b === 'string' ? b : b.text)),
    })),
    education: master.education,
  },
  null,
  2
)}

### ATS RESUME OPTIMIZATION RULES (STANDARDS FROM ATS OPTIMIZER):
1. ATS SCORE GOAL: 100/100.
2. KEYWORD DENSITY:
   - "headline": Targeted professional headline with matching job title and core stack.
   - "summary": 2-3 sentences incorporating 5-8 of the critical ATS keywords naturally.
   - "skills": List all matched technologies explicitly at the top of each category.
   - "experience": For each bullet, use active achievement framing ("Accomplished [X] as measured by [Y] by doing [Z]") and weave the target keywords directly into achievements.
3. SINGLE-PAGE CONSTRAINT:
   - Maximum 2-3 bullets for exp_epd
   - Maximum 2 bullets for exp_pims
   - Maximum 1-2 bullets for exp_intern
   - Exactly 2 top projects with 1-2 bullets each
4. ZERO INVENTION: Keep all companies, titles, degrees, and dates 100% faithful to the candidate master profile.

Respond ONLY with valid JSON in this exact structure:
{
  "headline": "...",
  "summary": "...",
  "skills": [
    { "category": "Languages", "items": ["TypeScript", "Python", ...] },
    { "category": "Frontend", "items": ["React", "Next.js", ...] },
    { "category": "Backend", "items": ["Django", "Python", ...] },
    { "category": "Data", "items": [...] },
    { "category": "Cloud & DevOps", "items": [...] },
    { "category": "Tools", "items": [...] }
  ],
  "experience": [
    {
      "id": "exp_epd",
      "title": "Full-Stack Software Engineer",
      "company": "EPD Community",
      "location": "Remote",
      "start": "2024",
      "end": "Present",
      "stack": ["Next.js", "Cloudflare Pages", "Cloudflare D1", "Tailwind CSS"],
      "bullets": ["...", "..."]
    }
  ],
  "projects": [
    {
      "id": "proj_gamehub",
      "name": "Game Hub",
      "year": "2024 - 2025",
      "stack": ["React 19", "TypeScript", "Vite"],
      "bullets": ["...", "..."]
    }
  ]
}`;

  try {
    const response: any = await ai.run('@cf/meta/llama-3.2-3b-instruct', {
      messages: [
        {
          role: 'system',
          content:
            'You are an expert technical resume writer. Return valid JSON only, without any Markdown codeblocks or conversational text.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 1500,
      temperature: 0.2,
    });

    const responseText = (
      response?.response ||
      response?.choices?.[0]?.message?.content ||
      ''
    ).trim();
    const parsed = parseJsonFromResponse(responseText);

    const header = buildHeader(master);
    if (parsed.headline && typeof parsed.headline === 'string') {
      header.headline = parsed.headline.trim();
    }

    const expList =
      Array.isArray(parsed.experience) && parsed.experience.length > 0
        ? parsed.experience.map((e: any) => ({
            id: e.id || 'exp',
            title: e.title || '',
            company: e.company || '',
            location: e.location || 'Remote',
            start: e.start || '',
            end: e.end || '',
            bullets: (e.bullets || []).map((b: any, idx: number) => ({
              id: `${e.id}_b${idx}`,
              text: typeof b === 'string' ? b.trim() : b.text || '',
            })),
          }))
        : (master.experience || []).map((e: any) => ({
            id: e.id,
            title: e.title,
            company: e.company,
            location: e.location,
            start: e.start,
            end: e.end,
            bullets: (e.bullets || []).map((b: any, idx: number) => ({
              id: b.id || `b${idx}`,
              text: typeof b === 'string' ? b : b.text,
            })),
          }));

    const projList =
      Array.isArray(parsed.projects) && parsed.projects.length > 0
        ? parsed.projects.map((p: any) => ({
            id: p.id || 'proj',
            name: p.name || '',
            year: p.year || '',
            stack: Array.isArray(p.stack) ? p.stack : [],
            bullets: (p.bullets || []).map((b: any, idx: number) => ({
              id: `${p.id}_b${idx}`,
              text: typeof b === 'string' ? b.trim() : b.text || '',
            })),
          }))
        : (master.projects || []).slice(0, 3).map((p: any) => ({
            id: p.id,
            name: p.name,
            year: p.year,
            stack: p.stack,
            bullets: (p.bullets || []).map((b: any, idx: number) => ({
              id: b.id || `b${idx}`,
              text: typeof b === 'string' ? b : b.text,
            })),
          }));

    const skillsList =
      Array.isArray(parsed.skills) && parsed.skills.length > 0
        ? parsed.skills.map((s: any) => ({
            category: s.category || 'Skills',
            items: Array.isArray(s.items) ? s.items.map((x: any) => String(x).trim()) : [],
          }))
        : buildSkills(master);

    const doc: ResumeDoc = {
      header,
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim().length > 30
          ? parsed.summary.trim()
          : master.summary_variants[0].text,
      summaryId: 'ai_tailored',
      skills: skillsList,
      experience: expList,
      projects: projList,
      education: buildEducation(master),
    };

    let report = scoreDoc(master, doc, jd);

    // Guaranteed ATS 100 Coverage Pass:
    // If the LLM omitted any target keywords from the JD that exist in the master profile,
    // inject them into the relevant skill category so coverage is 100% and score is 100/100!
    if (report.missing.length > 0) {
      for (const m of report.missing) {
        let category = doc.skills.find(
          (g) => g.category.toLowerCase() === m.group.toLowerCase()
        );
        if (!category) {
          category = doc.skills.find(
            (g) =>
              m.group.toLowerCase().includes(g.category.toLowerCase()) ||
              g.category.toLowerCase().includes(m.group.toLowerCase())
          );
        }
        if (!category && doc.skills.length > 0) {
          category = doc.skills[doc.skills.length - 1];
        }
        if (category && !category.items.some((it) => it.toLowerCase() === m.display.toLowerCase())) {
          category.items.unshift(m.display);
        }
      }
      report = scoreDoc(master, doc, jd);
    }

    return {
      ok: true,
      resume: doc,
      report,
      usedAi: true,
    };
  } catch (err) {
    console.warn('[aiTailorResume] LLM generation failed, falling back to deterministic:', err);
    const fallback = await tailorResume({ master, jd });
    return {
      ok: fallback.ok,
      resume: fallback.resume,
      report: fallback.report,
      usedAi: false,
    };
  }
}

function parseJsonFromResponse(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  cleaned = cleaned.trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // Remove trailing commas before } or ]
  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');

  return JSON.parse(cleaned);
}
