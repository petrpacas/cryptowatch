// Public application URL used in notification emails.
export const APP_URL = "https://cryptowatch-demo.netlify.app/";
export const MAGIC_LINK_SUBJECT = "Tvůj přihlašovací odkaz do CryptoWatch";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

type EmailLayout = {
  preview: string;
  eyebrow: string;
  title: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  footer: string;
};

// Table layout and inline styles work without external fonts, images, CSS or JavaScript.
// body is trusted HTML; caller must escape every interpolated data value.
export function emailLayout(content: EmailLayout): string {
  const url = escapeHtml(content.actionUrl);
  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>${escapeHtml(content.title)} · CryptoWatch</title>
</head>
<body style="margin:0;padding:0;background-color:#07110f;color:#f3fbf7;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(content.preview)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#07110f">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:560px;">
        <tr><td style="padding:0 0 24px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
            <td align="center" width="38" height="38" style="border:1px solid #548b75;border-radius:10px;color:#82f5c9;font:18px/38px 'Courier New',monospace;">C</td>
            <td style="padding-left:12px;color:#f3fbf7;font-size:18px;font-weight:700;">CryptoWatch</td>
          </tr></table>
        </td></tr>
        <tr><td bgcolor="#0c1f19" style="padding:32px 24px;border:1px solid #385348;border-radius:16px;">
          <p style="margin:0 0 14px;color:#82f5c9;font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">${escapeHtml(content.eyebrow)}</p>
          <h1 style="margin:0 0 20px;color:#f3fbf7;font-size:28px;line-height:1.25;">${escapeHtml(content.title)}</h1>
          ${content.body}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:28px;"><tr>
            <td bgcolor="#82f5c9" style="border-radius:8px;text-align:center;mso-padding-alt:15px 24px;">
              <a href="${url}" style="display:inline-block;padding:15px 24px;border:1px solid #82f5c9;border-radius:8px;color:#052217;background-color:#82f5c9;font-size:16px;font-weight:700;line-height:20px;text-decoration:none;">${escapeHtml(content.actionLabel)}</a>
            </td>
          </tr></table>
          <p style="margin:24px 0 8px;color:#b3c7be;font-size:13px;line-height:1.6;">Pokud tlačítko nefunguje, otevři tento odkaz:</p>
          <p style="margin:0;font-size:13px;line-height:1.6;overflow-wrap:anywhere;word-break:break-all;"><a href="${url}" style="color:#a5ffdd;text-decoration:underline;">${url}</a></p>
        </td></tr>
        <tr><td style="padding:22px 4px;color:#b3c7be;font-size:13px;line-height:1.7;">${escapeHtml(content.footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function magicLinkEmail(): string {
  return emailLayout({
    preview: "Přihlas se jedním kliknutím a podívej se na své sledované kryptoměny.",
    eyebrow: "Přihlášení bez hesla",
    title: "Tvoje kryptoměny čekají.",
    body: `<p style="margin:0 0 16px;color:#b3c7be;font-size:16px;line-height:1.7;">Klikni na tlačítko a přihlas se do CryptoWatch. Při prvním přihlášení ti vytvoříme účet.</p>
          <p style="margin:0;color:#b3c7be;font-size:16px;line-height:1.7;">Odkaz je jednorázový. Pokud už vypršel, požádej na přihlašovací stránce o nový.</p>`,
    actionLabel: "Přihlásit se do CryptoWatch",
    actionUrl: "{{ .ConfirmationURL }}",
    footer: "Pokud jsi o přihlášení nepožádal, tento e-mail můžeš ignorovat. Odkaz nikomu nepřeposílej — slouží k přihlášení do tvého účtu.",
  });
}
