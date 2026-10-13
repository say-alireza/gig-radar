// src/resume/tailor.ts
// Tailoring pipeline for GigRadar.
//
// Hard rule (same as the ATS skill): the LLM may only SELECT and REORDER
// material that already exists in resume/master.json. It never writes new
// companies, titles, dates, metrics or technologies. Every bullet that ends up
// in the output carries the master id it came from, and validateNoInvention()
// rejects anything that cannot be traced back.
//
// Pipeline:
//   1. buildVocabulary(master)  -> deterministic keyword table
//   2. planTailoring()          -> deterministic bullet selection + summary pick
//   3. assembleResume()         -> ResumeDoc with standard ATS headings
//   4. scoreResume()            -> deterministic ATS score (no LLM)
//   5. improve loop             -> re-assemble until score === 100 or stalled
//
// The LLM (Cloudflare Workers AI, free tier) is optional and only used to pick
// which master bullet ids are most relevant. If it fails or returns junk we
// fall back to the deterministic keyword-overlap ranking, so the pipeline never
// blocks on the model.

import {
  AtsKeyword,
  AtsReport,
  buildVocabulary,
  normalize,
  renderResumeText,
  scoreResume,
  validateNoInvention,
} from './ats';

export interface ResumeHeader {
  name: string;
  headline: string;
  location: string;
  email: string;
  phone?: string;
  website?: string;
  github?: string;
  linkedin?: string;
  telegram?: string;
}

export interface ResumeSkillGroup {
  category: string;
  items: string[];
}

export interface ResumeBullet {
  id: string;
  text: string;
}

export interface ResumeExperience {
  id: string;
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  bullets: ResumeBullet[];
}

export interface ResumeProject {
  id: string;
  name: string;
  year: string;
  stack: string[];
  bullets: ResumeBullet[];
}

export interface ResumeEducation {
  id: string;
  degree: string;
  school: string;
  start: string;
  end: string;
}

export interface ResumeDoc {
  header: ResumeHeader;
  summary: string;
  summaryId: string;
  skills: ResumeSkillGroup[];
  experience: ResumeExperience[];
  projects: ResumeProject[];
  education: ResumeEducation[];
}

export interface TailorOptions {
  maxBulletsPerRole?: number;
  maxProjects?: number;
  targetScore?: number;
}

export interface TailorResult {
  ok: boolean;
  resume: ResumeDoc;
  text: string;
  report: AtsReport;
  attempts: number;
  usedLlm: boolean;
  errors: string[];
  warnings: string[];
  notes: string[];
}

// Defaults are deliberately "keep everything from the master file".
// The ATS score is a coverage score: it counts how many of the job
// description's terms that ALREADY EXIST in master.json also appear in the
// tailored document. Dropping a bullet or a project would drop the keywords
// that live inside it and the score could never reach 100. Since every kept
// line is copied verbatim from master.json, keeping everything is still
// zero-invention. Callers that want a shorter one-pager can pass their own
// maxBulletsPerRole / maxProjects in opts.
const DEFAULTS: Required<TailorOptions> = {
  maxBulletsPerRole: 99,
  maxProjects: 99,
  targetScore: 100,
};

const SKILL_ORDER = ['languages', 'frontend', 'backend', 'data', 'cloud_devops', 'tools'];

const SKILL_LABELS: Record<string, string> = {
  languages: 'Languages',
  frontend: 'Frontend',
  backend: 'Backend',
  data: 'Data',
  cloud_devops: 'Cloud & DevOps',
  tools: 'Tools',
};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function str(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
}

function bulletText(b: any): string {
  if (typeof b === 'string') return b.trim();
  if (b && typeof b.text === 'string') return b.text.trim();
  return '';
}

function bulletId(b: any, fallback: string): string {
  if (b && typeof b.id === 'string' && b.id.trim()) return b.id.trim();
  return fallback;
}

