import * as nodemailer from 'nodemailer';

export function superAdminOtpDestination(): string {
  return (
    process.env.SUPER_ADMIN_OTP_EMAIL?.trim() ||
    'ycdoservehumanityofficial@gmail.com'
  );
}

function smtpConfigured(): boolean {
  return Boolean(
    process.env.SMTP_HOST?.trim() &&
      process.env.SMTP_USER?.trim() &&
      process.env.SMTP_PASS?.trim(),
  );
}

export async function sendOtpEmail(params: {
  to: string;
  code: string;
  loginEmail: string;
}): Promise<void> {
  if (!smtpConfigured()) {
    // Local/dev fallback so login is not permanently locked without SMTP.
    console.warn(
      `[OTP] SMTP not configured. Super Admin OTP for ${params.loginEmail} → ${params.to}: ${params.code}`,
    );
    return;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === 'true' || port === 465;

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const from =
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER!.trim();

  await transporter.sendMail({
    from: `YCDO HRMS <${from}>`,
    to: params.to,
    subject: 'YCDO HRMS — Super Admin login OTP',
    text: [
      'YCDO HRMS Super Admin login verification',
      '',
      `A Super Admin login was attempted for: ${params.loginEmail}`,
      `Your one-time password (OTP) is: ${params.code}`,
      '',
      'This code expires in 10 minutes. If you did not attempt this login, secure the account immediately.',
    ].join('\n'),
    html: `
      <p><strong>YCDO HRMS Super Admin login verification</strong></p>
      <p>A Super Admin login was attempted for: <code>${params.loginEmail}</code></p>
      <p>Your one-time password (OTP) is:</p>
      <p style="font-size:28px;letter-spacing:6px;font-weight:bold;">${params.code}</p>
      <p>This code expires in 10 minutes.</p>
      <p>If you did not attempt this login, secure the account immediately.</p>
    `,
  });
}
