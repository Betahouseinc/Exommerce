// eXommerce — website form handler (Google Apps Script)
//
// Handles three forms on exommerce.online, each logged to its own tab of the
// Google Sheet this script is attached to:
//   • "Get the full case study": emails the PDF to the visitor (first tab)
//   • homepage contact form: emails hello@ ("Contact enquiries" tab)
//   • free AWS cost scan booking on cloud-audit.html: emails hello@ and sends
//     the customer a confirmation with their reference ("Audit bookings" tab).
//     remindDueScans() runs daily (installReminders() sets that up) and tells
//     hello@ which customers are due their quarterly/yearly re-scan.
// Tests: node --test tests/case-study-mailer.test.mjs (runs this file with fake
// Google services).
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

var CONTACT_SHEET   = 'Contact enquiries';
var CONTACT_HEADERS = ['Timestamp', 'First name', 'Last name', 'Email', 'Company', 'Area',
                       'Message', 'Page', 'Status'];

var BOOKING_SHEET   = 'Audit bookings';
var BOOKING_HEADERS = ['Timestamp', 'Reference', 'Name', 'Email', 'Company', 'Monthly AWS spend',
                       'Re-scan', 'Next scan', 'Phone / WhatsApp', 'Currency', 'Full report price',
                       'Notes', 'Page', 'Status', 'Last reminder'];

// Only these values are accepted from the booking form.
var SPEND_BANDS = ['Under $3k', '$3k–$10k', '$10k–$50k', '$50k+', 'Not sure'];
var PRICES      = { USD: '$299', INR: '₹19,999' };     // full report, founding price
var CADENCES    = { once:      { label: 'Just once',     months: 0 },
                    quarterly: { label: 'Every quarter', months: 3 },
                    yearly:    { label: 'Every year',    months: 12 } };

function doPost(e) {
  var p = (e && e.parameter) || {};

  // Honeypot: people never fill the hidden field, bots do. Pretend success.
  if (p.website) return json({ ok: true });

  if (p.form === 'contact') return handleContact(p);
  if (p.form === 'audit_booking') return handleAuditBooking(p);

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

// Contact form on the homepage: log the enquiry to its own tab and email
// hello@ with the details, reply-to set to the visitor.
function handleContact(p) {
  var first   = clean(p.first_name, 60);
  var last    = clean(p.last_name, 60);
  var email   = clean(p.email, 120).toLowerCase();
  var company = clean(p.company, 120);
  var need    = clean(p.need, 80);
  var message = clean(p.message, 3000);

  if (!first || !company || !message) return json({ ok: false, error: 'Please fill in the required fields' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'Please enter a valid email' });

  var row = [new Date(), first, last, email, company, need, message, clean(p.page, 200)];

  // The same person sending the same message twice in 10 minutes is logged once.
  var cache = CacheService.getScriptCache();
  var key = 'contact:' + email + ':' + Utilities.base64Encode(Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, message)).slice(0, 16);
  if (cache.get(key)) return json({ ok: true });

  try {
    MailApp.sendEmail({
      to: NOTIFY_TO,
      replyTo: email,
      name: SENDER_NAME + ' website',
      subject: 'New enquiry: ' + first + ' ' + last + ' · ' + company,
      body: 'Name:    ' + (first + ' ' + last).trim() + '\n'
          + 'Email:   ' + email + '\n'
          + 'Company: ' + company + '\n'
          + 'Area:    ' + (need || '—') + '\n\n'
          + message + '\n\n'
          + 'Reply to this email to answer them directly.'
    });
    cache.put(key, '1', 600);
    logTo(CONTACT_SHEET, CONTACT_HEADERS, row.concat('received'));
    return json({ ok: true });
  } catch (err) {
    logTo(CONTACT_SHEET, CONTACT_HEADERS, row.concat('failed: ' + err));
    return json({ ok: false, error: 'We could not send it just now. Please email hello@exommerce.online.' });
  }
}