/** Count how many of the given alias groups appear in the text. */
function hitCount(text: string, groups: string[][]): number {
  const hay = ' ' + normalize(text) + ' ';
  let n = 0;
  for (const aliases of groups) {
    for (const a of aliases) {
      const needle = normalize(a);
      if (!needle) continue;
      if (hay.indexOf(' ' + needle) >= 0 || hay.indexOf(needle + ' ') >= 0) {
        n++;
        break;
      }
    }
  }
  return n;
}

/** Turn JD keywords into alias-groups used for relevance ranking. */
function jdGroups(jd: string, vocab: AtsKeyword[]): { group: string[]; weight: number }[] {
  const out: { group: string[]; weight: number }[] = [];
  for (const k of vocab) {
    const hits = countOccurrencesLoose(jd, k.aliases);
    if (hits > 0) out.push({ group: k.aliases, weight: hits });
  }
  return out;
}

function countOccurrencesLoose(text: string, aliases: string[]): number {
  const hay = ' ' + normalize(text) + ' ';
  let total = 0;
  for (const a of aliases) {
    const needle = normalize(a);
    if (!needle) continue;
    let from = 0;
    while (true) {
      const at = hay.indexOf(needle, from);
      if (at < 0) break;
      total++;
      from = at + needle.length;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// step 1 — header / skills / education (never trimmed: ATS wants them complete)
// ---------------------------------------------------------------------------

export function buildHeader(master: any): ResumeHeader {
  const id = (master && master.identity) || {};
  const links = id.links || {};
  return {
    name: str(id.full_name) || 'Candidate',
    headline: str(id.headline),
    location: str(id.location),
    email: str(links.email),
    website: str(links.website),
    github: str(links.github),
    linkedin: str(links.linkedin),
    telegram: str(links.telegram),
  };
}

export function buildSkills(master: any): ResumeSkillGroup[] {
  const skills = (master && master.skills) || {};
  const keys = Object.keys(skills);
  const ordered = SKILL_ORDER.filter((k) => keys.indexOf(k) >= 0).concat(
    keys.filter((k) => SKILL_ORDER.indexOf(k) < 0)
  );
  const out: ResumeSkillGroup[] = [];
  for (const key of ordered) {
    const items = asArray(skills[key]).filter((x: any) => typeof x === 'string' && x.trim());
    if (!items.length) continue;
    out.push({ category: SKILL_LABELS[key] || key, items: items.map((x: string) => x.trim()) });
  }
  return out;
}

export function buildEducation(master: any): ResumeEducation[] {
  return asArray(master && master.education).map((e: any, i: number) => ({
    id: str(e.id) || 'edu_' + i,
    degree: str(e.degree),
    school: str(e.school),
    start: str(e.start),
    end: str(e.end),
  }));
}

// ---------------------------------------------------------------------------
// step 2 — summary pick (deterministic; the LLM may override the choice only)
// ---------------------------------------------------------------------------

export function pickSummary(master: any, jd: string, vocab: AtsKeyword[]): { id: string; text: string } {
  const variants = asArray(master && master.summary_variants).filter(
    (v: any) => v && typeof v.text === 'string' && v.text.trim()
  );
  if (!variants.length) return { id: 'sum_none', text: '' };
  const groups = jdGroups(jd, vocab).map((g) => g.group);
  let best = variants[0];
  let bestScore = -1;
  for (const v of variants) {
    const s = hitCount(v.text, groups);
    if (s > bestScore) {
      bestScore = s;
      best = v;
    }
  }
  return { id: str(best.id) || 'sum_default', text: str(best.text) };
}

// ---------------------------------------------------------------------------
// step 3 — bullet selection (deterministic ranking; LLM may reorder)
// ---------------------------------------------------------------------------

export interface BulletPick {
  id: string;
  text: string;
  score: number;
  tags: string[];
}

export function rankBullets(bullets: any[], jd: string, vocab: AtsKeyword[]): BulletPick[] {
  const groups = jdGroups(jd, vocab).map((g) => g.group);
  return asArray(bullets)
    .map((b: any, i: number) => {
      const text = bulletText(b);
      const tags = asArray(b && b.tags).map((t: any) => str(t)).filter(Boolean);
      let score = hitCount(text, groups);
      // tag overlap with the JD is a strong signal
      for (const t of tags) if (normalize(jd).indexOf(normalize(t)) >= 0) score += 2;
      return { id: bulletId(b, 'auto_b' + i), text, score, tags };
    })
    .filter((b) => b.text.length > 0)
    .sort((a, b) => b.score - a.score);
}

export interface RolePlan {
  id: string;
  title: string;
  company: string;
  location: string;
  start: string;
  end: string;
  relevance: number;
  bullets: BulletPick[];
}

export function planRoles(master: any, jd: string, vocab: AtsKeyword[], opts: TailorOptions): RolePlan[] {
  const o = { ...DEFAULTS, ...opts };
  const plans: RolePlan[] = [];
  for (const e of asArray(master && master.experience)) {
    const ranked = rankBullets(e.bullets, jd, vocab);
    const roleText = [str(e.title), str(e.company), asArray(e.stack).join(' ')].join(' ');
    const relevance = hitCount(roleText, jdGroups(jd, vocab).map((g) => g.group));
    plans.push({
      id: str(e.id) || 'exp',
      title: str(e.title),
      company: str(e.company),
      location: str(e.location),
      start: str(e.start),
      end: str(e.end),
      relevance,
      bullets: ranked.slice(0, Math.max(1, Math.min(o.maxBulletsPerRole, ranked.length))),
    });
  }
  // Most relevant role first; ties keep master order (stable sort).
  return plans.sort((a, b) => b.relevance - a.relevance);
}

export interface ProjectPlan {
  id: string;
  name: string;
  year: string;
  stack: string[];
  relevance: number;
  bullets: BulletPick[];
}

export function planProjects(master: any, jd: string, vocab: AtsKeyword[], opts: TailorOptions): ProjectPlan[] {
  const o = { ...DEFAULTS, ...opts };
  const groups = jdGroups(jd, vocab).map((g) => g.group);
  const plans: ProjectPlan[] = [];
  for (const p of asArray(master && master.projects)) {
    const stack = asArray(p.stack).map((s: any) => str(s)).filter(Boolean);
    const ranked = rankBullets(p.bullets, jd, vocab);
    const relevance = hitCount([str(p.name), stack.join(' ')].join(' '), groups);
    plans.push({
      id: str(p.id) || 'proj',
      name: str(p.name),
      year: str(p.year),
      stack,
      relevance,
      bullets: ranked.slice(0, Math.max(1, ranked.length)),
    });
  }
  return plans.sort((a, b) => b.relevance - a.relevance).slice(0, Math.max(1, o.maxProjects));
}

// ---------------------------------------------------------------------------
// step 4 — assemble
// ---------------------------------------------------------------------------

export interface Plan {
  summaryId: string;
  summary: string;
  experienceOrder: string[];
  projectsOrder: string[];
  bulletOrder: Record<string, string[]>;
}

export function assembleResume(master: any, plan: Plan): ResumeDoc {
  const roleMap: Record<string, RolePlan> = {};
  for (const r of planRoles(master, plan.summary, buildVocabulary(master), {})) roleMap[r.id] = r;
  const projMap: Record<string, ProjectPlan> = {};
  for (const p of planProjects(master, plan.summary, buildVocabulary(master), {})) projMap[p.id] = p;

  const orderRoles = (ids: string[], map: Record<string, any>, fallback: string[]) => {
    const seen: string[] = [];
    const out: any[] = [];
    for (const id of ids) {
      const item = map[id];
      if (item && seen.indexOf(id) < 0) {
        seen.push(id);
        out.push(item);
      }
    }
    for (const id of fallback) {
      if (seen.indexOf(id) < 0 && map[id]) {
        seen.push(id);
        out.push(map[id]);
      }
    }
    return out;
  };

  const reorderBullets = (picks: BulletPick[], wanted: string[] | undefined): BulletPick[] => {
    if (!wanted || !wanted.length) return picks;
    const index: Record<string, number> = {};
    wanted.forEach((id, i) => (index[id] = i));
    const known = picks.filter((p) => index[p.id] !== undefined);
    const rest = picks.filter((p) => index[p.id] === undefined);
    known.sort((a, b) => index[a.id] - index[b.id]);
    return known.concat(rest);
  };

  const roleIds = Object.keys(roleMap);
  const projIds = Object.keys(projMap);

  const experience: ResumeExperience[] = orderRoles(plan.experienceOrder, roleMap, roleIds).map((r: RolePlan) => ({
    id: r.id,
    title: r.title,
    company: r.company,
    location: r.location,
    start: r.start,
    end: r.end,
    bullets: reorderBullets(r.bullets, plan.bulletOrder[r.id]).map((b) => ({ id: b.id, text: b.text })),
  }));

  const projects: ResumeProject[] = orderRoles(plan.projectsOrder, projMap, projIds).map((p: ProjectPlan) => ({
    id: p.id,
    name: p.name,
    year: p.year,
    stack: p.stack,
    bullets: reorderBullets(p.bullets, plan.bulletOrder[p.id]).map((b) => ({ id: b.id, text: b.text })),
  }));

  const summary = plan.summary || pickSummary(master, '', []).text;

  return {
    header: buildHeader(master),
    summary,
    summaryId: plan.summaryId,
    skills: buildSkills(master),
    experience,
    projects,
    education: buildEducation(master),
  };
}

/** Build a plan with zero LLM involvement (pure keyword ranking). */
export function deterministicPlan(master: any, jd: string, opts: TailorOptions = {}): Plan {
  const vocab = buildVocabulary(master);
  const sum = pickSummary(master, jd, vocab);
  const roles = planRoles(master, jd, vocab, opts);
  const projs = planProjects(master, jd, vocab, opts);
  return {
    summaryId: sum.id,
    summary: sum.text,
    experienceOrder: roles.map((r) => r.id),
    projectsOrder: projs.map((p) => p.id),
    bulletOrder: {},
  };
}

// ---------------------------------------------------------------------------
// step 5 — score + repair loop
// ---------------------------------------------------------------------------

/**
 * Repair pass: the deterministic assembly already renders every standard
 * heading, keeps the contact block in the body, uses dash bullets and has no
 * tables — so a well-formed master always reaches 100. This function exists so
 * that a malformed master (e.g. a summary variant containing a tab or a table
 * pipe) cannot silently drag the score down: it strips the offending
 * characters and re-scores.
 */
export function sanitize(doc: ResumeDoc): ResumeDoc {
  const clean = (s: string) =>
    String(s || '')
      .split('\t')
      .join(' ')
      .split('|')
      .join(' / ')
      .split('\n')
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  return {
    header: {
      name: clean(doc.header.name),
      headline: clean(doc.header.headline),
      location: clean(doc.header.location),
      email: doc.header.email,
      phone: doc.header.phone,
      website: doc.header.website,
      github: doc.header.github,
      linkedin: doc.header.linkedin,
      telegram: doc.header.telegram,
    },
    summary: clean(doc.summary),
    summaryId: doc.summaryId,
    skills: doc.skills.map((g) => ({ category: clean(g.category), items: g.items.map(clean) })),
    experience: doc.experience.map((e) => ({
      ...e,
      title: clean(e.title),
      company: clean(e.company),
      location: clean(e.location),
      start: clean(e.start),
      end: clean(e.end),
      bullets: e.bullets.map((b) => ({ id: b.id, text: clean(b.text) })),
    })),
    projects: doc.projects.map((p) => ({
      ...p,
      name: clean(p.name),
      year: clean(p.year),
      stack: p.stack.map(clean),
      bullets: p.bullets.map((b) => ({ id: b.id, text: clean(b.text) })),
    })),
    education: doc.education.map((d) => ({
      ...d,
      degree: clean(d.degree),
      school: clean(d.school),
      start: clean(d.start),
      end: clean(d.end),
    })),
  };
}

export function scoreDoc(master: any, doc: ResumeDoc, jd: string): AtsReport {
  const vocab = buildVocabulary(master);
  return scoreResume(doc, jd, vocab);
}

export interface TailorInput {
  master: any;
  jd: string;
  /** optional LLM reorder callback: returns bullet ids / role ids / summary id */
  planFromLlm?: (req: {
    master: any;
    jd: string;
    candidates: { roles: RolePlan[]; projects: ProjectPlan[]; summaries: { id: string; text: string }[] };
  }) => Promise<Partial<Plan> | null>;
  opts?: TailorOptions;
}

export async function tailorResume(input: TailorInput): Promise<TailorResult> {
  const opts = { ...DEFAULTS, ...(input.opts || {}) };
  const master = input.master;
  const jd = String(input.jd || '');
  const notes: string[] = [];
  let usedLlm = false;

  let plan = deterministicPlan(master, jd, opts);
  let doc = sanitize(assembleResume(master, plan));
  let report = scoreDoc(master, doc, jd);
  let attempts = 1;

  // One optional LLM refinement of the *selection*, never of the content.
  if (input.planFromLlm && !report.stalled) {
    try {
      const vocab = buildVocabulary(master);
      const candidates = {
        roles: planRoles(master, jd, vocab, opts),
        projects: planProjects(master, jd, vocab, opts),
        summaries: asArray(master.summary_variants).map((v: any) => ({ id: str(v.id), text: str(v.text) })),
      };
      const patch = await input.planFromLlm({ master, jd, candidates });
      if (patch && typeof patch === 'object') {
        const merged: Plan = {
          summaryId: str(patch.summaryId) || plan.summaryId,
          summary: str(patch.summary) || plan.summary,
          experienceOrder: asArray(patch.experienceOrder).map((x: any) => str(x)).filter(Boolean),
          projectsOrder: asArray(patch.projectsOrder).map((x: any) => str(x)).filter(Boolean),
          bulletOrder: (patch.bulletOrder && typeof patch.bulletOrder === 'object' ? patch.bulletOrder : {}) as Record<
            string,
            string[]
          >,
        };
        // the LLM may only pick a summary that already exists in the master
        const validSummaryIds = candidates.summaries.map((s) => s.id);
        if (merged.summaryId && validSummaryIds.indexOf(merged.summaryId) < 0) {
          notes.push('LLM picked an unknown summary id (' + merged.summaryId + '); ignored.');
          merged.summaryId = plan.summaryId;
          merged.summary = plan.summary;
        }
        const knownRoleIds = candidates.roles.map((r) => r.id);
        const unknownRoles = merged.experienceOrder.filter((id) => knownRoleIds.indexOf(id) < 0);
        if (unknownRoles.length) {
          notes.push('LLM invented role ids (ignored): ' + unknownRoles.join(', '));
          merged.experienceOrder = merged.experienceOrder.filter((id) => knownRoleIds.indexOf(id) >= 0);
        }
        plan = merged;
        doc = sanitize(assembleResume(master, plan));
        report = scoreDoc(master, doc, jd);
        attempts++;
        usedLlm = true;
      }
    } catch (e: any) {
      notes.push('LLM planning failed, kept deterministic plan: ' + (e && e.message ? e.message : String(e)));
    }
  }

  // Repair loop: sanitize + re-score until the target is hit or we stall.
  let guard = 0;
  while (report.score < opts.targetScore && !report.stalled && guard < 3) {
    guard++;
    doc = sanitize(doc);
    report = scoreDoc(master, doc, jd);
    attempts++;
    if (report.stalled) break;
    if (guard >= 3) break;
    // Nothing left to repair deterministically: report the remaining gap.
    if (report.missing.length === 0 && report.format.every((f) => f.pass)) break;
    notes.push(
      'Could not reach ' +
        opts.targetScore +
        ' on attempt ' +
        attempts +
        '; remaining format gaps: ' +
        report.format
          .filter((f) => !f.pass)
          .map((f) => f.id)
          .join(', ')
    );
    break;
  }

  const check = validateNoInvention(doc, master);
  const text = renderResumeText(doc);

  return {
    ok: check.errors.length === 0,
    resume: doc,
    text,
    report,
    attempts,
    usedLlm,
    errors: check.errors,
    warnings: check.warnings,
    notes: notes.concat(report.notes),
  };
}

export { renderResumeText };