// POST /api/jira-transition
// Body: { key: "DAY-1234", phase: "Testing" }
// Transitions a Jira epic to the mapped status

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

const JIRA_BASE = process.env.JIRA_BASE_URL;
const AUTH = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString('base64');

async function getTransitions(issueKey) {
  const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`, {
    headers: { Authorization: `Basic ${AUTH}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Failed to get transitions: ${res.status}`);
  const data = await res.json();
  return data.transitions;
}

async function doTransition(issueKey, transitionId) {
  const res = await fetch(`${JIRA_BASE}/rest/api/3/issue/${issueKey}/transitions`, {
    method: 'POST',
    headers: { Authorization: `Basic ${AUTH}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: transitionId } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Transition failed: ${res.status} ${text}`);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { key, phase } = req.body;
  if (!key || !phase) return res.status(400).json({ error: 'Missing key or phase' });

  const targetStatus = PHASE_TO_JIRA[phase];
  if (!targetStatus) return res.status(400).json({ error: `No Jira mapping for phase: ${phase}` });

  try {
    const transitions = await getTransitions(key);
    const match = transitions.find(t => t.name.toLowerCase() === targetStatus.toLowerCase());
    if (!match) {
      return res.status(404).json({ error: `No transition found for status "${targetStatus}" on ${key}. Available: ${transitions.map(t => t.name).join(', ')}` });
    }
    await doTransition(key, match.id);
    return res.status(200).json({ success: true, key, status: targetStatus });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
