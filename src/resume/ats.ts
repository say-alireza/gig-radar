// src/resume/ats.ts
// Deterministic ATS engine for GigRadar: no LLM, no invention.
// It measures how much of the job description is covered by vocabulary that
// already exists in the master resume. Everything else is reported as a gap
// and is never written into the resume.

export type Severity = 'critical' | 'important' | 'nice';

export interface AtsKeyword { display: string; core: string; aliases: string[]; group: string; }
export interface KeywordHit { display: string; group: string; aliases: string[]; severity: Severity; inJd: number; inResume: number; matched: boolean; }
export interface FormatCheck { id: string; label: string; weight: number; pass: boolean; hint: string; }

export interface AtsReport {
  score: number;
  formatScore: number;
  keywordScore: number;
  formatMax: number;
  keywordMax: number;
  coverage: number;
  keywords: KeywordHit[];
  matched: KeywordHit[];
  missing: KeywordHit[];
  gaps: { term: string; inJd: number }[];
  format: FormatCheck[];
  notes: string[];
  stalled: boolean;
}

export const FORMAT_MAX = 50;
export const KEYWORD_MAX = 50;

export const HEADERS = {
  summary: 'Professional Summary',
  skills: 'Skills',
  experience: 'Professional Experience',
  projects: 'Projects',
  education: 'Education',
};

export const SKILL_GROUP_LABELS: Record<string, string> = {
  languages: 'Languages',
  frontend: 'Frontend',
  backend: 'Backend',
  data: 'Data',
  cloud_devops: 'Cloud & DevOps',
  tools: 'Tools',
  stack: 'Stack',
};

const ALIAS_TABLE: Record<string, string[]> = {
  typescript: ['ts'],
  javascript: ['js', 'es6', 'es6+'],
  react: ['reactjs', 'react.js'],
  'next.js': ['nextjs', 'next js'],
  'tailwind css': ['tailwind', 'tailwindcss'],
  'node.js': ['nodejs'],
  'django rest framework': ['drf'],
  'restful apis': ['rest api', 'rest apis', 'restful api', 'rest'],
  websockets: ['websocket', 'socket.io'],
  postgresql: ['postgres'],
  'cloudflare d1': ['d1'],
  'cloudflare kv': ['kv'],
  'cloudflare pages': ['cf pages'],
  'cloudflare workers': ['cf workers'],
  'ci/cd': ['ci cd', 'cicd', 'continuous integration'],
  'github actions': ['gh actions'],
  'edge compute': ['edge functions', 'edge runtime', 'edge'],
  'core web vitals': ['web vitals', 'cwv', 'lighthouse'],
  'web performance optimization': ['performance optimization', 'web performance'],
  'agile/scrum': ['agile', 'scrum'],
  'linux/bash': ['linux', 'bash', 'shell'],
  'git/github': ['git', 'github'],
  'redux toolkit': ['redux'],
  'chakra ui': ['chakra'],
  'shadcn/ui': ['shadcn'],
  sass: ['scss'],
  html5: ['html'],
  'css3 / sass': ['css', 'css3'],
  sqlite: ['sqlite3'],
  vite: ['vitejs'],
  'framer motion': ['framer'],
  docker: ['containers'],
};

const FIRST_TOKEN_STOP = ['web', 'api', 'core', 'the', 'and', 'full', 'app', 'new', 'cloud'];

const COMMON_TECH = ['kubernetes', 'aws', 'gcp', 'azure', 'terraform', 'graphql', 'redis', 'kafka', 'mongodb', 'mysql', 'vue', 'angular', 'svelte', 'laravel', 'rails', 'golang', 'rust', 'java', 'kotlin', 'swift', 'php', 'ruby', 'spring', 'nuxt', 'jest', 'cypress', 'playwright', 'webpack', 'figma', 'jira', 'microservices', 'prisma', 'supabase', 'firebase', 'stripe', 'oauth', 'jwt', 'nginx', 'elastic', 'grpc', 'sentry', 'jenkins', 'ansible'];