// Free AWS cost scan booking (cloud-audit.html): log it, email hello@ with the
// details (reply-to the customer), and confirm to the customer with their
// reference. Setup instructions and, later, the free summary go out from hello@.
function handleAuditBooking(p) {
  var name     = clean(p.name, 100);
  var email    = clean(p.email, 120).toLowerCase();
  var company  = clean(p.company, 120);
  var spend    = clean(p.spend, 20);
  var phone    = clean(p.phone, 40);
  var notes    = clean(p.notes, 2000);
  var currency = p.currency === 'INR' ? 'INR' : 'USD';
  var price    = PRICES[currency];   // never trust a price sent by the browser
  var cadence  = CADENCES[p.cadence] || CADENCES.once;
  var nextScan = cadence.months ? addMonths(new Date(), cadence.months) : '';

  if (!name || !company) return json({ ok: false, error: 'Please fill in your name and company.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'Please enter a valid email.' });
  if (SPEND_BANDS.indexOf(spend) < 0) return json({ ok: false, error: 'Please choose your monthly AWS spend.' });
  if (phone && !/^[0-9+()\-.\s]{6,40}$/.test(phone)) return json({ ok: false, error: 'Please check the phone number.' });

  // A double-click or a resubmit within 10 minutes returns the first booking.
  var cache = CacheService.getScriptCache();
  var key = 'booking:' + email + ':' + company.toLowerCase();
  var existing = cache.get(key);
  if (existing) return json({ ok: true, reference: existing, duplicate: true });

  var reference = bookingReference();
  var row = [new Date(), reference, name, email, company, spend, cadence.label, nextScan, phone,
             currency, price, notes, clean(p.page, 200)];

  if (MailApp.getRemainingDailyQuota() < 2) {
    logTo(BOOKING_SHEET, BOOKING_HEADERS, row.concat('failed: daily email quota reached'));
    return json({ ok: false, error: 'We could not take the booking just now. Please email hello@exommerce.online.' });
  }

  try {
    MailApp.sendEmail({
      to: NOTIFY_TO,
      replyTo: email,
      name: SENDER_NAME + ' website',
      subject: 'Free scan booking ' + reference + ': ' + company + ' (' + spend + ')',
      body: 'New free AWS cost scan booking.\n\n'
          + 'Reference: ' + reference + '\n'
          + 'Name:      ' + name + '\n'
          + 'Email:     ' + email + '\n'
          + 'Company:   ' + company + '\n'
          + 'AWS spend: ' + spend + '/month\n'
          + 'Re-scan:   ' + cadence.label + '\n'
          + 'Phone:     ' + (phone || '—') + '\n'
          + 'Currency:  ' + currency + ' (full report ' + price + ' at the founding price)\n\n'
          + (notes ? 'Notes:\n' + notes + '\n\n' : '')
          + (spend === 'Under $3k' ? 'Small account (under $3k/month): the summary may say the full report isn\'t worth it.\n\n' : '')
          + 'Next: send the setup instructions. In the scanner folder:\n'
          + '  python -m exaudit setup --reference ' + reference + ' --customer "' + company.replace(/"/g, "'") + '" --auditor <our account ID>\n'
          + 'then reply to this email with out/' + reference + '/onboarding/setup-instructions.md.'
    });
    logTo(BOOKING_SHEET, BOOKING_HEADERS, row.concat('new'));
  } catch (err) {
    logTo(BOOKING_SHEET, BOOKING_HEADERS, row.concat('failed: ' + err));
    return json({ ok: false, error: 'We could not take the booking just now. Please email hello@exommerce.online.' });
  }

  // The booking is safely logged and hello@ has it, so a failed confirmation
  // email must not turn into an error for the customer.
  try {
    MailApp.sendEmail({
      to: email,
      replyTo: NOTIFY_TO,
      name: SENDER_NAME,
      subject: 'Your free AWS cost scan (' + reference + ')',
      body: bookingPlain(name, reference, price, cadence),
      htmlBody: bookingHtml(name, reference, price, cadence)
    });
  } catch (err) {
    Logger.log('Booking ' + reference + ' confirmation failed: ' + err);
  }

  cache.put(key, reference, 600);
  return json({ ok: true, reference: reference });
}

// Short, readable and unique enough to quote on a call: AUD-260930-7K3F
function bookingReference() {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I
  var suffix = '';
  for (var i = 0; i < 4; i++) suffix += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return 'AUD-' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyMMdd') + '-' + suffix;
}

function firstName(name) { return String(name).split(/\s+/)[0]; }

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

var NEXT_STEPS = [
  'We send your setup instructions from hello@exommerce.online, usually the same day.',
  'You create one read-only IAM role. It takes about 5 minutes.',
  'Within 24 hours of access working, you get your free summary: how much you could save each month, and where.'
];

function cadenceLine(cadence) {
  return cadence.months
    ? 'You asked us to check again ' + cadence.label.toLowerCase() + '; we\'ll get in touch when it\'s due.'
    : '';
}

function bookingPlain(name, reference, price, cadence) {
  var again = cadenceLine(cadence);
  return 'Hi ' + firstName(name) + ',\n\n'
    + 'Thanks for booking a free AWS cost scan. Your reference is ' + reference + '.\n\n'
    + 'What happens next:\n'
    + NEXT_STEPS.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n') + '\n\n'
    + 'The full fix list, scripts and plan are optional (' + price + ' at the founding price). '
    + 'You decide after you\'ve seen your summary.\n\n'
    + (again ? again + '\n\n' : '')
    + 'Questions? Just reply to this email.\n\n'
    + '— Bhavin Chawla, eXommerce\n' + SITE + '/cloud-audit.html';
}

function bookingHtml(name, reference, price, cadence) {
  var li = 'margin:0 0 8px;font-size:15px;line-height:1.6';
  var again = cadenceLine(cadence);
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#3F4852">'
    + '<div style="background:#109840;padding:18px 26px;border-radius:10px 10px 0 0">'
    + '<span style="color:#fff;font-size:19px;font-weight:700">eXommerce.online</span></div>'
    + '<div style="border:1px solid #DDE8E0;border-top:0;padding:26px;border-radius:0 0 10px 10px">'
    + '<p style="margin:0 0 14px;font-size:15px">Hi ' + esc(firstName(name)) + ',</p>'
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6">Thanks for booking a free AWS cost scan. '
    + 'Your reference is <b style="color:#0B0D0C">' + esc(reference) + '</b>.</p>'
    + '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0B0D0C">What happens next</p>'
    + '<ol style="margin:0 0 18px;padding-left:20px">'
    + NEXT_STEPS.map(function (s) { return '<li style="' + li + '">' + esc(s) + '</li>'; }).join('')
    + '</ol>'
    + '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;background:#EFF8F1;padding:12px 14px;border-radius:8px">'
    + 'The full fix list, scripts and plan are optional (' + esc(price) + ' at the founding price). '
    + 'You decide after you\'ve seen your summary.</p>'
    + (again ? '<p style="margin:0 0 14px;font-size:14px">' + esc(again) + '</p>' : '')
    + '<p style="margin:0;font-size:14px">Questions? Just reply to this email.</p>'
    + '<p style="margin:18px 0 0;font-size:14px">— Bhavin Chawla, eXommerce</p>'
    + '</div>'
    + '<p style="font-size:11px;color:#9CA3AF;padding:12px 4px">eXommerce LLP · Bengaluru · '
    + '<a href="' + SITE + '/cloud-audit.html#audit-terms" style="color:#9CA3AF">Scan terms</a> · '
    + '<a href="' + SITE + '/privacy.html" style="color:#9CA3AF">Privacy</a></p></div>';
}

// ---- Scheduled re-scans --------------------------------------------------------------
// Runs daily (install once: select installReminders → Run). Emails hello@ a list of
// customers whose "Next scan" date has arrived, then moves each date on by their
// schedule, so every customer comes round again without anyone keeping track.
function remindDueScans() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOOKING_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var values = sheet.getDataRange().getValues();
  var col = {};
  values[0].forEach(function (h, i) { col[h] = i; });
  var endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  var due = [];
  for (var r = 1; r < values.length; r++) {
    var next = values[r][col['Next scan']];
    if (Object.prototype.toString.call(next) === '[object Date]' && next <= endOfToday) due.push(r);
  }
  if (!due.length) return 0;

  var tz = Session.getScriptTimeZone();
  var lines = due.map(function (r) {
    var v = values[r];
    return '- ' + v[col['Reference']] + ' · ' + v[col['Company']] + ' · ' + v[col['Name']]
      + ' <' + v[col['Email']] + '> · ' + v[col['Re-scan']] + ' · was due '
      + Utilities.formatDate(v[col['Next scan']], tz, 'd MMM yyyy');
  });
  MailApp.sendEmail({
    to: NOTIFY_TO,
    name: SENDER_NAME + ' website',
    subject: due.length + ' re-scan' + (due.length === 1 ? '' : 's') + ' due',
    body: 'These customers asked for a regular scan and are due one:\n\n' + lines.join('\n') + '\n\n'
        + 'Invite each to book again (' + SITE + '/cloud-audit.html#book) and ask them to send the '
        + 'findings.json from their last report, so the new one shows what changed.\n'
        + 'Their "Next scan" dates have moved on by their schedule.'
  });

  var now = new Date();
  due.forEach(function (r) {
    var label = values[r][col['Re-scan']];
    var months = 0;
    Object.keys(CADENCES).forEach(function (k) { if (CADENCES[k].label === label) months = CADENCES[k].months; });
    var nextCell = sheet.getRange(r + 1, col['Next scan'] + 1);
    nextCell.setValue(months ? addMonths(values[r][col['Next scan']], months) : '');
    sheet.getRange(r + 1, col['Last reminder'] + 1).setValue(now);
  });
  return due.length;
}

// Select installReminders → Run once. Safe to run again: it won't add a second trigger.
function installReminders() {
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'remindDueScans';
  });
  if (!exists) ScriptApp.newTrigger('remindDueScans').timeBased().everyDays(1).atHour(9).create();
  return !exists;
}

function logTo(name, headers, values) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow(values.map(asText));
}

// Sheets runs any cell that starts with = + - or @ as a formula, so a visitor
// could plant =IMAGE("https://…"&A1) and leak other rows. A leading apostrophe
// stores it as plain text (it isn't shown in the cell).
function asText(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

// Visiting the /exec URL in a browser confirms the deployment is live, and
// which forms this version handles.
function doGet() {
  return json({ ok: true, service: 'eXommerce case-study mailer', forms: ['case_study', 'contact', 'audit_booking'] });
}

function log(values) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow(values.map(asText));
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

// Select testBooking → Run to try an audit booking end to end (both emails go to hello@).
function testBooking() {
  var out = doPost({ parameter: {
    form: 'audit_booking', name: 'Test Booking', email: NOTIFY_TO, company: 'eXommerce test',
    spend: '$10k–$50k', cadence: 'quarterly', phone: '+91 98442 65267', currency: 'INR',
    notes: 'editor test', page: 'editor test'
  }});
  Logger.log(out.getContent());
}
