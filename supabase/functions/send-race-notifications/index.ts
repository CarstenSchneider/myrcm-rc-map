import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL   = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Types ──────────────────────────────────────────────────────────────────

type Lang = "de" | "en" | "fr" | "nl";

type RaceRow = {
  venueName: string;
  raceName: string;
  raceDate: string;
  registrationStatus: string;
  registrationNote: string;
  registrationOpens: string;
  registrationUrl: string;
  announcementUrl: string;
  classes: string[];
};

type ChangeRow = RaceRow & { updateDesc: string };

type RaceChange = {
  id: string;
  venueId: string | null;
  hostId: string | null;
  hostName: string;
  from: string;
  to: string;
  name: string;
  registrationStatus: string;
  registrationOpens: string | null;
  url: string;
  documents: { url: string; type: string; label: string }[];
  changed: {
    registrationStatus?: { from: string | null; to: string | null };
    date?: { from: string; fromTo: string; to: string; toTo: string };
    name?: { from: string; to: string };
  };
};

// ── i18n ───────────────────────────────────────────────────────────────────

const i18n: Record<string, Record<Lang, string>> = {
  "subject.updates":        { de: "Updates bei deinen Vereinen – RC RaceMap",                   en: "Updates at your clubs – RC RaceMap",               fr: "Mises à jour de vos clubs – RC RaceMap",            nl: "Updates bij je clubs – RC RaceMap" },
  "subject.news_updates":   { de: "Neuigkeiten & Updates bei deinen Vereinen – RC RaceMap",     en: "News & Updates at your clubs – RC RaceMap",        fr: "Nouveautés & mises à jour de vos clubs – RC RaceMap", nl: "Nieuws & updates bij je clubs – RC RaceMap" },
  "subject.news":           { de: "Neuigkeiten bei deinen Vereinen – RC RaceMap",               en: "News from your clubs – RC RaceMap",                fr: "Nouveautés de vos clubs – RC RaceMap",              nl: "Nieuws van je clubs – RC RaceMap" },
  "heading.updates":        { de: "Updates bei deinen Vereinen",                                en: "Updates at your clubs",                            fr: "Mises à jour de vos clubs",                         nl: "Updates bij je clubs" },
  "heading.news":           { de: "Neuigkeiten bei deinen Vereinen",                            en: "News from your clubs",                             fr: "Nouveautés de vos clubs",                           nl: "Nieuws van je clubs" },
  "subtext.updates":        { de: "Es gibt Änderungen bei Rennen von Vereinen, denen du folgst.", en: "There are changes to races at clubs you follow.", fr: "Il y a des modifications pour des courses de vos clubs.", nl: "Er zijn wijzigingen bij races van clubs die je volgt." },
  "subtext.news_updates":   { de: "Es gibt neue Rennen und Updates bei Vereinen, denen du folgst.", en: "There are new races and updates at clubs you follow.", fr: "Il y a de nouvelles courses et des mises à jour de vos clubs.", nl: "Er zijn nieuwe races en updates bij clubs die je volgt." },
  "subtext.news":           { de: "Es gibt neue Rennen oder geöffnete Nennungen bei Vereinen, denen du folgst.", en: "There are new races or open registrations at clubs you follow.", fr: "Il y a de nouvelles courses ou des inscriptions ouvertes de vos clubs.", nl: "Er zijn nieuwe races of open inschrijvingen bij clubs die je volgt." },
  "section.new_races":      { de: "Neue Rennen",          en: "New Races",               fr: "Nouvelles courses",    nl: "Nieuwe races" },
  "section.updates":        { de: "Updates",              en: "Updates",                 fr: "Mises à jour",         nl: "Updates" },
  "reg.open":               { de: "Nennung ↗",            en: "Registration ↗",          fr: "Inscription ↗",        nl: "Inschrijving ↗" },
  "reg.upcoming.from":      { de: "Nennung ab {date}",    en: "Registration from {date}", fr: "Inscription dès le {date}", nl: "Inschrijving vanaf {date}" },
  "reg.upcoming.tba":       { de: "Nennung folgt",        en: "Registration coming soon", fr: "Inscription bientôt", nl: "Inschrijving volgt" },
  "reg.closed":             { de: "Nennung geschlossen",  en: "Registration closed",     fr: "Inscription fermée",   nl: "Inschrijving gesloten" },
  "doc.rules":              { de: "Ausschreibung ↗",      en: "Race rules ↗",            fr: "Règlement ↗",          nl: "Reglement ↗" },
  "doc.rules.pdf":          { de: "Ausschreibung (PDF) ↗", en: "Race rules (PDF) ↗",    fr: "Règlement (PDF) ↗",    nl: "Reglement (PDF) ↗" },
  "cta.map":                { de: "Auf der Karte ansehen", en: "View on map",            fr: "Voir sur la carte",    nl: "Bekijken op kaart" },
  "footer.unsubscribe":     { de: "Abmelden",             en: "Unsubscribe",             fr: "Se désabonner",        nl: "Afmelden" },
  "change.cancelled_deleted": { de: "Abgesagt / Gelöscht", en: "Cancelled / Deleted",   fr: "Annulé / Supprimé",    nl: "Geannuleerd / Verwijderd" },
  "change.cancelled":       { de: "Abgesagt",             en: "Cancelled",               fr: "Annulé",               nl: "Geannuleerd" },
  "change.reg_closed":      { de: "Nennung geschlossen",  en: "Registration closed",     fr: "Inscription fermée",   nl: "Inschrijving gesloten" },
  "change.new_name":        { de: "Neuer Name: ",         en: "New name: ",              fr: "Nouveau nom : ",       nl: "Nieuwe naam: " },
  "change.new_date":        { de: "Neues Datum: ",        en: "New date: ",              fr: "Nouvelle date : ",     nl: "Nieuwe datum: " },
  "change.updated":         { de: "Aktualisiert",         en: "Updated",                 fr: "Mis à jour",           nl: "Bijgewerkt" },
  "email.title":            { de: "RC RaceMap – Neuigkeiten", en: "RC RaceMap – News",  fr: "RC RaceMap – Actualités", nl: "RC RaceMap – Nieuws" },
  "unsub.page.title":       { de: "RC RaceMap – Abmelden", en: "RC RaceMap – Unsubscribe", fr: "RC RaceMap – Désabonnement", nl: "RC RaceMap – Afmelden" },
  "unsub.ok.heading":       { de: "Abgemeldet",           en: "Unsubscribed",            fr: "Désabonné(e)",         nl: "Afgemeld" },
  "unsub.ok.text":          { de: "Du erhältst keine E-Mail-Benachrichtigungen mehr von RC RaceMap.<br>Du kannst sie jederzeit wieder aktivieren.", en: "You will no longer receive email notifications from RC RaceMap.<br>You can re-enable them at any time.", fr: "Vous ne recevrez plus de notifications par e-mail de RC RaceMap.<br>Vous pouvez les réactiver à tout moment.", nl: "Je ontvangt geen e-mailmeldingen meer van RC RaceMap.<br>Je kunt ze altijd opnieuw inschakelen." },
  "unsub.err.heading":      { de: "Fehler",               en: "Error",                   fr: "Erreur",               nl: "Fout" },
  "unsub.err.text":         { de: "Der Abmelde-Link ist ungültig oder bereits verwendet.", en: "The unsubscribe link is invalid or already used.", fr: "Le lien de désabonnement est invalide ou déjà utilisé.", nl: "De afmeldlink is ongeldig of al gebruikt." },
  "unsub.cta":              { de: "Zur Karte",            en: "View map",                fr: "Voir la carte",        nl: "Bekijk kaart" },
};

