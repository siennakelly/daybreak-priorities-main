// GET /api/jira-sync
// Looks up each board initiative in Jira individually

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
    // Fetch all board initiatives
    const sRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?select=key,phase`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    if (!sRes.ok) throw new Error(`Supabase fetch failed: ${sRes.status}`);
    const initiatives = await sRes.json();

    const updates = [], skipped = [], errors = [];

    // Look up each initiative in Jira individually
    for (const initiative of initiatives) {
      const key = initiative.key;
      // Only process real Jira keys
      if (!/^[A-Z]+-\d+$/.test(key)) continue;

      try {
        const r = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}?fields=status`, {
          headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
        });

        if (r.status === 404) { skipped.push({ key, reason: 'not found in Jira' }); continue; }
        if (!r.ok) { errors.push({ key, reason: `Jira error ${r.status}` }); continue; }

        const d = await r.json();
        const jiraStatus = d.fields.status.name;
        const mappedPhase = JIRA_TO_PHASE[jiraStatus];

        if (!mappedPhase) { skipped.push({ key, reason: `no mapping for "${jiraStatus}"` }); continue; }
        if (initiative.phase === mappedPhase) continue;

        // Update Supabase
        const uRes = await fetch(`${SUPABASE_URL}/rest/v1/initiatives?key=eq.${encodeURIComponent(key)}`, {
          method: 'PATCH',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ phase: mappedPhase, updated_at: new Date().toISOString() }),
        });
        if (!uRes.ok) { errors.push({ key, reason: `Supabase update failed: ${uRes.status}` }); continue; }
        updates.push({ key, from: initiative.phase, to: mappedPhase });

      } catch (e) {
        errors.push({ key, reason: e.message });
      }
    }

    return res.status(200).json({ success: true, updates, skipped, errors, total: initiatives.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
