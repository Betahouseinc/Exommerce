// eXommerce — website form handler (Google Apps Script)
//
// Handles three forms on exommerce.online, each logged to its own tab of the
// Google Sheet this script is attached to:
//   • "Get the full case study": emails the PDF to the visitor (first tab)
//   • homepage contact form: emails hello@ ("Contact enquiries" tab)
//   • free Cloud Cost & Infrastructure Audit request on cloud-audit.html: emails
//     hello@ and sends the customer a confirmation with their audit ID ("Audit
//     bookings" tab: one row per audit ID, with a timestamp for each funnel stage).
//     The audit scanner reports later stages (form=audit_event, token-protected);
//     buildDashboard() summarises the beta on the "Beta dashboard" tab, and
//     remindDueScans() (daily, from a trigger added in the editor) flags reviews due.
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

// ---- Cloud Cost & Infrastructure Audit: one row per audit ID, through the whole funnel ----
var BOOKING_SHEET   = 'Audit bookings';
var DASHBOARD_SHEET = 'Beta dashboard';
var ENGAGEMENT      = '₹25,000';            // planned price of the paid engagement; not shown during beta
var TEAM            = 'The eXommerce cloud optimization team';

// Each stage gets a timestamp the first time the audit reaches it: from the website
// form, from the audit scanner (handleAuditEvent), or typed into the Sheet by hand.
var STAGES = [
  { name: 'Lead',                column: 'Lead at' },
  { name: 'Audit Requested',     column: 'Audit requested at' },
  { name: 'AWS Access Verified', column: 'Access verified at' },
  { name: 'Scan Started',        column: 'Scan started at' },
  { name: 'Scan Completed',      column: 'Scan completed at' },
  { name: 'Review Completed',    column: 'Review completed at' },
  { name: 'Results Delivered',   column: 'Results delivered at' },
  { name: 'Paid Opportunity',    column: 'Paid opportunity at' },
  { name: 'Customer',            column: 'Customer at' },
  { name: 'Revenue',             column: 'Revenue at' }
];
var STAGE_NAMES = STAGES.map(function (s) { return s.name; });
var BOOKING_HEADERS = ['Audit ID', 'Status'].concat(STAGES.map(function (s) { return s.column; }), [
  'Name', 'Email', 'Company', 'Website', 'Role', 'Industry', 'Company size', 'Cloud provider',
  'Monthly cloud spend', 'Source', 'Page',
  'Monthly AWS bill (USD)', 'Potential monthly savings (USD)', 'Potential annual savings (USD)',
  'Findings', 'Savings by category', 'Findings by severity', 'Problems found', 'Regions', 'Stack',
  'Hours to results', 'Commercial outcome', 'Revenue (INR)', 'Next review', 'Last reminder', 'Notes']);

// Only these values are accepted from the audit form.
var FORM_OPTIONS = {
  role:     ['Founder / CEO', 'CTO / VP Engineering', 'Head of Infrastructure / DevOps / SRE',
             'Engineer', 'Finance / FinOps', 'Other'],
  industry: ['SaaS / software', 'E-commerce / retail', 'Fintech / financial services', 'Healthcare',
             'Media / entertainment', 'Education', 'Logistics / mobility', 'IT services / agency', 'Other'],
  size:     ['1–10', '11–50', '51–200', '201–1,000', '1,000+'],
  provider: ['AWS', 'AWS + other clouds', 'Azure', 'Google Cloud', 'Other'],
  spend:    ['Under $3k', '$3k–$10k', '$10k–$50k', '$50k+', 'Not sure'],
  source:   ['LinkedIn', 'WhatsApp', 'Referred by someone', 'Google search', 'Event or meetup', 'Email', 'Other']
};
var FIELD_ERRORS = {
  role: 'Please choose your role.', industry: 'Please choose your industry.',
  size: 'Please choose your company size.', provider: 'Please choose your cloud provider.',
  spend: 'Please choose your approximate monthly cloud spend.', source: 'Please tell us how you heard about us.'
};