function esc(s: string): string {
  const special = '\\^$.*+?()[]{}|';
  return s.split('').map((c) => (special.indexOf(c) >= 0 ? '\\' + c : c)).join('');
}

const KEEP_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789+#./- ';

export function normalize(s: string): string {
  let t = String(s === null || s === undefined ? '' : s).toLowerCase();
  const q1 = String.fromCharCode(8216);
  const q2 = String.fromCharCode(8217);
  const q3 = String.fromCharCode(8220);
  const q4 = String.fromCharCode(8221);
  const apo = String.fromCharCode(39);
  t = t.split(q1).join(apo).split(q2).join(apo).split(q3).join('').split(q4).join('');
  let out = '';
  for (const ch of t) out += KEEP_CHARS.indexOf(ch) >= 0 ? ch : ' ';
  while (out.indexOf('  ') >= 0) out = out.split('  ').join(' ');
  return out.trim();
}

export function coreName(display: string): string {
  const n = normalize(display);
  const a = n.indexOf('(');
  if (a < 0) return n;
  const b = n.indexOf(')');
  const rest = b >= 0 ? n.slice(b + 1) : '';
  return (n.slice(0, a) + ' ' + rest).split('  ').join(' ').trim();
}

function aliasLookup(name: string): string[] {
  if (ALIAS_TABLE[name]) return ALIAS_TABLE[name];
  const keys = Object.keys(ALIAS_TABLE);
  for (const k of keys) if (name.indexOf(k) >= 0) return ALIAS_TABLE[k];
  for (const k of keys) if (k.indexOf(name) >= 0 && name.length >= 3) return ALIAS_TABLE[k];
  return [];
}

export function aliasesFor(display: string): string[] {
  const set: string[] = [];
  const add = (v: string) => {
    const x = normalize(v);
    if (x && x.length >= 2 && set.indexOf(x) < 0) set.push(x);
  };
  const n = normalize(display);
  const core = coreName(display);
  add(n);
  add(core);
  const beforeParen = n.indexOf('(') >= 0 ? n.slice(0, n.indexOf('(')) : n;
  add(beforeParen);
  for (const a of aliasLookup(n)) add(a);
  for (const a of aliasLookup(core)) add(a);
  if (n.slice(-3) === '.js') add(n.slice(0, -3));
  if (core.slice(-3) === '.js') add(core.slice(0, -3));
  const tokens = n.split(' ');
  if (tokens.length > 1 && tokens[0].length >= 3 && FIRST_TOKEN_STOP.indexOf(tokens[0]) < 0) add(tokens[0]);
  return set;
}

export function countOccurrences(text: string, aliases: string[]): number {
  const hay = ' ' + normalize(text) + ' ';
  let total = 0;
  for (const alias of aliases) {
    const a = normalize(alias);
    if (!a) continue;
    const re = new RegExp('(?<![a-z0-9+#.])' + esc(a) + '(?![a-z0-9+#])', 'g');
    const m = hay.match(re);
    if (m) total += m.length;
  }
  return total;
}

export function buildVocabulary(master: any): AtsKeyword[] {
  const out: AtsKeyword[] = [];
  const seen: string[] = [];
  const push = (display: any, group: string) => {
    if (typeof display !== 'string' || !display.trim()) return;
    const core = coreName(display);
    if (!core || seen.indexOf(core) >= 0) return;
    seen.push(core);
    out.push({ display: display.trim(), core, aliases: aliasesFor(display), group });
  };
  const skills = (master && master.skills) || {};
  for (const key of Object.keys(skills)) {
    const group = SKILL_GROUP_LABELS[key] || key;
    const items = skills[key];
    if (Array.isArray(items)) for (const i of items) push(i, group);
  }
  for (const exp of (master && master.experience) || []) for (const s of exp.stack || []) push(s, 'Stack');
  for (const pr of (master && master.projects) || []) for (const s of pr.stack || []) push(s, 'Stack');
  return out;
}

