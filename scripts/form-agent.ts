import { chromium, Page } from 'playwright';
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import master from '../resume/master.json';
import { tailorResume } from '../src/resume/tailor';
import { buildPdf } from '../src/resume/pdf';

interface FormField {
  name: string;
  label: string;
  type: string;
  selector: string;
  value?: string;
  required?: boolean;
}

export async function runFormAgent(options: {
  url: string;
  mode: 'inspect' | 'submit';
  botToken?: string;
  chatId?: string;
}) {
  const { url, mode, botToken, chatId } = options;
  console.log(`[FormAgent] Starting in '${mode}' mode for URL: ${url}`);

  mkdirSync('.tmp', { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Istanbul',
  });

  // Stealth: Mask navigator.webdriver
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  let page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // 1. If page has an "Apply" button, follow it to the actual application form/portal
    try {
      const applyTrigger = page
        .locator(
          'a#job-cta-alt, a.action-apply, a.apply, a:has-text("Apply for this position"), a:has-text("Apply for this job"), a:has-text("Apply now"), button:has-text("Apply"), a[href*="/l/"], a[href*="apply"]'
        )
        .first();

      if ((await applyTrigger.count()) > 0) {
        const rawHref = await applyTrigger.getAttribute('href');
        console.log(`[FormAgent] Found Apply link with href: ${rawHref}`);

        if (rawHref && rawHref.startsWith('mailto:')) {
          const directEmail = rawHref.replace('mailto:', '').split('?')[0].trim();
          console.log(`[FormAgent] Direct application email found: ${directEmail}`);
          if (botToken && chatId) {
            await sendTelegramMessage(
              botToken,
              chatId,
              `✉️ <b>این موقعیت از طریق ارسال مستقیم ایمیل اپلای می‌شود:</b>\n<code>${directEmail}</code>\n\nبرای ارسال رزومه از دکمه 📧 Send Email استفاده کنید.`
            );
          }
          return { success: true };
        } else if (rawHref) {
          const targetUrl = new URL(rawHref, page.url()).toString();
          console.log(`[FormAgent] Directly navigating to application portal: ${targetUrl}`);
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
          await page.waitForTimeout(3000);

          // If on an intermediary redirect (e.g. RemoteOK /l/ affiliate redirect), wait for destination
          if (page.url().includes('/l/')) {
            console.log('[FormAgent] Resolving intermediary redirect to final company application page...');
            try {
              await page.waitForURL((u) => !u.toString().includes('/l/'), { timeout: 10000 });
              await page.waitForLoadState('domcontentloaded');
              await page.waitForTimeout(3000);
            } catch {
              // Fallback: check if the page has a decoded destination script
              const destUrl = await page.evaluate(() => {
                const scripts = Array.from(document.querySelectorAll('script'));
                for (const s of scripts) {
                  const m = s.textContent?.match(/n='([^']+)'/);
                  if (m && s.textContent?.includes('window.location.href=n')) {
                    try {
                      let n = m[1];
                      n = n.split('MTc5MjA1NDQ4Mw==')[1];
                      n = atob(atob(n.split('').reverse().join('')).split('').reverse().join('').split('MTc5MjA1NDQ4Mw==')[1]);
                      return n.split('MTc5MjA1NDQ4Mw==')[1];
                    } catch {}
                  }
                }
                return null;
              });
              if (destUrl && destUrl.startsWith('http')) {
                console.log(`[FormAgent] Decoded destination URL: ${destUrl}`);
                await page.goto(destUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
                await page.waitForTimeout(3000);
              }
            }
          }
          console.log(`[FormAgent] Landed on application page: ${page.url()}`);
        }
      }
    } catch (e) {
      console.warn('[FormAgent] Apply button follow error:', e);
    }

    // Refresh pageTitle after navigation
    const pageTitle = (await page.title()) || 'Software Engineer';

    // 2. Try to automatically solve Cloudflare Turnstile / Checkbox if present
    try {
      for (const frame of page.frames()) {
        const frameUrl = frame.url();
        if (frameUrl.includes('turnstile') || frameUrl.includes('cloudflare') || frameUrl.includes('recaptcha')) {
          const cb = frame.locator('input[type="checkbox"], .ctp-checkbox-label, #challenge-stage input');
          if ((await cb.count()) > 0) {
            console.log('[FormAgent] Detected interactive security checkbox. Clicking to solve...');
            await cb.first().click();
            await page.waitForTimeout(3500);
          }
        }
      }
    } catch {}

    // 3. Check if page is an absolute hard blocker (e.g. Cloudflare "Just a moment..." with no content)
    const isHardBlock =
      pageTitle.includes('Just a moment...') ||
      pageTitle.includes('Attention Required') ||
      pageTitle.includes('Access Denied');

    if (isHardBlock) {
      console.warn('[FormAgent] Hard security block detected!');
      const captchaImg = '.tmp/captcha-blocked.png';
      await page.screenshot({ path: captchaImg });
      if (botToken && chatId) {
        await sendPhotoToTelegram(
          botToken,
          chatId,
          captchaImg,
          `⚠️ <b>سیستم امنیتی (Cloudflare Challenge) در صفحه مقصد شناسایی شد!</b>\n\n💼 <b>پوزیشن:</b> ${pageTitle}\n🔗 <b>لینک صفحه:</b> ${url}\n\n<i>برای این مورد، لطفاً لینک بالا را باز کرده و فرم را تکمیل نمایید.</i>`
        );
      }
      return { success: false, error: 'Hard security block' };
    }

    // 1. Extract Page Title / Job Description for Tailoring
    const bodyText = (await page.innerText('body')) || '';
    const jdText = bodyText.slice(0, 4000);

    console.log(`[FormAgent] Page loaded: ${pageTitle}`);

    // If on LinkedIn, try to find external company application link
    if (url.includes('linkedin.com')) {
      console.log('[FormAgent] Detected LinkedIn URL. Checking for external application link...');
      try {
        const extApplyBtn = page
          .locator(
            'a.apply-button, a[data-tracking-control-name*="apply"], a:has-text("Apply on company website"), a:has-text("Apply")'
          )
          .first();
        if ((await extApplyBtn.count()) > 0) {
          const extHref = await extApplyBtn.getAttribute('href');
          if (extHref && extHref.startsWith('http') && !extHref.includes('linkedin.com/login')) {
            console.log(`[FormAgent] Following external application link: ${extHref}`);
            await page.goto(extHref, { waitUntil: 'domcontentloaded', timeout: 35000 });
            await page.waitForTimeout(3000);
          }
        }
      } catch (e) {
        console.warn('[FormAgent] External link follow error:', e);
      }
    }

    // 2. Generate Tailored 1-Page PDF Resume based on the live page
    console.log('[FormAgent] Tailoring resume to job description...');
    const tailored = await tailorResume({ master: master as any, jd: jdText });
    const pdfBytes = await buildPdf(tailored.resume);
    const pdfPath = '.tmp/Alireza_Rahimpanah_Resume.pdf';
    writeFileSync(pdfPath, pdfBytes);
    console.log(`[FormAgent] Tailored PDF generated (${pdfBytes.length} bytes)`);

    // 3. Detect and Fill Standard Fields
    const profile = {
      firstName: 'Alireza',
      lastName: 'Rahimpanah',
      fullName: 'Alireza Rahimpanah',
      email: 'a.rahimpanah71@gmail.com',
      phone: '+90 534 819 4726',
      location: 'Istanbul, Turkey',
      linkedin: 'https://linkedin.com/in/alireza-rahimpanah-b7010a301',
      github: 'https://github.com/say-alireza',
      website: 'https://say-alireza.github.io/nextjs-resume/',
    };

    const filledFields: string[] = [];

    // Helper to safely type into field if it exists
    async function tryFill(selectors: string[], value: string, fieldName: string) {
      for (const sel of selectors) {
        try {
          const el = page.locator(sel).first();
          if ((await el.count()) > 0 && (await el.isVisible())) {
            await el.fill(value);
            filledFields.push(`${fieldName}: ${value}`);
            console.log(`[FormAgent] Filled ${fieldName} using '${sel}'`);
            return true;
          }
        } catch {}
      }
      return false;
    }

    // First Name
    await tryFill(
      [
        '#first_name',
        'input[name="first_name"]',
        'input[name*="firstName" i]',
        'input[id*="first_name" i]',
        'input[autocomplete="given-name"]',
      ],
      profile.firstName,
      'First Name'
    );

    // Last Name
    await tryFill(
      [
        '#last_name',
        'input[name="last_name"]',
        'input[name*="lastName" i]',
        'input[id*="last_name" i]',
        'input[autocomplete="family-name"]',
      ],
      profile.lastName,
      'Last Name'
    );

    // Full Name (if single input)
    await tryFill(
      [
        'input[name="name"]',
        'input[name="fullName"]',
        'input[id="name"]',
        'input[autocomplete="name"]',
        'input[placeholder*="Full name" i]',
      ],
      profile.fullName,
      'Full Name'
    );

    // Email
    await tryFill(
      [
        '#email',
        'input[type="email"]',
        'input[name="email"]',
        'input[name*="email" i]',
        'input[id*="email" i]',
      ],
      profile.email,
      'Email'
    );

    // Phone
    await tryFill(
      [
        '#phone',
        'input[type="tel"]',
        'input[name="phone"]',
        'input[name*="phone" i]',
        'input[id*="phone" i]',
      ],
      profile.phone,
      'Phone'
    );

    // Location / City
    await tryFill(
      [
        'form input[name*="location" i]:not([id*="search" i]):not([class*="search" i])',
        'form input[id*="location" i]:not([id*="search" i]):not([class*="search" i])',
        'form input[placeholder*="Location" i]:not([id*="search" i]):not([class*="search" i])',
        'form input[name*="city" i]',
        'input[autocomplete="address-level2"]',
      ],
      profile.location,
      'Location'
    );

    // LinkedIn URL
    await tryFill(
      [
        'input[name*="linkedin" i]',
        'input[id*="linkedin" i]',
        'input[name="urls[LinkedIn]"]',
        'input[placeholder*="linkedin" i]',
      ],
      profile.linkedin,
      'LinkedIn'
    );

    // GitHub URL
    await tryFill(
      [
        'input[name*="github" i]',
        'input[id*="github" i]',
        'input[name="urls[GitHub]"]',
        'input[placeholder*="github" i]',
      ],
      profile.github,
      'GitHub'
    );

    // Website / Portfolio
    await tryFill(
      [
        'input[name*="website" i]',
        'input[id*="website" i]',
        'input[name="urls[Portfolio]"]',
        'input[name*="portfolio" i]',
        'input[placeholder*="website" i]',
      ],
      profile.website,
      'Website'
    );

    // 4. Attach Tailored PDF Resume
    const fileInputs = page.locator('input[type="file"]');
    const fileCount = await fileInputs.count();
    if (fileCount > 0) {
      console.log(`[FormAgent] Found ${fileCount} file input(s). Attaching PDF resume...`);
      await fileInputs.first().setInputFiles(pdfPath);
      filledFields.push('Resume: Alireza_Rahimpanah_Resume.pdf (Attached)');
    }

    // STRICT VALIDATION: Did we actually fill a real job application form?
    const hasEmail = filledFields.some((f) => f.startsWith('Email:'));
    const hasResume = filledFields.some((f) => f.startsWith('Resume:'));
    const hasName = filledFields.some((f) => f.startsWith('First Name:') || f.startsWith('Full Name:'));

    const isRealApplicationForm = hasEmail || hasResume || (hasName && filledFields.length >= 2);

    if (!isRealApplicationForm) {
      console.warn('[FormAgent] No job application form found on page.');
      const noFormPath = '.tmp/no-form.png';
      await page.screenshot({ path: noFormPath });
      if (botToken && chatId) {
        const msg = [
          `⚠️ <b>فرم استخدامی مستقیمی در این صفحه یافت نشد</b>`,
          ``,
          `💼 <b>عنوان:</b> ${pageTitle}`,
          `🔗 <b>لینک:</b> ${url}`,
          ``,
          `<i>این صفحه تنها صفحه معرفی یا جستجوی آگهی است (نه فرم ثبت‌نام).</i>`,
          `<i>برای آگهی‌های لینکدین، لطفاً از دکمه 🚀 Open on LinkedIn استفاده کنید، یا در صورت وجود فرم در سایت شرکت، لینک مستقیم فرم را با دستور <code>/apply &lt;url&gt;</code> بفرستید.</i>`,
        ].join('\n');
        await sendPhotoToTelegram(botToken, chatId, noFormPath, msg);
      }
      return { success: false, error: 'No application form found' };
    }

    // Scroll to the filled form container so the screenshot shows the actual filled form!
    try {
      const formEl = page.locator('form, input[type="file"], input[type="email"], input[name*="name"]').first();
      if ((await formEl.count()) > 0) {
        await formEl.scrollIntoViewIfNeeded();
      }
    } catch {}
    await page.waitForTimeout(1000);

    // 5. Take Screenshot of Filled Form
    const screenshotPath = '.tmp/form-preview.png';
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`[FormAgent] Form preview screenshot saved to ${screenshotPath}`);

    // If Mode is SUBMIT: Click submit button
    if (mode === 'submit') {
      console.log('[FormAgent] Submitting application...');
      const submitSelectors = [
        '#submit_app',
        '#btn-submit',
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit application")',
        'button:has-text("Apply")',
        'button:has-text("Submit")',
      ];

      let submitted = false;
      for (const sel of submitSelectors) {
        try {
          const btn = page.locator(sel).first();
          if ((await btn.count()) > 0 && (await btn.isVisible())) {
            await btn.click();
            submitted = true;
            console.log(`[FormAgent] Clicked submit button: '${sel}'`);
            break;
          }
        } catch {}
      }

      await page.waitForTimeout(5000);
      const confirmScreenshotPath = '.tmp/confirmation.png';
      await page.screenshot({ path: confirmScreenshotPath });
      console.log(`[FormAgent] Submission confirmation screenshot saved`);

      if (botToken && chatId) {
        await sendPhotoToTelegram(
          botToken,
          chatId,
          confirmScreenshotPath,
          `✅ <b>فرم اپلای با موفقیت سابمیت شد!</b>\n💼 <b>پوزیشن:</b> ${pageTitle}\n🔗 <b>لینک:</b> ${url}`
        );
      }
    } else {
      // Mode is INSPECT: send preview screenshot to Telegram with confirmation request
      if (botToken && chatId) {
        const previewCaption = [
          `📋 <b>پیش‌نویس فرم اپلای آماده تأیید است:</b>`,
          `💼 <b>پوزیشن:</b> ${pageTitle}`,
          ``,
          `<b>فیلدهای تکمیل‌شده:</b>`,
          ...filledFields.map((f) => `• ${f}`),
          ``,
          `<i>اسکرین‌شات از فرم پرشده پیوست شد. در صورت تایید، دستور سابمیت را صادر کنید.</i>`,
        ].join('\n');

        await sendPhotoToTelegram(botToken, chatId, screenshotPath, previewCaption);
      }
    }

    return {
      success: true,
      pageTitle,
      filledFields,
    };
  } catch (err: any) {
    console.error('[FormAgent] Error:', err);
    if (botToken && chatId) {
      await sendTelegramMessage(
        botToken,
        chatId,
        `❌ <b>خطا در پردازش فرم:</b> ${err?.message || String(err)}`
      );
    }
    return { success: false, error: err?.message || String(err) };
  } finally {
    await browser.close();
  }
}

