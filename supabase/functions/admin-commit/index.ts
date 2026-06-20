import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const ADMIN_EMAILS = ["carsten@lessrain.com", "carsten@lessrain.net"];
const REPO = "CarstenSchneider/myrcm-rc-map";
const SEEDS_PATH = "venue-seeds.json";
const UNMATCHED_PATH = "venue-unmatched.json";
const BRANCH = "main";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    // Verify user is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Unauthorized", { status: 401, headers: CORS });

    const sbAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await sbAdmin.auth.getUser(token);
    if (authErr || !user) return new Response("Unauthorized", { status: 401, headers: CORS });
    if (!ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? "")) {
      return new Response("Forbidden", { status: 403, headers: CORS });
    }

    const githubPat = Deno.env.get("GITHUB_PAT");
    if (!githubPat) return new Response("GITHUB_PAT not configured", { status: 500, headers: CORS });

    const body = await req.json();
    const { action, hostId, hostName, myrcmOrgId, lat, lng } = body;

    const ghHeaders = {
      "Authorization": `Bearer ${githubPat}`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    };

    // Fetch current venue-seeds.json
    const seedsRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${SEEDS_PATH}?ref=${BRANCH}`, { headers: ghHeaders });
    const seedsMeta = await seedsRes.json();
    const seedsSha = seedsMeta.sha;
    const seeds: any[] = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(seedsMeta.content.replace(/\n/g, "")), c => c.charCodeAt(0))));

    // Fetch current venue-unmatched.json
    const unmatchedRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${UNMATCHED_PATH}?ref=${BRANCH}`, { headers: ghHeaders });
    const unmatchedMeta = await unmatchedRes.json();
    const unmatchedSha = unmatchedMeta.sha;
    const unmatched: any[] = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(unmatchedMeta.content.replace(/\n/g, "")), c => c.charCodeAt(0))));

    // Build new seed entry
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

    // Add to seeds (deduplicate by hostId)
    const existingIdx = seeds.findIndex((s: any) => s.hostId === hostId);
    if (existingIdx >= 0) seeds[existingIdx] = { ...seeds[existingIdx], ...newEntry };
    else seeds.push(newEntry);
    seeds.sort((a: any, b: any) => (a.hostName ?? "").localeCompare(b.hostName ?? "", "de"));

    // Remove from unmatched
    const newUnmatched = unmatched.filter((u: any) => u.hostId !== hostId);

    // Commit seeds
    const seedsContent = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(seeds, null, 2) + "\n")));
    await fetch(`https://api.github.com/repos/${REPO}/contents/${SEEDS_PATH}`, {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify({ message: `admin: ${action} for ${hostName}`, content: seedsContent, sha: seedsSha, branch: BRANCH }),
    });

    // Commit unmatched
    const unmatchedContent = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(newUnmatched, null, 2) + "\n")));
    await fetch(`https://api.github.com/repos/${REPO}/contents/${UNMATCHED_PATH}`, {
      method: "PUT",
      headers: ghHeaders,
      body: JSON.stringify({ message: `admin: remove ${hostName} from unmatched`, content: unmatchedContent, sha: unmatchedSha, branch: BRANCH }),
    });

    return new Response(JSON.stringify({ ok: true }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(String(e), { status: 500, headers: CORS });
  }
});
