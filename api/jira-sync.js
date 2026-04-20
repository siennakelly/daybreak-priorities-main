// GET /api/jira-sync
// Fetches all non-Descoped DAY epics from Jira and syncs their statuses to Supabase

const JIRA_TO_PHASE = {
  'Ready for Release': 'Ready for Release',
  'QA': 'Testing',
  'In Progress': 'Development',
  'Calibration': 'Product Scoping',
  'Ready for Work': 'Requirements Ready, Not Started',
  'To Do': 'Requirements Not Ready',
  'Blocked': 'Blocked by Stakeholder',
  'Done': 'Completed',
};

const JIRA_BASE = process.env.JIRA_BASE_URL;
const AUTH = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function fetchJiraEpics() {
  let epics = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const jql = encodeURIComponent('project = DAY AND issuetype = Epic AND status != "Descoped"');
    const url = `${JIRA_BASE}/rest/api/3/search?jql=${jql}&fields=summary,status,key&maxResults=${maxResults}&startAt=${startAt}`;
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Jira search failed: ${res.status}`);
    const data = await res.json();
    epics = epics.concat(data.issues);
    if (epics.length >= data.total) break;
    startAt += maxResults;
  }
  return epics;
}

async function getSupabaseInitiatives() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?select=key,phase`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  return res.json();
}

async function updateSupabasePhase(key, phase) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?key=eq.${encodeURIComponent(key)}`, {
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ phase, updated_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`Supabase update failed for ${key}: ${res.status}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const [epics, initiatives] = await Promise.all([fetchJiraEpics(), getSupabaseInitiatives()]);

    const initiativeMap = {};
    initiatives.forEach(i => initiativeMap[i.key] = i.phase);

    const updates = [];
    const skipped = [];

    for (const epic of epics) {
      const jiraStatus = epic.fields.status.name;
      const mappedPhase = JIRA_TO_PHASE[jiraStatus];
      const currentPhase = initiativeMap[epic.key];

      // Only update if this epic exists on the board and phase differs
      if (currentPhase === undefined) {
        skipped.push({ key: epic.key, reason: 'not on board' });
        continue;
      }
      if (!mappedPhase) {
        skipped.push({ key: epic.key, reason: `no mapping for Jira status "${jiraStatus}"` });
        continue;
      }
      if (currentPhase === mappedPhase) continue;

      await updateSupabasePhase(epic.key, mappedPhase);
      updates.push({ key: epic.key, from: currentPhase, to: mappedPhase });
    }

    return res.status(200).json({ success: true, updates, skipped, totalEpics: epics.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
