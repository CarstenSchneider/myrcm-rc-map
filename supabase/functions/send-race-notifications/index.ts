import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Email template (matches magic-link design) ─────────────────────────────

function emailHtml(rows: { venueName: string; type: "new_race" | "registration_open"; raceName: string; raceDate: string; raceUrl: string }[]): string {
  const items = rows.map(r => {
    const label = r.type === "new_race" ? "Neues Rennen" : "Nennung geöffnet";
    const color = r.type === "registration_open" ? "#22c55e" : "#C8B090";
    return `
      <tr>
        <td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
          <div style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.06em; color:${color}; margin-bottom:4px;">${label}</div>
          <div style="font-size:13px; color:#9ca3af; margin-bottom:2px;">${escHtml(r.venueName)}</div>
          <div style="font-size:15px; font-weight:700; color:#213769; margin-bottom:4px;">${escHtml(r.raceName)}</div>
          <div style="font-size:13px; color:#374151; margin-bottom:8px;">${escHtml(r.raceDate)}</div>
          <a href="${r.raceUrl}" style="display:inline-block; background:#213769; color:#ffffff; text-decoration:none; font-size:13px; font-weight:600; padding:8px 20px; border-radius:999px;">Auf der Karte ansehen</a>
        </td>
      </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="de" style="color-scheme: light dark;">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RC Race Map – Neuigkeiten</title>
<style>
  :root { color-scheme: light dark; }
  @media (prefers-color-scheme: dark) {
    body { background: #0d1628 !important; }
    .email-outer  { background: #0d1628 !important; }
    .email-card   { background: #111c33 !important; }
    .email-header { background: #111c33 !important; }
    .email-body   { background: #182540 !important; }
    .email-h1     { color: #d8e0f0 !important; }
    .email-p      { color: #8a9bb8 !important; }
    .email-small  { color: #4a5a78 !important; }
    .email-footer { background: #111c33 !important; border-top-color: #1e2f50 !important; }
    .email-footer a { color: #4a5a78 !important; }
    .item-title   { color: #d8e0f0 !important; }
    .item-venue   { color: #8a9bb8 !important; }
    .item-date    { color: #8a9bb8 !important; }
    .item-sep     { border-bottom-color: #1e2f50 !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background:#f0f2f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;">
<table class="email-outer" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f2f5; padding: 40px 16px;">
  <tr>
    <td align="center">
      <table class="email-card" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background:#ffffff; border-radius:12px; overflow:hidden;">

        <!-- Header -->
        <tr>
          <td class="email-header" align="center" style="background:#213769; padding: 36px 40px 28px;">
            <svg width="44" height="49" viewBox="0 0 477 528.98" xmlns="http://www.w3.org/2000/svg" style="display:block; margin: 0 auto 16px;">
              <g fill="#C8B090">
                <path d="M249.52,205.37v66.26c22.09-2.98,44.17-5.96,66.26-6.71v-66.26c-22.09.75-44.17,3.73-66.26,6.71Z"/>
                <path d="M477,238.5C477,106.78,370.22,0,238.5,0S0,106.78,0,238.5c0,111.19,76.09,204.61,179.04,231.03l59.46,59.46,59.46-59.46c102.95-26.42,179.04-119.84,179.04-231.03ZM382.05,271.63c-22.09-5.96-44.17-7.45-66.26-6.71v66.26c-22.09.75-44.17,3.73-66.26,6.71v-66.26c-22.09,2.98-44.17,5.96-66.26,6.71v66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v-66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v66.26c22.09-.75,44.17-3.73,66.26-6.71v-66.26c22.09-2.98,44.17-5.96,66.26-6.71v66.26c22.09-.75,44.17.75,66.26,6.71v66.26Z"/>
              </g>
            </svg>
            <div style="color:#C8B090; font-size:10px; font-weight:600; letter-spacing:0.08em; text-transform:uppercase;">RC RaceMap</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td class="email-body" style="padding: 36px 40px 28px;">
            <h1 class="email-h1" style="margin:0 0 8px; font-size:22px; font-weight:700; color:#213769; line-height:1.2;">Neuigkeiten bei deinen Vereinen</h1>
            <p class="email-p" style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.6;">
              Es gibt neue Rennen oder geöffnete Nennungen bei Vereinen, denen du folgst.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${items}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td class="email-footer" style="border-top:1px solid #e5e7eb; padding:18px 40px; text-align:center; background:#ffffff;">
            <span class="email-small" style="font-size:12px; color:#9ca3af;">
              RC Race Map &nbsp;|&nbsp;
              <a href="https://rcracemap.com" style="color:#9ca3af; text-decoration:none;">rcracemap.com</a>
              &nbsp;|&nbsp;
              <a href="https://rcracemap.com?unsubscribe=1" style="color:#9ca3af; text-decoration:none;">Abmelden</a>
            </span>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// ── Main handler ───────────────────────────────────────────────────────────

serve(async (_req) => {
  // 1. Fetch all notification subscriptions
  const { data: subs, error: subsErr } = await supabase
    .from("venue_notifications")
    .select("user_id, host_id");

  if (subsErr) return new Response(subsErr.message, { status: 500 });
  if (!subs?.length) return new Response("No subscriptions", { status: 200 });


  // 2. Group host_ids per user
  const userHosts = new Map<string, Set<string>>();
  for (const s of subs) {
    if (!userHosts.has(s.user_id)) userHosts.set(s.user_id, new Set());
    userHosts.get(s.user_id)!.add(s.host_id);
  }

  // 3. Fetch races data from the public JSON (same source as frontend)
  const [racesRes, venuesRes] = await Promise.all([
    fetch("https://rcracemap.com/races.json").then(r => r.json()).catch(() => []),
    fetch("https://rcracemap.com/venues.json").then(r => r.json()).catch(() => []),
  ]);

  const races: any[] = Array.isArray(racesRes) ? racesRes : [];
  const venues: any[] = Array.isArray(venuesRes) ? venuesRes : [];
  const venueById = new Map(venues.map((v: any) => [String(v.id), v]));

  // Build a map: any hostId alias → canonical venue id
  // Venues have id + optional hostIds[] array of aliases used in races
  const hostIdToVenueId = new Map<string, string>();
  for (const v of venues) {
    const vid = String(v.id);
    hostIdToVenueId.set(vid, vid);
    for (const hid of (v.hostIds ?? [])) {
      hostIdToVenueId.set(String(hid), vid);
    }
  }

  // Only look at races in the next 60 days (races use "from" field)
  const now = new Date();
  const cutoff = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const upcomingRaces = races.filter((r: any) => {
    const d = new Date(r.from ?? r.date);
    return d >= now && d <= cutoff;
  });

  // 4. Per user: find unseen races for their subscribed hosts
  const seenPairs: { user_id: string; race_id: string; notif_type: string }[] = [];
  let emailsSent = 0;

  for (const [userId, hostIds] of userHosts) {
    const relevant = upcomingRaces.filter((r: any) => {
      const raceHostId = String(r.hostId ?? r.host_id ?? "");
      const canonicalId = hostIdToVenueId.get(raceHostId) ?? raceHostId;
      return hostIds.has(raceHostId) || hostIds.has(canonicalId);
    });
    if (!relevant.length) continue;

    // Check which (race, type) combos already seen
    const { data: seen } = await supabase
      .from("seen_race_notifications")
      .select("race_id, notif_type")
      .eq("user_id", userId);

    const seenSet = new Set((seen ?? []).map((s: any) => `${s.race_id}:${s.notif_type}`));

    const toNotify: { venueName: string; type: "new_race" | "registration_open"; raceName: string; raceDate: string; raceUrl: string; raceId: string }[] = [];

    for (const race of relevant) {
      const raceId = String(race.id);
      const venue = venueById.get(String(race.venueId ?? race.venue_id ?? ""));
      const venueName = venue?.name ?? race.organizerName ?? "";
      const raceName = race.name ?? race.title ?? "";
      const raceDate = formatDate(race.from ?? race.date);
      const raceUrl = `https://rcracemap.com?race=${raceId}`;

      if (!seenSet.has(`${raceId}:new_race`)) {
        toNotify.push({ raceId, venueName, type: "new_race", raceName, raceDate, raceUrl });
      }

      const isOpen = race.registrationStatus === "open" || race.registration_status === "open";
      if (isOpen && !seenSet.has(`${raceId}:registration_open`)) {
        toNotify.push({ raceId, venueName, type: "registration_open", raceName, raceDate, raceUrl });
      }
    }

    if (!toNotify.length) continue;

    // Fetch user email
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !user?.email) continue;

    // Send email via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "RC RaceMap <noreply@rcracemap.com>",
        to: [user.email],
        subject: `Neuigkeiten bei deinen Vereinen – RC RaceMap`,
        html: emailHtml(toNotify),
      }),
    });

    if (res.ok) {
      emailsSent++;
      // Mark as seen
      for (const n of toNotify) {
        seenPairs.push({ user_id: userId, race_id: n.raceId, notif_type: n.type });
      }
    }
  }

  // 5. Insert seen records
  if (seenPairs.length) {
    await supabase.from("seen_race_notifications").upsert(seenPairs);
  }

  return new Response(JSON.stringify({ emailsSent, seenPairs: seenPairs.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