async function sendPhotoToTelegram(
  botToken: string,
  chatId: string,
  filePath: string,
  caption: string
) {
  if (!existsSync(filePath)) return;
  const fileBytes = readFileSync(filePath);
  const form = new FormData();
  form.append('chat_id', chatId);
  form.append('photo', new Blob([fileBytes], { type: 'image/png' }), 'preview.png');
  form.append('caption', caption.slice(0, 1000));
  form.append('parse_mode', 'HTML');

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      body: form,
    });
    if (!res.ok) {
      const err = await res.text();
      console.error('[sendPhotoToTelegram] Telegram error:', err);
    }
  } catch (e) {
    console.error('[sendPhotoToTelegram] Error:', e);
  }
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('[sendTelegramMessage] Error:', e);
  }
}

// CLI runner
if (process.argv[1]?.endsWith('form-agent.ts')) {
  const args = process.argv.slice(2);
  const urlArg = args.find((a, i) => args[i - 1] === '--url') || '';
  const modeArg = (args.find((a, i) => args[i - 1] === '--mode') as any) || 'inspect';
  const tokenArg = args.find((a, i) => args[i - 1] === '--token') || process.env.TELEGRAM_BOT_TOKEN;
  const chatArg = args.find((a, i) => args[i - 1] === '--chat') || process.env.TELEGRAM_CHAT_ID;

  if (urlArg) {
    runFormAgent({
      url: urlArg,
      mode: modeArg,
      botToken: tokenArg,
      chatId: chatArg,
    }).catch(console.error);
  }
}