function tr(key: string, lang: Lang, vars?: Record<string, string>): string {
  let str = i18n[key]?.[lang] ?? i18n[key]?.["en"] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) str = str.replace(`{${k}}`, v);
  return str;
}

const DATE_LOCALE: Record<Lang, string> = { de: "de-DE", en: "en-GB", fr: "fr-FR", nl: "nl-NL" };

// ── Helpers ────────────────────────────────────────────────────────────────

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  return d.toLocaleDateString(DATE_LOCALE[lang], { day: "2-digit", month: "2-digit", year: "numeric" });
}

function formatDateRange(from: string, to: string | undefined, lang: Lang): string {
  if (!to || to === from) return formatDate(from, lang);
  const f = new Date(from);
  const toDate = new Date(to);
  const fd = f.toLocaleDateString(DATE_LOCALE[lang], { day: "2-digit", month: "2-digit" });
  const td = toDate.toLocaleDateString(DATE_LOCALE[lang], { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${fd} – ${td}`;
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

function changeNotifType(change: RaceChange): string {
  if (change.registrationStatus === "deleted") return "race_deleted";
  const key = JSON.stringify(
    Object.fromEntries(Object.entries(change.changed).map(([k, v]) => [k, (v as any).to]))
  );
  return `race_updated_${simpleHash(key)}`;
}

function changeDescription(change: RaceChange, lang: Lang): string {
  if (change.registrationStatus === "deleted") return tr("change.cancelled_deleted", lang);

  const parts: string[] = [];
  const isCancelled = change.name.toLowerCase().includes("abgesagt");

  if (isCancelled) {
    parts.push(tr("change.cancelled", lang));
  } else {
    if (change.changed.registrationStatus?.to === "closed") parts.push(tr("change.reg_closed", lang));
    if (change.changed.name) parts.push(`${tr("change.new_name", lang)}${change.name}`);
  }

  if (change.changed.date) {
    const { to, toTo } = change.changed.date;
    parts.push(`${tr("change.new_date", lang)}${formatDateRange(to, toTo, lang)}`);
  }

  return parts.join(" · ") || tr("change.updated", lang);
}

// ── Email template ─────────────────────────────────────────────────────────

function emailHtml(rows: RaceRow[], userId: string, lang: Lang, changeRows: ChangeRow[] = []): string {
  const unsubscribeUrl = `https://rcracemap.com?unsubscribe=${encodeURIComponent(userId)}&lang=${lang}`;

  const seen = new Set<string>();
  const uniqueRows = rows.filter(r => {
    const key = r.raceName + r.raceDate + r.venueName;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const hasNew = uniqueRows.length > 0;
  const hasChanges = changeRows.length > 0;

  const dotStyle = (color: string) =>
    `display:inline-block;width:7px;height:7px;border-radius:50%;background:${color};margin-right:5px;vertical-align:middle;`;

  const renderRaceItem = (r: RaceRow) => {
    let regLine = "";
    if (r.registrationStatus === "open" && r.registrationUrl) {
      regLine = `<a class="item-reg" href="${r.registrationUrl}" style="color:#6b7280; text-decoration:none; font-size:13px; font-weight:400;"><span style="${dotStyle("#22c55e")}"></span>${tr("reg.open", lang)}</a>`;
    } else if (r.registrationStatus === "upcoming") {
      const note = r.registrationNote || (r.registrationOpens ? tr("reg.upcoming.from", lang, { date: r.registrationOpens }) : tr("reg.upcoming.tba", lang));
      regLine = `<span style="font-size:13px; font-weight:700; color:#4A9EE8;"><span style="${dotStyle("#4A9EE8")}"></span>${escHtml(note)}</span>`;
    } else if (r.registrationStatus === "closed") {
      regLine = `<span style="font-size:13px; color:#9ca3af;"><span style="${dotStyle("#9ca3af")}"></span>${tr("reg.closed", lang)}</span>`;
    }

    const announcementLabel = r.announcementUrl?.toLowerCase().endsWith(".pdf")
      ? tr("doc.rules.pdf", lang)
      : tr("doc.rules", lang);
    const announcementLink = r.announcementUrl
      ? ` &nbsp;·&nbsp; <a href="${r.announcementUrl}" style="color:#6b7280; font-size:13px; text-decoration:none;">${announcementLabel}</a>`
      : "";

    const classTags = r.classes.length
      ? `<div style="margin-top:6px;">${r.classes.map(c => `<span class="item-pill" style="display:inline-block;background:#f3f4f6;color:#6b7280;font-size:11px;padding:2px 8px;border-radius:999px;margin:2px 2px 0 0;">${escHtml(c)}</span>`).join("")}</div>`
      : "";

    return `
      <tr>
        <td class="item-sep" style="padding: 14px 0; border-bottom: 1px solid #e5e7eb;">
          <div style="font-size:14px; font-weight:400; color:#6b7280; margin-bottom:2px;">${escHtml(r.raceDate)}</div>
          <div style="font-size:14px; font-weight:400; color:#6b7280; margin-bottom:2px;">${escHtml(r.venueName)}</div>
          <div class="item-title" style="font-size:15px; font-weight:700; color:#213769; margin-bottom:6px;">${escHtml(r.raceName)}</div>
          ${regLine || announcementLink ? `<div style="margin-bottom:4px;">${regLine}${announcementLink}</div>` : ""}
          ${classTags}
        </td>
      </tr>`;
  };

  const renderChangeItem = (r: ChangeRow) => {
    const announcementUrl = (r as any)._announcementUrl ?? "";
    const announcementLabel = announcementUrl?.toLowerCase().endsWith(".pdf")
      ? tr("doc.rules.pdf", lang)
      : tr("doc.rules", lang);
    const announcementLink = announcementUrl
      ? ` &nbsp;·&nbsp; <a href="${announcementUrl}" style="color:#6b7280; font-size:13px; text-decoration:none;">${announcementLabel}</a>`
      : "";

    let regLine = "";
    if (r.registrationStatus === "open" && r.registrationUrl) {
      regLine = `<a class="item-reg" href="${r.registrationUrl}" style="color:#6b7280; text-decoration:none; font-size:13px; font-weight:400;"><span style="${dotStyle("#22c55e")}"></span>${tr("reg.open", lang)}</a>`;
    } else if (r.registrationStatus === "upcoming") {
      const note = r.registrationNote || (r.registrationOpens ? tr("reg.upcoming.from", lang, { date: r.registrationOpens }) : tr("reg.upcoming.tba", lang));
      regLine = `<span style="font-size:13px; font-weight:700; color:#4A9EE8;"><span style="${dotStyle("#4A9EE8")}"></span>${escHtml(note)}</span>`;
    } else if (r.registrationStatus === "closed") {
      regLine = `<span style="font-size:13px; color:#9ca3af;"><span style="${dotStyle("#9ca3af")}"></span>${tr("reg.closed", lang)}</span>`;
    }

    const classTags = r.classes.length
      ? `<div style="margin-top:6px;">${r.classes.map(c => `<span class="item-pill" style="display:inline-block;background:#f3f4f6;color:#6b7280;font-size:11px;padding:2px 8px;border-radius:999px;margin:2px 2px 0 0;">${escHtml(c)}</span>`).join("")}</div>`
      : "";

    const isDeleted = r.registrationStatus === "deleted";
    const titleStyle = isDeleted
      ? "font-size:15px; font-weight:700; color:#9ca3af; text-decoration:line-through; margin-bottom:6px;"
      : "font-size:15px; font-weight:700; color:#213769; margin-bottom:6px;";

    return `
      <tr>
        <td class="item-sep" style="padding: 14px 0; border-bottom: 1px solid #e5e7eb;">
          <div style="font-size:11px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:#9ca3af; margin-bottom:6px;">${escHtml(r.updateDesc)}</div>
          <div style="font-size:14px; font-weight:400; color:#6b7280; margin-bottom:2px;">${escHtml(r.raceDate)}</div>
          <div style="font-size:14px; font-weight:400; color:#6b7280; margin-bottom:2px;">${escHtml(r.venueName)}</div>
          <div class="item-title" style="${titleStyle}">${escHtml(r.raceName)}</div>
          ${!isDeleted && (regLine || announcementLink) ? `<div style="margin-bottom:4px;">${regLine}${announcementLink}</div>` : ""}
          ${classTags}
        </td>
      </tr>`;
  };

  const sectionLabel = (text: string) =>
    `<tr><td style="padding: 20px 0 4px; font-size:11px; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#9ca3af; border-bottom: 2px solid #e5e7eb;">${text}</td></tr>`;

  const newItems = uniqueRows.map(renderRaceItem).join("");
  const changeItems = changeRows.map(renderChangeItem).join("");

  const heading = !hasNew && hasChanges
    ? tr("heading.updates", lang)
    : tr("heading.news", lang);

  const subtext = !hasNew && hasChanges
    ? tr("subtext.updates", lang)
    : hasNew && hasChanges
    ? tr("subtext.news_updates", lang)
    : tr("subtext.news", lang);

  const tableContent = `
    ${hasNew ? `${hasChanges ? sectionLabel(tr("section.new_races", lang)) : ""}${newItems}` : ""}
    ${hasChanges ? `${sectionLabel(tr("section.updates", lang))}${changeItems}` : ""}
  `;

  return `<!DOCTYPE html>
<html lang="${lang}" style="color-scheme: light dark;">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${tr("email.title", lang)}</title>
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
    .item-sep     { border-bottom-color: #1e2f50 !important; }
    .item-pill    { background: #1e2f50 !important; color: #8a9bb8 !important; }
    .item-reg     { color: #8a9bb8 !important; }
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
            <h1 class="email-h1" style="margin:0 0 8px; font-size:22px; font-weight:700; color:#213769; line-height:1.2;">${heading}</h1>
            <p class="email-p" style="margin:0 0 24px; font-size:15px; color:#374151; line-height:1.6;">${subtext}</p>
            <table width="100%" cellpadding="0" cellspacing="0">
              ${tableContent}
            </table>
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td align="center" style="padding: 28px 0 8px;">
                  <a href="https://rcracemap.com" style="display:inline-block; background:#213769; color:#ffffff; text-decoration:none; font-size:14px; font-weight:600; padding:12px 32px; border-radius:999px;">${tr("cta.map", lang)}</a>
                </td>
              </tr>
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
              <a href="${unsubscribeUrl}" style="color:#9ca3af; text-decoration:none;">${tr("footer.unsubscribe", lang)}</a>
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

// ── Unsubscribe page ───────────────────────────────────────────────────────

function unsubscribeHtml(ok: boolean, lang: Lang): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${tr("unsub.page.title", lang)}</title>
<style>
  body { margin:0; background:#f0f2f5; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; display:flex; align-items:center; justify-content:center; min-height:100vh; }
  .card { background:#fff; border-radius:12px; padding:48px 40px; max-width:400px; text-align:center; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  .logo { margin-bottom:24px; }
  h1 { color:#213769; font-size:20px; margin:0 0 12px; }
  p { color:#6b7280; font-size:14px; line-height:1.6; margin:0 0 24px; }
  a { display:inline-block; background:#213769; color:#fff; text-decoration:none; font-size:14px; font-weight:600; padding:10px 28px; border-radius:999px; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg width="36" height="40" viewBox="0 0 477 528.98" xmlns="http://www.w3.org/2000/svg">
      <g fill="#C8B090">
        <path d="M249.52,205.37v66.26c22.09-2.98,44.17-5.96,66.26-6.71v-66.26c-22.09.75-44.17,3.73-66.26,6.71Z"/>
        <path d="M477,238.5C477,106.78,370.22,0,238.5,0S0,106.78,0,238.5c0,111.19,76.09,204.61,179.04,231.03l59.46,59.46,59.46-59.46c102.95-26.42,179.04-119.84,179.04-231.03ZM382.05,271.63c-22.09-5.96-44.17-7.45-66.26-6.71v66.26c-22.09.75-44.17,3.73-66.26,6.71v-66.26c-22.09,2.98-44.17,5.96-66.26,6.71v66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v-66.26c-22.09.75-44.17-.75-66.26-6.71v-66.26c22.09,5.96,44.17,7.45,66.26,6.71v66.26c22.09-.75,44.17-3.73,66.26-6.71v-66.26c22.09-2.98,44.17-5.96,66.26-6.71v66.26c22.09-.75,44.17.75,66.26,6.71v66.26Z"/>
      </g>
    </svg>
  </div>
  ${ok
    ? `<h1>${tr("unsub.ok.heading", lang)}</h1><p>${tr("unsub.ok.text", lang)}</p>`
    : `<h1>${tr("unsub.err.heading", lang)}</h1><p>${tr("unsub.err.text", lang)}</p>`
  }
  <a href="https://rcracemap.com">${tr("unsub.cta", lang)}</a>
</div>
</body></html>`;
}

// ── Main handler ───────────────────────────────────────────────────────────

serve(async (req) => {
  // Handle unsubscribe via GET
  const url = new URL(req.url);
  const userId = url.searchParams.get("unsubscribe");
  if (userId) {
    const rawLang = url.searchParams.get("lang") ?? "de";
    const lang: Lang = (["de", "en", "fr", "nl"].includes(rawLang) ? rawLang : "de") as Lang;
    const { error } = await supabase.from("venue_notifications").delete().eq("user_id", userId);
    return new Response(unsubscribeHtml(!error, lang), {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" },
    });
  }

  // Parse incoming race changes from POST body
  let incomingChanges: RaceChange[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.changes)) incomingChanges = body.changes;
  } catch { /* no body or not JSON */ }

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

  // 3. Fetch user language preferences
  const userIds = [...userHosts.keys()];
  const { data: prefRows } = await supabase
    .from("user_preferences")
    .select("user_id, lang")
    .in("user_id", userIds);
  const userLang = new Map<string, Lang>(
    (prefRows ?? [])
      .filter((p: any) => ["de", "en", "fr", "nl"].includes(p.lang))
      .map((p: any) => [p.user_id, p.lang as Lang])
  );

  // 4. Fetch races data from the public JSON (same source as frontend)
  const [racesRes, venuesRes, rckRacesRes] = await Promise.all([
    fetch("https://rcracemap.com/races.json").then(r => r.json()).catch(() => []),
    fetch("https://rcracemap.com/venues.json").then(r => r.json()).catch(() => []),
    fetch("https://rcracemap.com/rck-races.json").then(r => r.json()).catch(() => []),
  ]);

  const races: any[] = [
    ...(Array.isArray(racesRes) ? racesRes : []),
    ...(Array.isArray(rckRacesRes) ? rckRacesRes : []),
  ];
  const venues: any[] = Array.isArray(venuesRes) ? venuesRes : [];
  const venueById = new Map(venues.map((v: any) => [String(v.id), v]));

  const hostIdToVenueId = new Map<string, string>();
  for (const v of venues) {
    const vid = String(v.id);
    hostIdToVenueId.set(vid, vid);
    for (const hid of (v.hostIds ?? [])) hostIdToVenueId.set(String(hid), vid);
  }

  // Only look at races in the next 60 days
  const now = new Date();
  const cutoff = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const upcomingRaces = races
    .filter((r: any) => {
      const d = new Date(r.from ?? r.date);
      return d >= now && d <= cutoff;
    })
    .sort((a: any, b: any) => {
      const da = a.from ?? a.date ?? "";
      const db = b.from ?? b.date ?? "";
      return da < db ? -1 : da > db ? 1 : 0;
    });

  // Filter incoming changes to the same 60-day window
  const upcomingChanges = incomingChanges.filter(c => {
    const d = new Date(c.from);
    return d >= now && d <= cutoff;
  });

  // 5. Per user: find unseen new races and relevant changes
  const seenPairs: { user_id: string; race_id: string; notif_type: string }[] = [];
  let emailsSent = 0;

  for (const [userId, hostIds] of userHosts) {
    const lang = userLang.get(userId) ?? "de";

    // New/open races for this user
    const relevant = upcomingRaces.filter((r: any) => {
      const raceHostId = String(r.hostId ?? r.host_id ?? "");
      const canonicalId = hostIdToVenueId.get(raceHostId) ?? raceHostId;
      return hostIds.has(raceHostId) || hostIds.has(canonicalId);
    });

    // Changes for this user
    const relevantChanges = upcomingChanges.filter(c => {
      const hostId = String(c.hostId ?? "");
      const venueId = String(c.venueId ?? "");
      const canonicalId = hostIdToVenueId.get(hostId) ?? hostId;
      const canonicalVenue = hostIdToVenueId.get(venueId) ?? venueId;
      return hostIds.has(hostId) || hostIds.has(canonicalId) ||
             hostIds.has(venueId) || hostIds.has(canonicalVenue);
    });

    if (!relevant.length && !relevantChanges.length) continue;

    // Check seen notifications
    const { data: seen } = await supabase
      .from("seen_race_notifications")
      .select("race_id, notif_type")
      .eq("user_id", userId);

    const seenSet = new Set((seen ?? []).map((s: any) => `${s.race_id}:${s.notif_type}`));

    const toNotify: RaceRow[] = [];
    const toMark: { raceId: string; notif_type: string }[] = [];

    // Process new/open races
    for (const race of relevant) {
      const raceId = String(race.id);
      const isNewRace = !seenSet.has(`${raceId}:new_race`);
      const isOpen = race.registrationStatus === "open" || race.registration_status === "open";
      const isNewOpen = isOpen && !seenSet.has(`${raceId}:registration_open`);

      if (!isNewRace && !isNewOpen) continue;

      const venue = venueById.get(String(race.venueId ?? race.venue_id ?? ""));
      const venueName = venue?.name ?? race.venueName ?? race.hostName ?? race.organizerName ?? "";
      const raceName = race.name ?? race.title ?? "";
      const raceDate = formatDateRange(race.from ?? race.date, race.to, lang);
      const classes = (race.classes ?? []).map((c: any) => typeof c === "string" ? c : c?.name ?? "").filter(Boolean);

      toNotify.push({
        venueName, raceName, raceDate,
        registrationStatus: race.registrationStatus ?? race.registration_status ?? "",
        registrationNote: race.note ?? "",
        registrationOpens: race.registrationOpens ? formatDate(race.registrationOpens, lang) : "",
        registrationUrl: race.url ?? "",
        announcementUrl: (race.documents ?? []).find((d: any) => d?.url)?.url ?? "",
        classes,
      });

      if (isNewRace) toMark.push({ raceId, notif_type: "new_race" });
      if (isNewOpen) toMark.push({ raceId, notif_type: "registration_open" });
    }

    // Process changes
    const toNotifyChanges: ChangeRow[] = [];
    for (const change of relevantChanges) {
      const notifType = changeNotifType(change);
      if (seenSet.has(`${change.id}:${notifType}`)) continue;

      const venue = venueById.get(String(change.venueId ?? ""));
      const venueName = venue?.name ?? change.hostName ?? "";
      const raceDate = formatDateRange(change.from, change.to, lang);
      const announcementUrl = change.documents?.find(d => d?.url)?.url ?? "";

      const row: ChangeRow & { _announcementUrl?: string } = {
        venueName,
        raceName: change.name,
        raceDate,
        registrationStatus: change.registrationStatus,
        registrationNote: "",
        registrationOpens: change.registrationOpens ? formatDate(change.registrationOpens, lang) : "",
        registrationUrl: change.url ?? "",
        announcementUrl,
        classes: [],
        updateDesc: changeDescription(change, lang),
        _announcementUrl: announcementUrl,
      };

      toNotifyChanges.push(row);
      toMark.push({ raceId: change.id, notif_type: notifType });
    }

    if (!toNotify.length && !toNotifyChanges.length) continue;

    // Fetch user email
    const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(userId);
    if (userErr || !user?.email) continue;

    // Determine subject
    const hasNew = toNotify.length > 0;
    const hasChanges = toNotifyChanges.length > 0;
    const subject = !hasNew && hasChanges
      ? tr("subject.updates", lang)
      : hasNew && hasChanges
      ? tr("subject.news_updates", lang)
      : tr("subject.news", lang);

    // Send email via Resend
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "RC RaceMap <noreply@rcracemap.com>",
        to: [user.email],
        subject,
        html: emailHtml(toNotify, userId, lang, toNotifyChanges),
      }),
    });

    if (res.ok) {
      emailsSent++;
      for (const { raceId, notif_type } of toMark) {
        seenPairs.push({ user_id: userId, race_id: raceId, notif_type });
      }
    }
  }

  // 6. Insert seen records
  if (seenPairs.length) {
    await supabase.from("seen_race_notifications").upsert(seenPairs);
  }

  return new Response(JSON.stringify({ emailsSent, seenPairs: seenPairs.length, changes: incomingChanges.length }), {
    headers: { "Content-Type": "application/json" },
  });
});
