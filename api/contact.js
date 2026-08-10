// Contact form handler — receives the enquiry and emails it to admin@exommerce.online.
//
// Runs on the site's own domain, so the browser makes a same-origin request and
// CORS never enters the picture. Requires one environment variable in Vercel:
//
//   RESEND_API_KEY   — your Resend API key
//   CONTACT_FROM     — optional; defaults to onboarding@resend.dev, which Resend
//                      only allows delivering to your own account address. Once
//                      exommerce.online is verified in Resend, set this to
//                      "eXommerce <noreply@exommerce.online>".

const TO = 'admin@exommerce.online';
const FROM = process.env.CONTACT_FROM || 'eXommerce <onboarding@resend.dev>';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function row(label, value) {
  return '<tr>'
    + '<td style="padding:6px 16px 6px 0;color:#6B7280;white-space:nowrap;vertical-align:top;font-size:14px">' + esc(label) + '</td>'
    + '<td style="padding:6px 0;color:#0B0D0C;font-weight:500;font-size:14px">' + (value || '&mdash;') + '</td>'
    + '</tr>';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error('contact: RESEND_API_KEY is not set');
    return res.status(500).json({ error: 'Mail is not configured' });
  }

  // Vercel parses JSON and form-encoded bodies into req.body.
  const b = req.body || {};

  // Honeypot — real users never fill a hidden field, bots do.
  if (b.website) return res.status(200).json({ ok: true });

  const fname   = String(b.fname   || '').trim();
  const lname   = String(b.lname   || '').trim();
  const email   = String(b.email   || '').trim();
  const company = String(b.company || '').trim();
  const need    = String(b.need    || b.challenges || '').trim();
  const message = String(b.message || b.painpoint  || '').trim();

  if (!fname || !email || !company) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const name = (fname + ' ' + lname).trim();
  const subject = 'New enquiry: ' + name + ' · ' + company;

  const text = [
    'New enquiry from exommerce.online', '',
    'Name:    ' + name,
    'Email:   ' + email,
    'Company: ' + company,
    'Need:    ' + (need || '—'), '',
    'Message:', (message || '—'), '',
    'Reply to: ' + email
  ].join('\n');

  const html =
    '<div style="font-family:system-ui,Arial,sans-serif;max-width:600px;margin:0 auto">'
    + '<div style="background:#109840;padding:20px 28px">'
    + '<span style="color:#fff;font-size:20px;font-weight:700">eXommerce.online</span></div>'
    + '<div style="background:#F7FBF8;padding:28px;border:1px solid #DDE8E0;border-top:0">'
    + '<h2 style="margin:0 0 20px;font-size:17px;color:#0B0D0C">New enquiry</h2>'
    + '<table style="width:100%;border-collapse:collapse">'
    + row('Name', esc(name))
    + row('Email', '<a href="mailto:' + esc(email) + '" style="color:#109840">' + esc(email) + '</a>')
    + row('Company', esc(company))
    + row('Need', esc(need))
    + '</table>'
    + '<hr style="margin:18px 0;border:none;border-top:1px solid #DDE8E0">'
    + '<p style="margin:0 0 6px;font-size:13px;color:#6B7280">Message</p>'
    + '<p style="margin:0;font-size:14px;color:#0B0D0C;line-height:1.6;white-space:pre-wrap">' + esc(message || '—') + '</p>'
    + '<div style="margin-top:22px">'
    + '<a href="mailto:' + esc(email) + '" style="background:#109840;color:#fff;padding:11px 22px;'
    + 'border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Reply to ' + esc(fname) + ' &rarr;</a>'
    + '</div></div>'
    + '<div style="padding:14px 28px;font-size:12px;color:#9CA3AF">eXommerce LLP · Bengaluru · exommerce.online</div>'
    + '</div>';

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email,
        subject: subject,
        text: text,
        html: html
      })
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('contact: resend rejected', r.status, detail);
      return res.status(502).json({ error: 'Could not send' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('contact: send failed', err);
    return res.status(502).json({ error: 'Could not send' });
  }
}
