import { ResumeDoc, buildHeader, buildEducation, buildSkills, tailorResume, scoreDoc } from './tailor';
import { AtsReport } from './ats';

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

  const prompt = `You are a Principal Technical Recruiter and ATS Optimization Expert.
Your task is to tailor a software engineer's resume for a specific Job Description (JD).

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

### TARGET JOB DESCRIPTION:
${jd.slice(0, 3500)}

### INSTRUCTIONS:
1. "headline": Create a targeted professional headline aligning the candidate's core stack (React, Next.js, Django, TypeScript, Tailwind) with the target job title.
2. "summary": Write an impactful 3-4 sentence Professional Summary. Highlight candidate's actual projects (EPD Community, PIMS, GameHub) and relevant stack to directly address the JD requirements.
3. "experience": For each company (exp_epd, exp_pims, exp_intern, exp_freelance), select the top 3-4 most relevant achievement bullets. You MAY rephrase bullets to emphasize matching technologies, but DO NOT invent fake companies, dates, or metrics.
4. "projects": Select the 2-3 most relevant projects that showcase the skills needed in the JD, with 2-3 tailored bullets each.
5. "skills": Reorder skill items in each category so that skills mentioned in the JD appear first.

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
    const response: any = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'system',
          content:
            'You are an expert technical resume writer. Return valid JSON only, without any Markdown codeblocks or conversational text.',
        },
        { role: 'user', content: prompt },
      ],
      max_tokens: 2048,
      temperature: 0.2,
    });

    const responseText = response?.response?.trim() || '';
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

    const report = scoreDoc(master, doc, jd);

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
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}
