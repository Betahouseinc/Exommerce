// eXommerce — case-study request handler (Google Apps Script)
//
// Each request from the "Get the full case study" form on exommerce.online is
// logged as a row in the Google Sheet this script is attached to, and the PDF
// is emailed to the visitor from the Google account that deploys the script.
//
// SETUP (one time, ~5 minutes)
//   1. Signed in as the mailbox that should send the PDFs (e.g. hello@exommerce.online),
//      create a Google Sheet named "Case study requests".
//   2. In the Sheet: Extensions → Apps Script. Replace the editor contents with this file. Save.
//   3. Deploy → New deployment → type "Web app".
//        Execute as: Me        Who has access: Anyone
//      Approve the permissions prompt (Sheets, send email, fetch the PDFs).
//   4. Copy the Web app URL (ends in /exec) and send it to whoever maintains the
//      site. It goes in CASE_STUDY_ENDPOINT in index.html.
//   After editing this script: Deploy → Manage deployments → edit → Version: New version,
//   or the live URL keeps running the old code.
//
// The PDFs are served from the site itself (/case-studies/*.pdf), so updating a
// PDF is a normal site deploy — nothing to change here.

var SITE        = 'https://exommerce.online';
var NOTIFY_TO   = 'hello@exommerce.online';   // gets a short note for every request
var SENDER_NAME = 'eXommerce';

// Only these keys are accepted, so the script can never be used to fetch or
// send anything else.
var STUDIES = {
  'etsy':        { title: 'Etsy: deploying 50+ times a day without fear',     file: 'etsy.pdf' },
  'netflix':     { title: 'Netflix: staying up when the cloud went down',     file: 'netflix.pdf' },
  'capital-one': { title: 'Capital One: a regulated bank that ships daily',   file: 'capital-one.pdf' },
  '37signals':   { title: '37signals: rethinking a $3.2M-a-year cloud bill',  file: '37signals.pdf' }
};

var HEADERS = ['Timestamp', 'Case study', 'First name', 'Last name', 'Email', 'Company',
               'Role', 'Company size', 'Consent', 'Page', 'Status'];

function doPost(e) {
  var p = (e && e.parameter) || {};

  // Honeypot: people never fill the hidden field, bots do. Pretend success.
  if (p.website) return json({ ok: true });

  var study = STUDIES[p.study];
  var first = clean(p.first_name, 60);
  var last  = clean(p.last_name, 60);
  var email = clean(p.email, 120).toLowerCase();
  var company = clean(p.company, 120);

  if (!study) return json({ ok: false, error: 'Unknown case study' });
  if (!first || !company) return json({ ok: false, error: 'Please fill in the required fields' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'Please enter a valid email' });
  if (p.consent !== 'yes') return json({ ok: false, error: 'Please tick the consent box' });

  var row = [new Date(), p.study, first, last, email, company,
             clean(p.role, 80), clean(p.company_size, 40), 'yes', clean(p.page, 200)];

  // The same person asking for the same study twice in 10 minutes gets one email.
  var cache = CacheService.getScriptCache();
  var key = 'sent:' + email + ':' + p.study;
  if (cache.get(key)) {
    log(row.concat('duplicate: not re-sent'));
    return json({ ok: true });
  }

  if (MailApp.getRemainingDailyQuota() < 2) {
    log(row.concat('failed: daily email quota reached'));
    return json({ ok: false, error: 'We could not send it right now. Email hello@exommerce.online and we will send it.' });
  }

  try {
    var pdf = UrlFetchApp.fetch(SITE + '/case-studies/' + study.file).getBlob()
      .setName('eXommerce case study - ' + study.file);

    MailApp.sendEmail({
      to: email,
      replyTo: NOTIFY_TO,
      name: SENDER_NAME,
      subject: 'Your case study: ' + study.title,
      body: plainBody(first, study),
      htmlBody: htmlBody(first, study),
      attachments: [pdf]
    });

    MailApp.sendEmail({
      to: NOTIFY_TO,
      replyTo: email,
      name: SENDER_NAME + ' website',
      subject: 'Case study request: ' + first + ' ' + last + ' · ' + company,
      body: HEADERS.slice(1, 10).map(function (h, i) { return pad(h) + row[i + 1]; }).join('\n')
    });

    cache.put(key, '1', 600);
    log(row.concat('sent'));
    return json({ ok: true });
  } catch (err) {
    log(row.concat('failed: ' + err));
    return json({ ok: false, error: 'We could not send it right now. Email hello@exommerce.online and we will send it.' });
  }
}

// Visiting the /exec URL in a browser confirms the deployment is live.
function doGet() {
  return json({ ok: true, service: 'eXommerce case-study mailer' });
}

function log(values) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow(values);
}

function plainBody(first, study) {
  return 'Hi ' + first + ',\n\n'
    + 'Thanks for your interest. Your case study is attached: ' + study.title + '.\n\n'
    + 'Inside: the full story, a 90-day plan for a team your size, and a readiness checklist.\n\n'
    + 'If you would like us to tailor the plan to your setup, just reply to this email '
    + 'or book a call: ' + SITE + '/#contact\n\n'
    + '— The eXommerce team\n' + SITE;
}

function htmlBody(first, study) {
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#3F4852">'
    + '<div style="background:#109840;padding:18px 26px;border-radius:10px 10px 0 0">'
    + '<span style="color:#fff;font-size:19px;font-weight:700">eXommerce.online</span></div>'
    + '<div style="border:1px solid #DDE8E0;border-top:0;padding:26px;border-radius:0 0 10px 10px">'
    + '<p style="margin:0 0 14px;font-size:15px">Hi ' + esc(first) + ',</p>'
    + '<p style="margin:0 0 14px;font-size:15px;line-height:1.6">Thanks for your interest. Your case study is attached:<br>'
    + '<b style="color:#0B0D0C">' + esc(study.title) + '</b></p>'
    + '<p style="margin:0 0 20px;font-size:15px;line-height:1.6">Inside: the full story, a 90-day plan for a team your size, and a readiness checklist.</p>'
    + '<a href="' + SITE + '/#contact" style="background:#109840;color:#fff;padding:11px 20px;border-radius:8px;'
    + 'text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Tailor the plan to your team &rarr;</a>'
    + '<p style="margin:22px 0 0;font-size:13px;color:#6B7280">Or just reply to this email.</p>'
    + '</div>'
    + '<p style="font-size:11px;color:#9CA3AF;padding:12px 4px">eXommerce LLP · Bengaluru · '
    + '<a href="' + SITE + '/privacy.html" style="color:#9CA3AF">Privacy</a></p></div>';
}

function clean(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
function pad(s) { return (s + ':            ').slice(0, 14); }
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Run from the editor (select testSend → Run) to try the whole flow without the website.
function testSend() {
  var out = doPost({ parameter: {
    study: 'etsy', first_name: 'Test', last_name: 'Request', email: NOTIFY_TO,
    company: 'eXommerce', role: 'Test', company_size: '1–10', consent: 'yes', page: 'editor test'
  }});
  Logger.log(out.getContent());
}
