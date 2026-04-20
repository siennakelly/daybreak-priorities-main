// POST /api/jira-transition

const PHASE_TO_JIRA = {
  'Ready for Release': 'Ready for Release',
  'Testing': 'QA',
  'Development': 'In Progress',
  'Product Scoping': 'Calibration',
  'Requirements Ready, Not Started': 'Ready for Work',
  'Requirements Not Ready': 'To Do',
  'Blocked by Stakeholder': 'Blocked',
  'Completed': 'Done',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { key, phase } = req.body || {};
  if (!key || !phase) return res.status(400).json({ error: 'Missing key or phase' });

  const targetStatus = PHASE_TO_JIRA[phase];
  if (!targetStatus) return res.status(400).json({ error: `No Jira mapping for phase: ${phase}` });

  const JIRA_BASE = process.env.JIRA_BASE_URL;
  const AUTH = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');

  try {
    const tRes = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}/transitions`, {
      headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
    });
    if (!tRes.ok) {
      const txt = await tRes.text();
      return res.status(tRes.status).json({ error: `Jira transitions fetch failed: ${txt}` });
    }
    const tData = await tRes.json();
    const match = tData.transitions.find(t => t.name.toLowerCase() === targetStatus.toLowerCase());
    if (!match) {
      return res.status(404).json({ error: `No transition to "${targetStatus}" on ${key}. Options: ${tData.transitions.map(t=>t.name).join(', ')}` });
    }

    const doRes = await fetch(`${JIRA_BASE}/rest/api/3/issue/${key}/transitions`, {
      method: 'POST',
      headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    if (!doRes.ok) {
      const txt = await doRes.text();
      return res.status(doRes.status).json({ error: `Transition failed: ${txt}` });
    }

    return res.status(200).json({ success: true, key, status: targetStatus });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
