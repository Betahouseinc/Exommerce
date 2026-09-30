// eXommerce — website form handler (Google Apps Script)
//
// Handles three forms on exommerce.online, each logged to its own tab of the
// Google Sheet this script is attached to:
//   • "Get the full case study": emails the PDF to the visitor (first tab)
//   • homepage contact form: emails hello@ ("Contact enquiries" tab)
//   • 24-Hour Cloud Audit booking on cloud-audit.html: emails hello@ and sends
//     the customer a confirmation with their reference ("Audit bookings" tab)
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
                       'Phone / WhatsApp', 'Currency', 'Price shown', 'Notes', 'Page', 'Status'];

// Only these values are accepted from the booking form.
var SPEND_BANDS = ['Under $3k', '$3k–$10k', '$10k–$50k', '$50k+', 'Not sure'];
var PRICES      = { USD: '$299', INR: '₹19,999' };

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

// 24-Hour Cloud Audit booking (cloud-audit.html): log it, email hello@ with the
// details (reply-to the customer), and send the customer a confirmation with
// their booking reference. Payment details are sent by hand from hello@.
function handleAuditBooking(p) {
  var name     = clean(p.name, 100);
  var email    = clean(p.email, 120).toLowerCase();
  var company  = clean(p.company, 120);
  var spend    = clean(p.spend, 20);
  var phone    = clean(p.phone, 40);
  var notes    = clean(p.notes, 2000);
  var currency = p.currency === 'INR' ? 'INR' : 'USD';
  var price    = PRICES[currency];   // never trust a price sent by the browser

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
  var row = [new Date(), reference, name, email, company, spend, phone, currency, price, notes,
             clean(p.page, 200)];

  if (MailApp.getRemainingDailyQuota() < 2) {
    logTo(BOOKING_SHEET, BOOKING_HEADERS, row.concat('failed: daily email quota reached'));
    return json({ ok: false, error: 'We could not take the booking just now. Please email hello@exommerce.online.' });
  }

  try {
    MailApp.sendEmail({
      to: NOTIFY_TO,
      replyTo: email,
      name: SENDER_NAME + ' website',
      subject: 'Audit booking ' + reference + ': ' + company + ' (' + spend + ')',
      body: 'New 24-Hour Cloud Audit booking.\n\n'
          + 'Reference: ' + reference + '\n'
          + 'Name:      ' + name + '\n'
          + 'Email:     ' + email + '\n'
          + 'Company:   ' + company + '\n'
          + 'AWS spend: ' + spend + '/month\n'
          + 'Phone:     ' + (phone || '—') + '\n'
          + 'Price:     ' + price + ' (' + currency + ', founding)\n\n'
          + (notes ? 'Notes:\n' + notes + '\n\n' : '')
          + (spend === 'Under $3k' ? 'NOTE: under the $3k/month minimum. The FAQ says we suggest a lighter option.\n\n' : '')
          + 'Next: reply to this email with payment details and setup instructions.'
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
      subject: 'Your 24-Hour Cloud Audit booking (' + reference + ')',
      body: bookingPlain(name, reference, price),
      htmlBody: bookingHtml(name, reference, price)
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

function bookingPlain(name, reference, price) {
  return 'Hi ' + firstName(name) + ',\n\n'
    + 'Thanks for booking the 24-Hour Cloud Audit. Your reference is ' + reference + '.\n\n'
    + 'What happens next:\n'
    + '1. We reply from hello@exommerce.online with payment details (' + price + ') and setup instructions, usually the same day.\n'
    + '2. You create one read-only IAM role. It takes about 5 minutes.\n'
    + '3. Your report arrives within 24 hours of access working.\n\n'
    + 'If we find less than $500/month in savings, you get a full refund.\n\n'
    + 'Questions? Just reply to this email.\n\n'
    + '— Bhavin Chawla, eXommerce\n' + SITE + '/cloud-audit.html';
}

function bookingHtml(name, reference, price) {
  var li = 'margin:0 0 8px;font-size:15px;line-height:1.6';
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#3F4852">'
    + '<div style="background:#109840;padding:18px 26px;border-radius:10px 10px 0 0">'
    + '<span style="color:#fff;font-size:19px;font-weight:700">eXommerce.online</span></div>'
    + '<div style="border:1px solid #DDE8E0;border-top:0;padding:26px;border-radius:0 0 10px 10px">'
    + '<p style="margin:0 0 14px;font-size:15px">Hi ' + esc(firstName(name)) + ',</p>'
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6">Thanks for booking the 24-Hour Cloud Audit. '
    + 'Your reference is <b style="color:#0B0D0C">' + esc(reference) + '</b>.</p>'
    + '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0B0D0C">What happens next</p>'
    + '<ol style="margin:0 0 18px;padding-left:20px">'
    + '<li style="' + li + '">We reply from hello@exommerce.online with payment details (' + esc(price) + ') and setup instructions, usually the same day.</li>'
    + '<li style="' + li + '">You create one read-only IAM role. It takes about 5 minutes.</li>'
    + '<li style="' + li + '">Your report arrives within 24 hours of access working.</li></ol>'
    + '<p style="margin:0 0 20px;font-size:14px;line-height:1.6;background:#EFF8F1;padding:12px 14px;border-radius:8px">'
    + 'If we find less than $500/month in savings, you get a full refund.</p>'
    + '<p style="margin:0;font-size:14px">Questions? Just reply to this email.</p>'
    + '<p style="margin:18px 0 0;font-size:14px">— Bhavin Chawla, eXommerce</p>'
    + '</div>'
    + '<p style="font-size:11px;color:#9CA3AF;padding:12px 4px">eXommerce LLP · Bengaluru · '
    + '<a href="' + SITE + '/cloud-audit.html#audit-terms" style="color:#9CA3AF">Audit terms</a> · '
    + '<a href="' + SITE + '/privacy.html" style="color:#9CA3AF">Privacy</a></p></div>';
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
    spend: '$10k–$50k', phone: '+91 98442 65267', currency: 'INR', notes: 'editor test', page: 'editor test'
  }});
  Logger.log(out.getContent());
}
