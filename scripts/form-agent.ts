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
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 900 },
  });

  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    const pageTitle = (await page.title()) || 'Software Engineer';

    // Check for CAPTCHA / Security Block / Access Denied
    const captchaDetected = await page.evaluate(() => {
      const text = document.body?.innerText || '';
      const hasCaptcha = !!document.querySelector(
        'iframe[src*="captcha"], iframe[src*="turnstile"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], .g-recaptcha, .h-captcha'
      );
      const isBlocked =
        /verify you are human|security check|cloudflare challenge|bot detection|access denied|attention required/i.test(
          text
        );
      return hasCaptcha || isBlocked;
    });

    if (captchaDetected) {
      console.warn('[FormAgent] Security block / CAPTCHA detected!');
      const captchaImg = '.tmp/captcha-blocked.png';
      await page.screenshot({ path: captchaImg });
      if (botToken && chatId) {
        await sendPhotoToTelegram(
          botToken,
          chatId,
          captchaImg,
          `⚠️ <b>سیستم امنیتی (CAPTCHA) در صفحه مقصد شناسایی شد!</b>\n\n💼 <b>پوزیشن:</b> ${pageTitle}\n🔗 <b>لینک صفحه:</b> ${url}\n\n<i>ربات نمی‌تواند از تست انسان عبور کند. لطفاً لینک بالا را باز کرده و مستقیماً فرم را تکمیل فرمایید.</i>`
        );
      }
      return { success: false, error: 'CAPTCHA detected' };
    }

    // 1. Extract Page Title / Job Description for Tailoring
    const bodyText = (await page.innerText('body')) || '';
    const jdText = bodyText.slice(0, 4000);

    console.log(`[FormAgent] Page loaded: ${pageTitle}`);

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
        'input[name*="location" i]',
        'input[id*="location" i]',
        'input[name*="city" i]',
        'input[placeholder*="Location" i]',
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
