// GET /api/jira-sync

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

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const JIRA_BASE = process.env.JIRA_BASE_URL;
  const AUTH = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  try {
    // Use GET with URL params instead of POST body
    let epics = [];
    let nextPageToken = null;

    do {
      const jql = encodeURIComponent('project = DAY AND issuetype = Epic AND status != "Descoped"');
      let url = `${JIRA_BASE}/rest/api/3/search/jql?jql=${jql}&fields=summary,status,key&maxResults=100`;
      if (nextPageToken) url += `&nextPageToken=${encodeURIComponent(nextPageToken)}`;

      const r = await fetch(url, {
        headers: {
          Authorization: `Basic ${AUTH}`,
          Accept: 'application/json',
        },
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(`Jira search failed: ${t}`);
      }

      const d = await r.json();
      epics = epics.concat(d.issues || []);
      nextPageToken = d.nextPageToken || null;
    } while (nextPageToken);

    // Fetch Supabase initiatives
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?select=key,phase`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!sRes.ok) throw new Error(`Supabase fetch failed: ${sRes.status}`);
    const initiatives = await sRes.json();
    const boardMap = {};
    initiatives.forEach(i => boardMap[i.key] = i.phase);

    const updates = [], skipped = [];
    for (const epic of epics) {
      const jiraStatus = epic.fields.status.name;
      const mappedPhase = JIRA_TO_PHASE[jiraStatus];
      const currentPhase = boardMap[epic.key];
      if (currentPhase === undefined) { skipped.push({ key: epic.key, reason: 'not on board' }); continue; }
      if (!mappedPhase) { skipped.push({ key: epic.key, reason: `no mapping for "${jiraStatus}"` }); continue; }
      if (currentPhase === mappedPhase) continue;

      const uRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?key=eq.${encodeURIComponent(epic.key)}`, {
        method: 'PATCH',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({ phase: mappedPhase, updated_at: new Date().toISOString() }),
      });
      if (!uRes.ok) { skipped.push({ key: epic.key, reason: `Supabase update failed: ${uRes.status}` }); continue; }
      updates.push({ key: epic.key, from: currentPhase, to: mappedPhase });
    }

    return res.status(200).json({ success: true, updates, skipped, totalEpics: epics.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