function doPost(e) {
  var p = (e && e.parameter) || {};

  // Honeypot: people never fill the hidden field, bots do. Pretend success.
  if (p.website) return json({ ok: true });

  if (p.form === 'contact') return handleContact(p);
  if (p.form === 'audit_booking') return handleAuditBooking(p);
  if (p.form === 'audit_event') return handleAuditEvent(p);

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
      subject: (/^Waitlist:/.test(need) ? need + ' · ' : 'New enquiry: ') + (first + ' ' + last).trim() + ' · ' + company,
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

// Free Cloud Cost & Infrastructure Audit request (cloud-audit.html): create the
// audit row (Lead → Audit Requested), email hello@ with the details (reply-to the
// customer) and confirm to the customer with their audit ID. Setup instructions
// and the initial findings go out from hello@.
function handleAuditBooking(p) {
  var f = {
    name: clean(p.name, 100), email: clean(p.email, 120).toLowerCase(), company: clean(p.company, 120),
    site: clean(p.company_site, 200), role: clean(p.role, 60), industry: clean(p.industry, 60),
    size: clean(p.company_size, 20), provider: clean(p.provider, 30), spend: clean(p.spend, 20),
    source: clean(p.source, 40), page: clean(p.page, 300)
  };
  if (!f.name || !f.company) return json({ ok: false, error: 'Please fill in your name and company.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return json({ ok: false, error: 'Please enter a valid work email.' });
  if (f.site && !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(\/\S*)?$/i.test(f.site)) {
    return json({ ok: false, error: 'Please check the website address.' });
  }
  var choices = { role: f.role, industry: f.industry, size: f.size, provider: f.provider,
                  spend: f.spend, source: f.source };
  for (var field in choices) {
    if (FORM_OPTIONS[field].indexOf(choices[field]) < 0) return json({ ok: false, error: FIELD_ERRORS[field] });
  }

  // A double-click or a resubmit within 10 minutes returns the first request.
  var cache = CacheService.getScriptCache();
  var key = 'booking:' + f.email + ':' + f.company.toLowerCase();
  var existing = cache.get(key);
  if (existing) return json({ ok: true, reference: existing, duplicate: true });

  var reference = bookingReference();
  var now = new Date();
  var row = auditRow({
    'Audit ID': reference, 'Status': 'Audit Requested', 'Lead at': now, 'Audit requested at': now,
    'Name': f.name, 'Email': f.email, 'Company': f.company, 'Website': f.site, 'Role': f.role,
    'Industry': f.industry, 'Company size': f.size, 'Cloud provider': f.provider,
    'Monthly cloud spend': f.spend, 'Source': f.source, 'Page': f.page
  });
  var failed = function (why) {   // still a lead, but the request never reached us
    row[BOOKING_HEADERS.indexOf('Status')] = 'Failed: ' + why;
    row[BOOKING_HEADERS.indexOf('Audit requested at')] = '';
    bookingSheet().appendRow(row.map(asText));
    return json({ ok: false, error: 'We could not take the request just now. Please email hello@exommerce.online.' });
  };
  if (MailApp.getRemainingDailyQuota() < 2) return failed('daily email quota reached');

  try {
    MailApp.sendEmail({
      to: NOTIFY_TO,
      replyTo: f.email,
      name: SENDER_NAME + ' website',
      subject: 'Audit request ' + reference + ': ' + f.company + ' (' + f.spend + ', ' + f.provider + ')',
      body: 'New free Cloud Cost & Infrastructure Audit request.\n\n'
          + 'Audit ID:  ' + reference + '\n'
          + 'Name:      ' + f.name + ' (' + f.role + ')\n'
          + 'Email:     ' + f.email + '\n'
          + 'Company:   ' + f.company + (f.site ? ' · ' + f.site : '') + '\n'
          + 'Industry:  ' + f.industry + ' · ' + f.size + ' people\n'
          + 'Cloud:     ' + f.provider + ' · ' + f.spend + '/month\n'
          + 'Source:    ' + f.source + '\n'
          + 'Page:      ' + f.page + '\n\n'
          + (isAws(f.provider) ? '' : 'Not on AWS: we audit AWS only for now, so add them to the Azure/GCP waitlist.\n\n')
          + (f.spend === 'Under $3k' ? 'Small account (under $3k/month): the findings may be modest; say so honestly.\n\n' : '')
          + 'Their confirmation asks them to reply with their AWS account ID, regions, and whether they use '
          + 'Organizations or Control Tower. Check that reply first: if an organization policy blocks regions, '
          + 'scan with --regions.\n\n'
          + 'Next: send the setup instructions. In the scanner folder:\n'
          + '  python -m exaudit setup --reference ' + reference + ' --customer "' + f.company.replace(/"/g, "'") + '" --auditor <our account ID>\n'
          + 'then reply to this email with out/' + reference + '/onboarding/setup-instructions.md.'
    });
    bookingSheet().appendRow(row.map(asText));
  } catch (err) {
    return failed(String(err));
  }
  ensureDashboard();

  // The request is safely logged and hello@ has it, so a failed confirmation
  // email must not turn into an error for the customer.
  try {
    MailApp.sendEmail({
      to: f.email,
      replyTo: NOTIFY_TO,
      name: SENDER_NAME,
      subject: 'Your free cloud cost & infrastructure audit (' + reference + ')',
      body: bookingPlain(f.name, reference, f.provider),
      htmlBody: bookingHtml(f.name, reference, f.provider)
    });
  } catch (err) {
    Logger.log('Audit ' + reference + ' confirmation failed: ' + err);
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

function isAws(provider) { return provider === 'AWS' || provider === 'AWS + other clouds'; }

// A row for the bookings tab, in BOOKING_HEADERS order.
function auditRow(values) {
  return BOOKING_HEADERS.map(function (h) { return values.hasOwnProperty(h) ? values[h] : ''; });
}

var NEXT_STEPS = [
  'We send your setup instructions from hello@exommerce.online, usually the same day.',
  'You create one read-only IAM role. It takes about 5 minutes.',
  'You receive your initial audit findings within 24 hours of successful AWS access.'
];
var REVIEWED = 'Every audit is reviewed by the eXommerce cloud optimization team before results are shared.';
// What holds an audit up, learned from the first live runs. AWS customers only.
var GET_READY = [
  'Turn on Cost Explorer now (Billing and Cost Management → Cost Explorer). AWS takes about a day to fill it '
    + 'in, and without it your findings won\'t include your bill figures.',
  'Line up someone with admin access to your AWS console for 10 minutes. They create the read-only role.',
  'Reply with your AWS account ID and the regions you use, and tell us if you use AWS Organizations or Control '
    + 'Tower. Some organization policies block regions, and knowing in advance avoids a re-run.',
  'Prefer to start with a non-production account? That\'s fine. Tell us which one.'
];
var NEVER_ASK = 'We never ask for access keys, passwords or root credentials. The role can only read, and you '
  + 'can delete it at any time.';
var NOT_AWS = 'We audit AWS today. Azure and Google Cloud are coming, and we\'ll let you know as soon as your '
  + 'cloud is supported.';

function bookingPlain(name, reference, provider) {
  return 'Hi ' + firstName(name) + ',\n\n'
    + 'Thanks for requesting the free eXommerce Cloud Cost & Infrastructure Audit. Your audit ID is '
    + reference + '.\n\n'
    + (isAws(provider) ? '' : NOT_AWS + '\n\n')
    + 'What happens next:\n'
    + NEXT_STEPS.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n') + '\n\n'
    + (isAws(provider)
      ? 'To get ready (optional, saves a day):\n'
        + GET_READY.map(function (s) { return '- ' + s; }).join('\n') + '\n\n'
        + NEVER_ASK + '\n\n'
      : '')
    + REVIEWED + '\n\n'
    + 'Questions? Just reply to this email.\n\n'
    + '— ' + TEAM + '\n' + SITE + '/cloud-audit.html';
}

function bookingHtml(name, reference, provider) {
  var li = 'margin:0 0 8px;font-size:15px;line-height:1.6';
  var p = 'margin:0 0 14px;font-size:14px;line-height:1.6';
  return '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#3F4852">'
    + '<div style="background:#109840;padding:18px 26px;border-radius:10px 10px 0 0">'
    + '<span style="color:#fff;font-size:19px;font-weight:700">eXommerce.online</span></div>'
    + '<div style="border:1px solid #DDE8E0;border-top:0;padding:26px;border-radius:0 0 10px 10px">'
    + '<p style="margin:0 0 14px;font-size:15px">Hi ' + esc(firstName(name)) + ',</p>'
    + '<p style="margin:0 0 16px;font-size:15px;line-height:1.6">Thanks for requesting the free eXommerce '
    + 'Cloud Cost &amp; Infrastructure Audit. Your audit ID is <b style="color:#0B0D0C">' + esc(reference) + '</b>.</p>'
    + (isAws(provider) ? '' : '<p style="' + p + '">' + esc(NOT_AWS) + '</p>')
    + '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0B0D0C">What happens next</p>'
    + '<ol style="margin:0 0 18px;padding-left:20px">'
    + NEXT_STEPS.map(function (s) { return '<li style="' + li + '">' + esc(s) + '</li>'; }).join('')
    + '</ol>'
    + (isAws(provider)
      ? '<p style="margin:0 0 8px;font-size:15px;font-weight:700;color:#0B0D0C">To get ready '
        + '<span style="font-weight:400;color:#6B7280">(optional, saves a day)</span></p>'
        + '<ul style="margin:0 0 16px;padding-left:20px">'
        + GET_READY.map(function (s) { return '<li style="' + li + '">' + esc(s) + '</li>'; }).join('')
        + '</ul>'
        + '<p style="margin:0 0 16px;font-size:14px;line-height:1.6;background:#EFF8F1;padding:12px 14px;border-radius:8px">'
        + esc(NEVER_ASK) + '</p>'
      : '')
    + '<p style="margin:0 0 20px;font-size:14px;line-height:1.6">' + esc(REVIEWED) + '</p>'
    + '<p style="margin:0;font-size:14px">Questions? Just reply to this email.</p>'
    + '<p style="margin:18px 0 0;font-size:14px">— ' + esc(TEAM) + '</p>'
    + '</div>'
    + '<p style="font-size:11px;color:#9CA3AF;padding:12px 4px">eXommerce LLP · Bengaluru · '
    + '<a href="' + SITE + '/cloud-audit.html#audit-terms" style="color:#9CA3AF">Audit terms</a> · '
    + '<a href="' + SITE + '/privacy.html" style="color:#9CA3AF">Privacy</a></p></div>';
}

// ---- Funnel updates from the audit scanner ---------------------------------------------
// POST form=audit_event&token=…&reference=AUD-…&stage=Scan Completed&at=<ISO time>
// plus optional metrics (see EVENT_FIELDS). Only callers holding the token (kept in
// Script Properties, never in this file or the Sheet) can update a row.
var EVENT_FIELDS = {
  bill: 'Monthly AWS bill (USD)', monthly: 'Potential monthly savings (USD)',
  annual: 'Potential annual savings (USD)', findings: 'Findings', categories: 'Savings by category',
  severity: 'Findings by severity', problems: 'Problems found', regions: 'Regions', stack: 'Stack',
  outcome: 'Commercial outcome', revenue: 'Revenue (INR)'
};
var NUMERIC_FIELDS = { bill: true, monthly: true, annual: true, findings: true, revenue: true };

function handleAuditEvent(p) {
  var token = PropertiesService.getScriptProperties().getProperty('EVENTS_TOKEN');
  if (!token || p.token !== token) return json({ ok: false, error: 'not authorized' });
  var reference = clean(p.reference, 40);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{2,40}$/.test(reference)) return json({ ok: false, error: 'bad audit ID' });
  var stage = STAGE_NAMES.indexOf(p.stage) >= 0 ? p.stage : '';
  if (p.stage && !stage) return json({ ok: false, error: 'unknown stage' });
  var at = p.at ? new Date(p.at) : new Date();
  if (isNaN(at.getTime())) at = new Date();

  var sheet = bookingSheet();
  var values = sheet.getDataRange().getValues();
  var col = {};
  values[0].forEach(function (h, i) { col[h] = i; });
  var r = -1;
  for (var i = 1; i < values.length; i++) if (values[i][col['Audit ID']] === reference) { r = i; break; }
  if (r < 0) {   // an audit that didn't start on the website (a referral, a call): track it too
    sheet.appendRow(auditRow({ 'Audit ID': reference, 'Status': 'Lead', 'Lead at': at, 'Source': 'Direct' }).map(asText));
    values = sheet.getDataRange().getValues();
    r = values.length - 1;
  }
  var set = function (header, value) {
    sheet.getRange(r + 1, col[header] + 1).setValue(asText(value));
    values[r][col[header]] = value;
  };

  if (stage) {
    var column = STAGES[STAGE_NAMES.indexOf(stage)].column;
    if (values[r][col[column]] === '' || values[r][col[column]] == null) set(column, at);   // keep the first time
    if (STAGE_NAMES.indexOf(stage) > STAGE_NAMES.indexOf(values[r][col['Status']])) set('Status', stage);
    var verified = values[r][col['Access verified at']];
    if (stage === 'Results Delivered' && Object.prototype.toString.call(verified) === '[object Date]') {
      set('Hours to results', Math.round((at - verified) / 36e5 * 10) / 10);
    }
  }
  Object.keys(EVENT_FIELDS).forEach(function (field) {
    if (p[field] == null || p[field] === '') return;
    var value = NUMERIC_FIELDS[field] ? Number(p[field]) : clean(p[field], 500);
    if (NUMERIC_FIELDS[field] && isNaN(value)) return;
    set(EVENT_FIELDS[field], value);
  });
  ensureDashboard();
  return json({ ok: true, reference: reference, status: values[r][col['Status']] });
}

// Select createEventsToken → Run once, then copy the token from the execution log into the
// EXAUDIT_EVENTS_TOKEN environment variable on the machine that runs the scanner (never into
// a file in a repo). Running it again replaces (and so revokes) the old one.
function createEventsToken() {
  var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('EVENTS_TOKEN', token);
  Logger.log('Events token for scanner/local-config.json: ' + token);
  return token;
}

// The bookings tab, created with its headers if it doesn't exist yet. A tab left over
// from an older version of this script (different columns) is renamed, never written
// into, so no value can land under the wrong heading.
function bookingSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(BOOKING_SHEET);
  if (sheet && sheet.getLastRow() > 0) {
    var headers = sheet.getRange(1, 1, 1, BOOKING_HEADERS.length).getValues()[0];
    if (headers.join('\u0001') !== BOOKING_HEADERS.join('\u0001')) {
      sheet.setName(BOOKING_SHEET + ' (old format ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd') + ')');
      sheet = null;
    }
  }
  if (!sheet) sheet = ss.insertSheet(BOOKING_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(BOOKING_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ---- Beta dashboard ----------------------------------------------------------------------
// The "Beta dashboard" tab builds itself the first time it's needed (see ensureDashboard);
// select buildDashboard → Run to rebuild it after changing this section. Every number is a
// live formula over "Audit bookings", so it only ever shows real audits; until the first
// request arrives it says so instead of showing charts of zeros.
function ensureDashboard() {
  try {
    if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(DASHBOARD_SHEET)) buildDashboard();
  } catch (err) {                  // a dashboard problem must never fail a visitor's request
    Logger.log('Dashboard not built: ' + err);
  }
}

// The scanner's labels for each kind of finding (exaudit/events.py PROBLEM_LABELS).
var PROBLEMS = ['Unattached EBS volumes', 'gp2 volumes not on gp3', 'Old EBS snapshots', 'Unused Elastic IPs',
  'Idle EC2 instances', 'Long-stopped EC2 instances', 'Oversized EC2 instances', 'Idle NAT gateways',
  'Idle load balancers', 'Logs kept forever', 'Idle RDS databases', 'Oversized RDS databases',
  'Steady usage on on-demand pricing'];
// [label, text the scanner writes in the Stack column]
var STACK_ITEMS = [['EKS (Kubernetes)', 'EKS'], ['ECS', 'ECS'], ['Lambda', 'Lambda'], ['Aurora', 'Aurora'],
  ['DynamoDB', 'DynamoDB'], ['CloudFront', 'CloudFront'], ['Terraform', 'Terraform'],
  ['CloudFormation', 'CloudFormation'], ['Any AWS CI/CD service', 'CI/CD:'], ['GuardDuty', 'GuardDuty']];

function buildDashboard() {
  bookingSheet();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DASHBOARD_SHEET) || ss.insertSheet(DASHBOARD_SHEET);
  sheet.clear();
  var range = function (header) {
    var letter = columnLetter(BOOKING_HEADERS.indexOf(header) + 1);
    return "'" + BOOKING_SHEET + "'!" + letter + '2:' + letter;
  };
  var none = '"—"';
  // Audits that reached this stage or any later one (a referral that started with a scan
  // still counts as requested), from real timestamps only: nothing is backfilled.
  var reached = function (stage) {
    return '((' + STAGES.slice(STAGE_NAMES.indexOf(stage)).map(function (s) {
      return '(' + range(s.column) + '<>"")';
    }).join('+') + ')>0)';
  };
  var rows = [
    ['eXommerce audit beta', '', '', ''],
    ['=IF(COUNTA(' + range('Audit ID') + ')=0,"No audits yet. This fills in as requests arrive.",'
      + '"Live from the Audit bookings tab. A dash means there is no data for it yet.")', '', '', ''],
    ['Funnel stage', 'Audits reaching it', 'Share of audit requests', '']
  ];
  STAGES.forEach(function (s) {
    var n = rows.length + 1;
    rows.push([s.name, '=SUMPRODUCT(--' + reached(s.name) + ')', '=IF($B$5=0,' + none + ',B' + n + '/$B$5)', '']);
  });
  var sum = function (header) {
    return '=IF(COUNT(' + range(header) + ')=0,' + none + ',SUM(' + range(header) + '))';
  };
  var bill = range('Monthly AWS bill (USD)'), saved = range('Potential monthly savings (USD)');
  var revenue = range('Revenue (INR)'), delivered = range('Results delivered at');
  rows.push(['', '', '', ''], ['Money and speed', '', '', '']);
  rows.push(['AWS spend scanned (USD/month)', sum('Monthly AWS bill (USD)'), '', '']);
  rows.push(['Potential savings found (USD/month)', sum('Potential monthly savings (USD)'), '', '']);
  rows.push(['Potential savings found (USD/year)', sum('Potential annual savings (USD)'), '', '']);
  rows.push(['Potential savings as a share of spend', '=IF(SUMIFS(' + bill + ',' + saved + ',"<>")=0,' + none
    + ',SUMIFS(' + saved + ',' + bill + ',">0")/SUMIFS(' + bill + ',' + saved + ',"<>"))', '', '']);
  rows.push(['Findings reported', sum('Findings'), '', '']);
  rows.push(['Revenue (INR)', sum('Revenue (INR)'), '', '']);
  rows.push(['Revenue per delivered audit (INR)', '=IF(OR(COUNT(' + revenue + ')=0,COUNTA(' + delivered + ')=0),'
    + none + ',SUM(' + revenue + ')/COUNTA(' + delivered + '))', '', '']);
  rows.push(['Median hours from AWS access to results', '=IF(COUNT(' + range('Hours to results') + ')=0,'
    + none + ',MEDIAN(' + range('Hours to results') + '))', '', '']);
  var shareRow = rows.length - 4;   // "Potential savings as a share of spend"

  // Which prospects respond (give AWS access) and which become customers.
  var breakdown = function (title, header, options) {
    rows.push(['', '', '', ''], [title, 'Audit requests', 'Gave AWS access', 'Customers']);
    options.forEach(function (option) {
      var match = '(' + range(header) + '="' + option + '")*';
      rows.push([option, '=SUMPRODUCT(' + match + reached('Audit Requested') + ')',
                 '=SUMPRODUCT(' + match + reached('AWS Access Verified') + ')',
                 '=SUMPRODUCT(' + match + reached('Customer') + ')']);
    });
  };
  breakdown('Source', 'Source', FORM_OPTIONS.source.concat(['Direct']));
  breakdown('Monthly cloud spend', 'Monthly cloud spend', FORM_OPTIONS.spend);
  breakdown('Company size', 'Company size', FORM_OPTIONS.size);
  breakdown('Industry', 'Industry', FORM_OPTIONS.industry);
  breakdown('Role', 'Role', FORM_OPTIONS.role);
  breakdown('Cloud provider', 'Cloud provider', FORM_OPTIONS.provider);

  var seen = function (title, items) {   // items: [label, text to look for]
    rows.push(['', '', '', ''], [title, 'Audits', '', '']);
    items.forEach(function (item) {
      rows.push([item[0], '=COUNTIF(' + range(title === 'Common problems' ? 'Problems found' : 'Stack')
        + ',"*' + item[1] + '*")', '', '']);
    });
  };
  seen('Common problems', PROBLEMS.map(function (p) { return [p, p]; }));
  seen('Stack seen in audits', STACK_ITEMS);

  sheet.getRange(1, 1, rows.length, 4).setValues(rows);
  sheet.getRange(4, 3, STAGES.length, 1).setNumberFormat('0%');
  sheet.getRange(shareRow, 2).setNumberFormat('0.0%');
  sheet.setFrozenRows(3);
  return rows.length;
}

function columnLetter(n) {
  var s = '';
  while (n > 0) {
    var m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// ---- Recurring reviews ---------------------------------------------------------------------
// Runs daily from a time-driven trigger added once in the editor (Triggers → Add trigger →
// remindDueScans, Time-driven, Day timer). A trigger added there needs no extra permission,
// unlike one created from code. For clients on Ongoing Cloud
// Optimization & Support, put the next review date in "Next review"; when it arrives, hello@
// gets one email listing everyone due, and "Last reminder" records that it was sent.
function remindDueScans() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(BOOKING_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return 0;
  var values = sheet.getDataRange().getValues();
  var col = {};
  values[0].forEach(function (h, i) { col[h] = i; });
  var isDate = function (v) { return Object.prototype.toString.call(v) === '[object Date]'; };
  var endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  var due = [];
  for (var r = 1; r < values.length; r++) {
    var next = values[r][col['Next review']];
    var last = values[r][col['Last reminder']];
    if (isDate(next) && next <= endOfToday && !(isDate(last) && last >= next)) due.push(r);
  }
  if (!due.length) return 0;

  var tz = Session.getScriptTimeZone();
  var lines = due.map(function (r) {
    var v = values[r];
    return '- ' + v[col['Audit ID']] + ' · ' + v[col['Company']] + ' · ' + v[col['Name']]
      + ' <' + v[col['Email']] + '> · due ' + Utilities.formatDate(v[col['Next review']], tz, 'd MMM yyyy');
  });
  MailApp.sendEmail({
    to: NOTIFY_TO,
    name: SENDER_NAME + ' website',
    subject: due.length + ' cost review' + (due.length === 1 ? '' : 's') + ' due',
    body: 'These clients are due their next cost review:\n\n' + lines.join('\n') + '\n\n'
        + 'Ask each to send the findings.json from their last report, then run\n'
        + '  python -m exaudit scan --reference <new audit ID> --compare-with findings.json\n'
        + 'so the new report shows what changed. Set the following "Next review" date when you\'re done.'
  });
  var now = new Date();
  due.forEach(function (r) { sheet.getRange(r + 1, col['Last reminder'] + 1).setValue(now); });
  return due.length;
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
// which forms this version handles. It also creates the dashboard tab if it's missing.
function doGet() {
  ensureDashboard();
  return json({ ok: true, service: 'eXommerce case-study mailer',
                forms: ['case_study', 'contact', 'audit_booking', 'audit_event'] });
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

// Select testBooking → Run to try an audit request end to end (both emails go to hello@).
function testBooking() {
  var out = doPost({ parameter: {
    form: 'audit_booking', name: 'Test Booking', email: NOTIFY_TO, company: 'eXommerce test',
    company_site: 'exommerce.online', role: 'Founder / CEO', industry: 'IT services / agency',
    company_size: '1–10', provider: 'AWS', spend: '$3k–$10k', source: 'Other', page: 'editor test'
  }});
  Logger.log(out.getContent());
}
