const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const CONTACT_TO_EMAIL = Deno.env.get("CONTACT_TO_EMAIL");
const CONTACT_FROM_EMAIL = Deno.env.get("CONTACT_FROM_EMAIL") ?? "ER Team Picker <onboarding@resend.dev>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  if (!RESEND_API_KEY || !CONTACT_TO_EMAIL) {
    return Response.json({ ok: false, error: "Email secrets are not configured." }, { status: 200, headers: corsHeaders });
  }

  const body = await request.json().catch(() => ({}));
  const message = String(body.message ?? "").trim();
  const replyTo = String(body.reply_to ?? body.replyTo ?? "").trim();
  const appVersion = String(body.app_version ?? body.appVersion ?? "").trim();

  if (!message) {
    return Response.json({ ok: false, error: "Message is required." }, { status: 400, headers: corsHeaders });
  }

  const html = `
    <h2>ER Team Picker 문의</h2>
    <p><strong>답변 연락처:</strong> ${escapeHtml(replyTo || "없음")}</p>
    <p><strong>앱 버전:</strong> ${escapeHtml(appVersion || "desktop")}</p>
    <hr>
    <p style="white-space: pre-wrap;">${escapeHtml(message)}</p>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: CONTACT_FROM_EMAIL,
      to: CONTACT_TO_EMAIL,
      reply_to: replyTo || undefined,
      subject: "[ER Team Picker] 새 문의가 도착했습니다",
      html,
    }),
  });

  if (!response.ok) {
    return Response.json({ ok: false, error: await response.text() }, { status: 200, headers: corsHeaders });
  }

  return Response.json({ ok: true }, { headers: corsHeaders });
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
