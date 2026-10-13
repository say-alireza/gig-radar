// scripts/ats-check.ts
// Runnable proof that the tailoring pipeline actually reaches ATS 100.
// Bundled with esbuild and executed with node (see `npm run check:ats`).
// It never touches Cloudflare: ats.ts / tailor.ts / docx.ts are pure code.

import { writeFileSync, mkdirSync } from 'fs';
import master from '../resume/master.json';
import { tailorResume } from '../src/resume/tailor';
import { buildDocx, resumeFilename } from '../src/resume/docx';

const JDS: { name: string; text: string }[] = [
  {
    name: 'React / Django contract',
    text: `Contract Full-Stack Developer (Remote, 6 months)
We need a full-stack engineer to build and maintain customer-facing web apps.
Requirements:
- 3+ years with React and TypeScript
- Next.js (App Router) experience
- Python and Django REST Framework for backend APIs
- PostgreSQL schema design and query optimisation
- RESTful API design and WebSockets for real-time features
- Tailwind CSS, responsive and accessible UI
- Docker, Git, GitHub Actions CI/CD
- Cloudflare Workers / Pages edge deployment is a big plus
- Agile/Scrum team, code reviews, English communication
Nice to have: Vite, Framer Motion, Core Web Vitals, Linux/Bash.`,
  },
  {
    name: 'Next.js frontend contract',
    text: `Frontend Engineer (Contract, remote, part-time)
Stack: Next.js, React 18, TypeScript, Tailwind CSS, Chakra UI, shadcn/ui, Redux Toolkit, Vite.
You will own performance: Core Web Vitals, Lighthouse 95+, web performance optimisation, accessibility.
Bonus: SASS, Framer Motion animations, Vercel deployments, Git/GitHub workflow.`,
  },
  {
    name: 'Python backend / automation',
    text: `Backend Developer (contract, remote)
Build RESTful APIs in Python with Django and Django REST Framework. PostgreSQL and SQLite data modelling.
Telegram Bot API integrations, webhook handling, payment callbacks.
Cloudflare Workers, D1, KV, edge compute. Docker, CI/CD, GitHub Actions, Linux/Bash, Postman.
Must be comfortable with Git-based code review and Agile sprints.`,
  },
];

async function main() {
  mkdirSync('.tmp', { recursive: true });
  let failures = 0;

  for (const jd of JDS) {
    const r = await tailorResume({ master: master as any, jd: jd.text });
    const rep = r.report;
    const ok = rep.score === 100 && r.errors.length === 0;
    if (!ok) failures++;

    console.log('--------------------------------------------------------------');
    console.log(`JD: ${jd.name}`);
    console.log(`score=${rep.score}/100  format=${rep.formatScore}/${rep.formatMax}  keywords=${rep.keywordScore}/${rep.keywordMax}`);
    console.log(`matched=${rep.matched.length}/${rep.keywords.length}  coverage=${(rep.coverage * 100).toFixed(0)}%`);
    console.log(`attempts=${r.attempts}  usedLlm=${r.usedLlm}  noInventionErrors=${r.errors.length}`);
    if (rep.keywords.length && rep.keywords.length <= 12) {
      console.log('keywords: ' + rep.keywords.map((k) => k.display + (k.matched ? '' : ' [MISSING]')).join(', '));
    }
    if (rep.gaps.length) console.log('gaps (not in master, never added): ' + rep.gaps.map((g) => g.term).join(', '));
    if (rep.notes.length) console.log('notes: ' + rep.notes.join(' | '));
    if (r.errors.length) console.log('ERRORS: ' + r.errors.join(' | '));
    if (r.warnings.length) console.log('warnings: ' + r.warnings.slice(0, 5).join(' | '));
    console.log(`status: ${ok ? 'PASS' : 'FAIL'}`);

    if (jd === JDS[0]) {
      const bytes = buildDocx(r.resume);
      const file = '.tmp/' + resumeFilename(r.resume.header.name, 'contract');
      writeFileSync(file, bytes);
      console.log(`docx written: ${file} (${bytes.length} bytes)`);
      console.log(`docx valid zip signature: ${bytes[0] === 0x50 && bytes[1] === 0x4b}`);
    }
  }

  console.log('--------------------------------------------------------------');
  console.log(failures === 0 ? 'ALL PASS (score 100, zero invention errors)' : `${failures} FAILED`);
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error('check failed:', e);
  process.exit(1);
});