export function extractJdKeywords(jd: string, vocab: AtsKeyword[]): KeywordHit[] {
  const head = jd.slice(0, Math.max(240, Math.floor(jd.length * 0.25)));
  const hits: KeywordHit[] = [];
  for (const k of vocab) {
    const inJd = countOccurrences(jd, k.aliases);
    if (inJd === 0) continue;
    const inHead = countOccurrences(head, k.aliases);
    let severity: Severity = inJd >= 3 ? 'critical' : inJd === 2 ? 'important' : 'nice';
    if (severity === 'nice' && inHead > 0) severity = 'important';
    if (severity === 'important' && inHead >= 2) severity = 'critical';
    hits.push({ display: k.display, group: k.group, aliases: k.aliases, severity, inJd, inResume: 0, matched: false });
  }
  hits.sort((a, b) => b.inJd - a.inJd || a.display.localeCompare(b.display));
  return hits;
}

export function severityWeight(s: Severity): number {
  return s === 'critical' ? 3 : s === 'important' ? 2 : 1;
}

export function findGaps(jd: string, vocab: AtsKeyword[]): { term: string; inJd: number }[] {
  const blob = ' ' + vocab.map((v) => v.aliases.join(' ')).join(' ') + ' ';
  const gaps: { term: string; inJd: number }[] = [];
  for (const term of COMMON_TECH) {
    const n = normalize(term);
    if (blob.indexOf(n) >= 0) continue;
    const inJd = countOccurrences(jd, [term]);
    if (inJd > 0) gaps.push({ term, inJd });
  }
  return gaps.sort((a, b) => b.inJd - a.inJd);
}

function bulletText(b: any): string {
  if (typeof b === 'string') return b.trim();
  if (b && typeof b.text === 'string') return b.text.trim();
  return '';
}

export function renderResumeText(r: any): string {
  const L: string[] = [];
  const h = (r && r.header) || {};
  const push = (s: string) => {
    const t = String(s === null || s === undefined ? '' : s).trim();
    if (t) L.push(t);
  };
  push(h.name || 'Candidate');
  push(h.headline || '');
  push(h.location || '');
  const contacts: string[] = [];
  for (const k of ['email', 'phone', 'website', 'github', 'linkedin', 'telegram']) {
    const v = h[k];
    if (typeof v === 'string' && v.trim()) contacts.push(v.trim());
  }
  if (contacts.length) push(contacts.join(' | '));
  L.push('');
  if (r && r.summary) {
    push(HEADERS.summary);
    push(String(r.summary));
    L.push('');
  }
  const skills = Array.isArray(r && r.skills) ? r.skills : [];
  if (skills.length) {
    push(HEADERS.skills);
    for (const g of skills) {
      const items = Array.isArray(g && g.items) ? g.items.filter((x: any) => typeof x === 'string' && x.trim()) : [];
      if (!items.length) continue;
      push(String((g && g.category) || 'Skills') + ': ' + items.join(', '));
    }
    L.push('');
  }
  const exp = Array.isArray(r && r.experience) ? r.experience : [];
  if (exp.length) {
    push(HEADERS.experience);
    for (const e of exp) {
      push(String(e.title || '') + (e.company ? ' - ' + e.company : ''));
      const meta: string[] = [];
      if (e.location) meta.push(String(e.location));
      const yrs = [e.start, e.end].filter((x: any) => x).join(' - ');
      if (yrs) meta.push(yrs);
      if (meta.length) push(meta.join(' | '));
      const stack = Array.isArray(e.stack) ? e.stack.filter((x: any) => typeof x === 'string' && x.trim()) : [];
      if (stack.length) push('Tech: ' + stack.join(', '));
      for (const b of e.bullets || []) {
        const t = bulletText(b);
        if (t) push('- ' + t);
      }
      L.push('');
    }
  }
  const proj = Array.isArray(r && r.projects) ? r.projects : [];
  if (proj.length) {
    push(HEADERS.projects);
    for (const p of proj) {
      const stack = Array.isArray(p && p.stack) ? p.stack.filter((x: any) => typeof x === 'string' && x.trim()).join(', ') : '';
      push(String((p && p.name) || '') + (stack ? ' | ' + stack : ''));
      for (const b of (p && p.bullets) || []) {
        const t = bulletText(b);
        if (t) push('- ' + t);
      }
      L.push('');
    }
  }
  const edu = Array.isArray(r && r.education) ? r.education : [];
  if (edu.length) {
    push(HEADERS.education);
    for (const d of edu) {
      push(String((d && d.degree) || '') + (d && d.school ? ' - ' + d.school : ''));
      const yrs = [d && d.start, d && d.end].filter((x: any) => x).join(' - ');
      if (yrs) push(yrs);
    }
  }
  while (L.length && !L[L.length - 1]) L.pop();
  let out = L.join('\n');
  while (out.indexOf('\n\n\n') >= 0) out = out.split('\n\n\n').join('\n\n');
  return out + '\n';
}

