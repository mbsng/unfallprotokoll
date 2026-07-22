export interface EmailAttachment {
  filename: string;
  content: string;
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  attachments: EmailAttachment[];
}

export async function sendEmail(options: SendEmailOptions) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM") ?? "Unfallprotokoll <onboarding@resend.dev>";
  if (!apiKey) throw new Error("email_provider_not_configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, ...options }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`email_send_failed:${body?.message ?? response.status}`);
  return body as { id: string };
}
