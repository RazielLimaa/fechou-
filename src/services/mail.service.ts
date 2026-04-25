type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getRequiredEnv(name: string): string {
  const value = String(process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`${name} não configurado.`);
  }
  return value;
}

export async function sendEmail(input: SendEmailInput): Promise<void> {
  const apiKey = getRequiredEnv("RESEND_API_KEY");
  const from = getRequiredEnv("MAIL_FROM");
  const replyTo = String(process.env.MAIL_REPLY_TO ?? "").trim() || undefined;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Falha ao enviar email (${response.status}): ${body.slice(0, 300)}`);
  }
}

export async function sendPasswordResetEmail(input: {
  to: string;
  name: string;
  resetUrl: string;
  expiresMinutes: number;
}): Promise<void> {
  const safeName = input.name.trim() || "usuário";
  const safeNameHtml = escapeHtml(safeName);
  const resetUrlHtml = escapeHtml(input.resetUrl);
  const subject = "Redefina sua senha";
  const text = [
    `Olá, ${safeName}.`,
    "",
    "Recebemos um pedido para redefinir sua senha.",
    `Use o link abaixo em até ${input.expiresMinutes} minutos:`,
    input.resetUrl,
    "",
    "Se você não pediu esta alteração, ignore este email.",
  ].join("\n");

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #111;">
      <p>Olá, ${safeNameHtml}.</p>
      <p>Recebemos um pedido para redefinir sua senha.</p>
      <p>Use o link abaixo em até <strong>${input.expiresMinutes} minutos</strong>:</p>
      <p>
        <a href="${resetUrlHtml}" style="display:inline-block;padding:12px 18px;background:#111;color:#fff;text-decoration:none;border-radius:8px;">
          Redefinir senha
        </a>
      </p>
      <p>Se o botão não funcionar, copie e cole este link no navegador:</p>
      <p style="word-break: break-all;">${resetUrlHtml}</p>
      <p>Se você não pediu esta alteração, ignore este email.</p>
    </div>
  `;

  await sendEmail({
    to: input.to,
    subject,
    html,
    text,
  });
}

function buildFechouEmailShell(input: {
  preheader: string;
  title: string;
  eyebrow: string;
  introHtml: string;
  bodyHtml: string;
  footerHtml: string;
}): string {
  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      ${escapeHtml(input.preheader)}
    </div>
    <div style="margin:0;padding:32px 16px;background:#f5f1eb;font-family:Arial,sans-serif;color:#1f1a17;">
      <div style="max-width:640px;margin:0 auto;">
        <div style="margin-bottom:18px;">
          <div style="font-size:30px;font-weight:900;letter-spacing:-0.03em;color:#111111;">
            FECHOU<span style="color:#ff6600;">!</span>
          </div>
          <div style="margin-top:4px;font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#8b6b56;">
            Recuperacao segura de acesso
          </div>
        </div>
        <div style="background:#fffdfb;border:1px solid #eadfd3;border-radius:24px;overflow:hidden;box-shadow:0 18px 50px rgba(17,17,17,0.08);">
          <div style="padding:28px 28px 20px;background:linear-gradient(135deg,#111111 0%,#2f241f 100%);color:#fff;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#ffb37a;">
              ${escapeHtml(input.eyebrow)}
            </div>
            <h1 style="margin:12px 0 0;font-size:28px;line-height:1.15;font-weight:800;color:#fff;">
              ${escapeHtml(input.title)}
            </h1>
          </div>
          <div style="padding:28px;">
            <div style="font-size:15px;line-height:1.7;color:#3c312b;">
              ${input.introHtml}
            </div>
            <div style="margin-top:22px;">
              ${input.bodyHtml}
            </div>
            <div style="margin-top:26px;font-size:13px;line-height:1.7;color:#7c6658;">
              ${input.footerHtml}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export async function sendPasswordResetVerificationEmail(input: {
  to: string;
  name: string;
  code: string;
  verifyUrl?: string;
  expiresMinutes: number;
}): Promise<void> {
  const safeName = input.name.trim() || "usuário";
  const safeNameHtml = escapeHtml(safeName);
  const codeHtml = escapeHtml(input.code.toUpperCase());
  const verifyUrl = String(input.verifyUrl ?? "").trim();
  const verifyUrlHtml = verifyUrl ? escapeHtml(verifyUrl) : "";
  const subject = "Seu codigo de verificacao Fechou";

  const text = [
    `Olá, ${safeName}.`,
    "",
    "Recebemos uma solicitação para trocar sua senha na Fechou.",
    `Use este código em até ${input.expiresMinutes} minutos: ${input.code.toUpperCase()}`,
    verifyUrl ? `Abra esta página para continuar: ${verifyUrl}` : "",
    "",
    "Se você não pediu essa troca, ignore este email.",
  ]
    .filter(Boolean)
    .join("\n");

  const actionHtml = verifyUrl
    ? `
      <p style="margin:0 0 16px;">
        <a href="${verifyUrlHtml}" style="display:inline-block;padding:14px 20px;background:#ff6600;color:#111111;text-decoration:none;border-radius:14px;font-weight:800;">
          Continuar verificacao
        </a>
      </p>
      <p style="margin:0;font-size:12px;color:#8a7568;word-break:break-all;">${verifyUrlHtml}</p>
    `
    : "";

  const html = buildFechouEmailShell({
    preheader: "Use seu codigo para liberar a troca de senha.",
    eyebrow: "Seguranca em duas etapas",
    title: "Confirme a troca da sua senha",
    introHtml: `<p style="margin:0 0 12px;">Olá, <strong>${safeNameHtml}</strong>.</p><p style="margin:0;">Recebemos um pedido para redefinir a senha da sua conta. Antes de liberar a alteração, confirme este código.</p>`,
    bodyHtml: `
      <div style="padding:20px;border-radius:20px;background:#fff6ef;border:1px solid #ffd6b8;">
        <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#9b5d2e;font-weight:700;">Codigo de verificacao</div>
        <div style="margin-top:10px;font-size:34px;line-height:1;font-weight:900;letter-spacing:0.24em;color:#111111;">
          ${codeHtml}
        </div>
        <div style="margin-top:12px;font-size:13px;color:#6f5d51;">
          Expira em <strong>${input.expiresMinutes} minutos</strong>.
        </div>
      </div>
      <div style="margin-top:18px;">
        ${actionHtml}
      </div>
    `,
    footerHtml: `<p style="margin:0;">Depois de validar o código, o sistema libera a página final para definir uma nova senha.</p><p style="margin:12px 0 0;">Se você não reconhece essa tentativa, ignore esta mensagem e mantenha sua senha atual.</p>`,
  });

  await sendEmail({
    to: input.to,
    subject,
    html,
    text,
  });
}