export function checkFormat(text: string, resume: any): FormatCheck[] {
  const lines = text.split('\n');
  const head = lines.slice(0, 8).join('\n');
  const has = (h: string) => text.indexOf(h) >= 0;
  const body = lines.slice(6);
  const tableRows = body.filter((l) => l.split('|').length - 1 >= 3 || l.indexOf('\t') >= 0);
  const bulletLines = lines.filter((l) => l.trim().slice(0, 2) === '- ' || l.trim().slice(0, 2) === '* ');
  const oddBullets = lines.filter((l) => l.trim().slice(0, 2) === 'o ' || l.trim().slice(0, 2) === '> ');
  const email = resume && resume.header ? resume.header.email : '';
  const emailInBody = typeof email === 'string' && email.length > 0 && head.indexOf(email) >= 0;
  return [
    { id: 'hdr_summary', label: 'Standard heading: ' + HEADERS.summary, weight: 8, pass: has(HEADERS.summary), hint: 'Add the standard heading ' + HEADERS.summary + '.' },
    { id: 'hdr_skills', label: 'Standard heading: ' + HEADERS.skills, weight: 8, pass: has(HEADERS.skills), hint: 'Add the standard heading ' + HEADERS.skills + '.' },
    { id: 'hdr_experience', label: 'Standard heading: ' + HEADERS.experience, weight: 10, pass: has(HEADERS.experience), hint: 'Add the standard heading ' + HEADERS.experience + '.' },
    { id: 'hdr_education', label: 'Standard heading: ' + HEADERS.education, weight: 6, pass: has(HEADERS.education), hint: 'Add the standard heading ' + HEADERS.education + '.' },
    { id: 'contact_body', label: 'Contact details inside the body (not a header/footer)', weight: 6, pass: emailInBody, hint: 'Put the email and links in the first lines of the body.' },
    { id: 'no_tables', label: 'No tables, columns or tabs', weight: 6, pass: tableRows.length === 0, hint: 'Remove table/column layouts; ATS parsers cannot read them.' },
    { id: 'bullets', label: 'Standard dash bullet points only', weight: 6, pass: bulletLines.length > 0 && oddBullets.length === 0, hint: 'Use only simple dash bullets.' },
  ];
}

