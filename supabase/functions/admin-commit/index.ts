import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function fromBase64(b64: string): any {
  const bytes = Uint8Array.from(atob(b64.replace(/\n/g, "")), c => c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function toBase64(data: any[]): string {
  const text = JSON.stringify(data, null, 2) + "\n";
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const ADMIN_EMAILS = ["carsten@lessrain.com", "carsten@lessrain.net"];
const REPO = "CarstenSchneider/myrcm-rc-map";
const SEEDS_PATH = "venue-seeds.json";
const UNMATCHED_PATH = "venue-unmatched.json";
// Always write to both branches so admin data survives rebases and import-bot pushes
const TARGET_BRANCHES = ["main", "dev"];

interface FileState { sha: string; data: any[] }

async function fetchFile(path: string, branch: string, gh: Record<string, string>): Promise<FileState | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=${branch}`, { headers: gh });
  if (!res.ok) return null;
  const meta = await res.json();
  return { sha: meta.sha, data: fromBase64(meta.content) };
}

async function putFile(path: string, data: any[], message: string, branch: string, sha: string, gh: Record<string, string>): Promise<{ ok: boolean; text: string }> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: gh,
    body: JSON.stringify({ message, content: toBase64(data), sha, branch }),
  });
  return { ok: res.ok, text: res.ok ? "" : await res.text() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS });

    const sbAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401, headers: CORS });
    if (!ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "")) return new Response("Forbidden", { status: 403, headers: CORS });

    const githubPat = Deno.env.get("GITHUB_PAT");
    if (!githubPat) return new Response("GITHUB_PAT not configured", { status: 500, headers: CORS });

    const body = await req.json();
    const { action, hostId, hostName, myrcmOrgId, lat, lng, seedId, seedName, venueId } = body;

    const gh: Record<string, string> = {
      "Authorization": `Bearer ${githubPat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    for (const branch of TARGET_BRANCHES) {
      const seedsState = await fetchFile(SEEDS_PATH, branch, gh);
      if (!seedsState) continue;
      const seeds = seedsState.data;

      if (action === "verify-dach-seed") {
        const idx = seeds.findIndex((s: any) => s.id === seedId);
        if (idx < 0) continue;
        if (body.locationUnknown === true) {
          const { lat: _a, lng: _b, ...rest } = seeds[idx];
          seeds[idx] = { ...rest, locationUnknown: true, source: "verified" };
        } else {
          const { locationUnknown: _lu, ...rest } = seeds[idx];
          seeds[idx] = { ...rest, lat, lng, source: "verified" };
        }
        seeds.sort((a: any, b: any) => (a.name ?? a.hostName ?? "").localeCompare(b.name ?? b.hostName ?? "", "de"));
        await putFile(SEEDS_PATH, seeds, `admin: verify coords for ${seedName}`, branch, seedsState.sha, gh);
        continue;
      }

      if (action === "delete-dach-seed") {
        // Find by id or hostId (locationUnknown entries added via mark-unknown use hostId)
        const idx = seeds.findIndex((s: any) => s.id === seedId || s.hostId === seedId);
        if (idx < 0) continue;
        seeds.splice(idx, 1);
        await putFile(SEEDS_PATH, seeds, `admin: delete seed ${seedName || seedId}`, branch, seedsState.sha, gh);
        continue;
      }

      if (action === "link-to-venue") {
        const idx = seeds.findIndex((s: any) => (s.id || s.hostId) === venueId);
        if (idx < 0) {
          return new Response(`Venue not found: ${venueId}`, { status: 404, headers: CORS });
        }
        const seed = seeds[idx];
        const existingHostIds: string[] = Array.isArray(seed.hostIds) ? seed.hostIds : [];
        if (!existingHostIds.includes(hostId)) {
          seeds[idx] = { ...seed, hostIds: [...existingHostIds, hostId] };
          await putFile(SEEDS_PATH, seeds, `admin: link ${hostName} → ${venueId}`, branch, seedsState.sha, gh);
        }
        const unmatchedState = await fetchFile(UNMATCHED_PATH, branch, gh);
        if (unmatchedState) {
          const newUnmatched = unmatchedState.data.filter((u: any) => u.hostId !== hostId);
          await putFile(UNMATCHED_PATH, newUnmatched, `admin: remove ${hostName} from unmatched`, branch, unmatchedState.sha, gh);
        }
        continue;
      }

      if (action === "delete-unmatched") {
        const unmatchedState = await fetchFile(UNMATCHED_PATH, branch, gh);
        if (unmatchedState) {
          const newUnmatched = unmatchedState.data.filter((u: any) => u.hostId !== hostId);
          await putFile(UNMATCHED_PATH, newUnmatched, `admin: delete ${hostName} from unmatched`, branch, unmatchedState.sha, gh);
        }
        continue;
      }

      // add-venue or mark-unknown
      let newEntry: Record<string, any>;
      if (action === "add-venue") {
        newEntry = { hostId, hostName, lat, lng };
        if (myrcmOrgId) newEntry.myrcmOrgId = myrcmOrgId;
      } else if (action === "mark-unknown") {
        newEntry = { hostId, hostName, locationUnknown: true };
        if (myrcmOrgId) newEntry.myrcmOrgId = myrcmOrgId;
      } else {
        return new Response("Unknown action", { status: 400, headers: CORS });
      }

      const existingIdx = seeds.findIndex((s: any) => s.hostId === hostId);
      if (existingIdx >= 0) seeds[existingIdx] = { ...seeds[existingIdx], ...newEntry };
      else seeds.push(newEntry);
      seeds.sort((a: any, b: any) => (a.hostName ?? "").localeCompare(b.hostName ?? "", "de"));

      const seedsRes = await putFile(SEEDS_PATH, seeds, `admin: ${action} for ${hostName}`, branch, seedsState.sha, gh);
      if (!seedsRes.ok) return new Response(`GitHub seeds commit failed on ${branch}: ${seedsRes.text}`, { status: 409, headers: CORS });

      const unmatchedState = await fetchFile(UNMATCHED_PATH, branch, gh);
      if (unmatchedState) {
        const newUnmatched = unmatchedState.data.filter((u: any) => u.hostId !== hostId);
        const unmatchedRes = await putFile(UNMATCHED_PATH, newUnmatched, `admin: remove ${hostName} from unmatched`, branch, unmatchedState.sha, gh);
        if (!unmatchedRes.ok) return new Response(`GitHub unmatched commit failed on ${branch}: ${unmatchedRes.text}`, { status: 409, headers: CORS });
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500, headers: CORS });
  }
});