export function scoreResume(resume: any, jd: string, vocab: AtsKeyword[]): AtsReport {
  const text = renderResumeText(resume);
  const format = checkFormat(text, resume);
  const formatScore = format.reduce((s, c) => s + (c.pass ? c.weight : 0), 0);
  const base = extractJdKeywords(jd, vocab);
  const keywords: KeywordHit[] = base.map((h) => {
    const inResume = countOccurrences(text, h.aliases);
    return { display: h.display, group: h.group, aliases: h.aliases, severity: h.severity, inJd: h.inJd, inResume, matched: inResume > 0 };
  });
  let totalW = 0;
  let gotW = 0;
  for (const k of keywords) {
    const w = severityWeight(k.severity);
    totalW += w;
    if (k.matched) gotW += w;
  }
  const coverage = totalW > 0 ? gotW / totalW : 0;
  const keywordScore = totalW > 0 ? Math.round(KEYWORD_MAX * coverage) : 0;
  const missing = keywords.filter((k) => !k.matched);
  const gaps = findGaps(jd, vocab);
  const notes: string[] = [];
  let stalled = false;
  if (vocab.length === 0) {
    stalled = true;
    notes.push('Empty vocabulary: master resume skills/stacks did not load.');
  }
  if (totalW === 0) {
    stalled = true;
    notes.push('No master-resume term appeared in this job description, so there is nothing to match.');
  }
  for (const c of format) if (!c.pass) notes.push('Format: ' + c.hint);
  if (gaps.length) notes.push(gaps.length + ' JD term(s) are not in the master resume and were NOT added: ' + gaps.slice(0, 8).map((g) => g.term).join(', '));
  return {
    score: Math.min(100, formatScore + keywordScore),
    formatScore,
    keywordScore,
    formatMax: FORMAT_MAX,
    keywordMax: KEYWORD_MAX,
    coverage,
    keywords,
    matched: keywords.filter((k) => k.matched),
    missing,
    gaps,
    format,
    notes,
    stalled,
  };
}

export function masterBulletIndex(master: any): Record<string, string> {
  const map: Record<string, string> = {};
  const walk = (arr: any) => {
    if (!Array.isArray(arr)) return;
    for (const b of arr) {
      const id = typeof b === 'string' ? null : b && b.id;
      const text = typeof b === 'string' ? b : b && b.text;
      if (id && text) map[normalize(text)] = String(id);
    }
  };
  for (const e of (master && master.experience) || []) walk(e.bullets);
  for (const p of (master && master.projects) || []) walk(p.bullets);
  return map;
}

export function validateNoInvention(resume: any, master: any): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const bIndex = masterBulletIndex(master);
  const knownIds: Record<string, boolean> = {};
  for (const k of Object.keys(bIndex)) knownIds[bIndex[k]] = true;
  const companies: string[] = [];
  const titles: string[] = [];
  const names: string[] = [];
  const years: Record<string, boolean> = {};
  for (const e of (master && master.experience) || []) {
    if (e.company) companies.push(normalize(e.company));
    if (e.title) titles.push(normalize(e.title));
  }
  names.push(...companies);
  for (const p of (master && master.projects) || []) if (p.name) names.push(normalize(p.name));
  for (const m of String(JSON.stringify(master || '')).match(/(19|20)[0-9]{2}/g) || []) years[m] = true;
  const close = (a: string, list: string[]) => list.some((x) => x === a || x.indexOf(a) >= 0 || a.indexOf(x) >= 0);
  for (const e of (resume && resume.experience) || []) {
    const c = normalize(e.company || '');
    if (c && !close(c, companies)) errors.push('Unknown employer not present in master resume: ' + e.company);
    const t = normalize(e.title || '');
    if (t && !close(t, titles)) warnings.push('Job title reworded beyond master: ' + e.title);
    for (const y of (String(e.start || '') + ' ' + String(e.end || '')).match(/(19|20)[0-9]{2}/g) || []) {
      if (!years[y]) errors.push('Unknown year not present in master resume: ' + y);
    }
    for (const b of e.bullets || []) {
      const id = typeof b === 'string' ? null : b && b.id;
      const text = bulletText(b);
      if (id && !knownIds[String(id)]) errors.push('Unknown bullet id: ' + id);
      if (!id) warnings.push('Bullet without master id (unverifiable): ' + text.slice(0, 60));
    }
  }
  for (const p of (resume && resume.projects) || []) {
    const n = normalize(p.name || '');
    if (n && !close(n, names)) warnings.push('Project not present in master resume: ' + p.name);
    for (const b of p.bullets || []) {
      const id = typeof b === 'string' ? null : b && b.id;
      if (id && !knownIds[String(id)]) errors.push('Unknown project bullet id: ' + id);
    }
  }
  return { errors, warnings };
}
