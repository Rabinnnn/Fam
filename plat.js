// ==============================================================
// SUPABASE CONFIGURATION
// ==============================================================
const SUPABASE_URL = 'https://snkcdsfzxjruxhwxnoxh.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-IHen1e8xLiVH9_mJBpKmA_0GQSRFJx';

let currentUser = null;
let isAdmin = false;
let FAMILY_DB = { people: [] };
let FAMILY_COLORS = {};   // family_name → hex color
let fatherMode = 'manual';
let motherMode = 'manual';
let personOwners = {};

// Predefined palette — warm, distinguishable, accessible
const COLOR_PALETTE = [
    '#c2894b','#5a7abf','#6aaa6a','#c2607a','#8f6abf',
    '#bf9a3a','#3aabab','#bf5a3a','#7a8fbf','#7abf6a',
    '#bf3a7a','#3a7abf','#bfaa3a','#6abfbf','#bf6a3a',
    '#a06abf','#3abf7a','#bf3a3a','#3a6abf','#bf7a6a'
];

// ==============================================================
// UNIQUE ID GENERATION
// ==============================================================
function generateUID() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let uid = '';
    for (let i = 0; i < 5; i++) uid += chars[Math.floor(Math.random() * chars.length)];
    return uid;
}

function makePersonId(name, uid) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + uid;
}

// ==============================================================
// PERSISTENCE HELPERS
// ==============================================================
function loadPersonOwners() {
    const saved = localStorage.getItem('person_owners');
    if (saved) try { personOwners = JSON.parse(saved); } catch {}
}
function savePersonOwners() {
    localStorage.setItem('person_owners', JSON.stringify(personOwners));
}

// ==============================================================
// UI HELPERS
// ==============================================================
function showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) { el.textContent = `❌ ${message}`; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 5000); }
    console.error('ERROR:', message);
}
function showSuccess(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) { el.textContent = `✅ ${message}`; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); }
}
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[m]);
}
function validateFullName(name) {
    const t = name.trim();
    if (!t) return { valid: false, message: 'Name cannot be empty' };
    const p = t.split(/\s+/);
    if (p.length < 2) return { valid: false, message: 'Please enter both first and last name' };
    if (p.length > 5) return { valid: false, message: 'Name seems too long' };
    return { valid: true, message: '' };
}

// ==============================================================
// COLOR HELPERS
// ==============================================================
function getColorForFamily(familyName) {
    if (!familyName) return '#e8dcc8';
    return FAMILY_COLORS[familyName] || '#e8dcc8';
}

// Returns a readable text color (dark/light) for a given bg hex
function getTextColor(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
    return luminance > 0.55 ? '#3a2010' : '#fff8f0';
}

async function assignColorForFamily(familyName) {
    if (!familyName || FAMILY_COLORS[familyName]) return;
    const usedColors = Object.values(FAMILY_COLORS);
    const available = COLOR_PALETTE.filter(c => !usedColors.includes(c));
    const color = available.length > 0 ? available[0] : COLOR_PALETTE[Object.keys(FAMILY_COLORS).length % COLOR_PALETTE.length];
    FAMILY_COLORS[familyName] = color;
    // Persist to DB
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/family_colors`, {
            method: 'POST',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates'
            },
            body: JSON.stringify({ family_name: familyName, color })
        });
    } catch(e) { console.warn('Color persist failed:', e); }
}

async function ensurePlaceholderExists() {
    // The __na__ record is a silent depth anchor for unassigned members.
    // It is filtered out of FAMILY_DB.people in loadPeople() so it
    // never appears anywhere in the UI.
    try {
        const check = await fetch(`${SUPABASE_URL}/rest/v1/people?id=eq.__na__&select=id`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        const rows = await check.json();
        if (!Array.isArray(rows) || rows.length === 0) {
            const ins = await fetch(`${SUPABASE_URL}/rest/v1/people`, {
                method: 'POST',
                headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                           'Content-Type': 'application/json', 'Prefer': 'return=representation' },
                body: JSON.stringify({
                    id: '__na__', uid: '__na__', name: 'N/A',
                    gender: 'unknown', parents: '[]',
                    is_root: false, family_name: null
                })
            });
            if (!ins.ok) {
                const err = await ins.text();
                console.warn('Placeholder insert response:', ins.status, err);
            } else {
                console.log('✅ __na__ placeholder created');
            }
        } else {
            console.log('✅ __na__ placeholder already exists');
        }
    } catch(e) { console.warn('Placeholder check failed:', e); }
}

async function loadFamilyColors() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/family_colors?select=*`, {
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
        });
        if (res.ok) {
            const data = await res.json();
            data.forEach(row => { FAMILY_COLORS[row.family_name] = row.color; });
        }
    } catch(e) { console.warn('Color load failed:', e); }
}

function renderLegend(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
    // Only show families that are actually assigned to at least one current member
    const activeFamilies = [...new Set(FAMILY_DB.people.map(p => p.family_name).filter(Boolean))].sort();
    if (!activeFamilies.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;margin-bottom:0.75rem;
                    padding:0.6rem 0.8rem;background:#fcf8ef;border-radius:0.75rem;border:1px solid #e2cfb0;">
            <span style="font-size:0.75rem;font-weight:700;color:#5a3e2b;margin-right:0.25rem;">Legend:</span>
            ${activeFamilies.map(fn => {
                const bg = FAMILY_COLORS[fn] || '#e8dcc8';
                const tx = getTextColor(bg);
                return `<span style="background:${bg};color:${tx};padding:0.2rem 0.6rem;
                               border-radius:1rem;font-size:0.72rem;font-weight:600;">
                            ${escapeHtml(fn)}
                        </span>`;
            }).join('')}
        </div>`;
}

// ==============================================================
// FAMILY NAME FIELD HELPERS
// ==============================================================
function populateFamilyNameDropdown() {
    const existing = [...new Set(FAMILY_DB.people.map(p => p.family_name).filter(Boolean))].sort();
    const selectors = [
        'familyNameSelect',
        'fatherFamilyNameSelect',
        'motherFamilyNameSelect'
    ];
    selectors.forEach(selId => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const current = sel.value; // preserve current selection
        sel.innerHTML = '<option value="">-- Select existing family --</option>';
        existing.forEach(fn => {
            const opt = document.createElement('option');
            opt.value = fn; opt.textContent = fn;
            sel.appendChild(opt);
        });
        if (current) sel.value = current;
    });
}

// Returns the family name from the contribute form
function getFamilyNameValue() {
    const sel = document.getElementById('familyNameSelect');
    const inp = document.getElementById('familyNameInput');
    const mode = document.getElementById('familyNameMode')?.value || 'new';
    if (mode === 'existing' && sel) return sel.value.trim();
    if (inp) return inp.value.trim();
    return '';
}

window.toggleFamilyNameMode = function() {
    const sel  = document.getElementById('familyNameSelect');
    const inp  = document.getElementById('familyNameInput');
    const btn  = document.getElementById('familyNameToggleBtn');
    const mode = document.getElementById('familyNameMode');
    if (!sel || !inp || !mode) return;
    if (mode.value === 'new') {
        sel.style.display = 'block'; inp.style.display = 'none';
        btn.textContent = '✏️ Enter New Name'; mode.value = 'existing';
    } else {
        sel.style.display = 'none'; inp.style.display = 'block';
        btn.textContent = '📋 Choose Existing'; mode.value = 'new';
    }
};

// Toggle between dropdown and text input for a parent's family name field
window.toggleParentFamilyMode = function(parent) {
    const sel  = document.getElementById(`${parent}FamilyNameSelect`);
    const inp  = document.getElementById(`${parent}FamilyNameInput`);
    const mode = document.getElementById(`${parent}FamilyNameMode`);
    const btn  = inp?.parentElement?.querySelector('.toggle-mode-btn');
    if (!sel || !inp || !mode) return;
    if (mode.value === 'new') {
        sel.style.display = 'block'; inp.style.display = 'none'; inp.value = '';
        if (btn) btn.textContent = '✏️';
        mode.value = 'existing';
    } else {
        sel.style.display = 'none'; inp.style.display = 'block'; sel.value = '';
        if (btn) btn.textContent = '📋';
        mode.value = 'new';
    }
};

// Read a parent's family name value from whichever mode is active
function getParentFamilyName(parent) {
    const mode = document.getElementById(`${parent}FamilyNameMode`)?.value || 'new';
    if (mode === 'existing') return document.getElementById(`${parent}FamilyNameSelect`)?.value.trim() || '';
    return document.getElementById(`${parent}FamilyNameInput`)?.value.trim() || '';
}

// ==============================================================
// PARENT DROPDOWN HELPERS
// ==============================================================
function populateParentDropdowns() {
    const fSel = document.getElementById('fatherSelect');
    const mSel = document.getElementById('motherSelect');
    if (!fSel || !mSel) return;
    const sorted = [...FAMILY_DB.people].sort((a,b) => (a.name||'').localeCompare(b.name||''));
    fSel.innerHTML = '<option value="">-- Select Father from existing records --</option>';
    mSel.innerHTML = '<option value="">-- Select Mother from existing records --</option>';
    sorted.forEach(p => {
        const label = `${p.name}${p.uid ? ` [#${p.uid}]` : ''}`;
        [fSel, mSel].forEach(sel => {
            const opt = document.createElement('option');
            opt.value = p.id; opt.textContent = label;
            sel.appendChild(opt);
        });
    });
}

function toggleParentMode(parent) {
    const sel = document.getElementById(`${parent}Select`);
    const inp = document.getElementById(`${parent}Name`);
    const btn = document.querySelector(`#${parent}Container .toggle-mode-btn`);
    const ind = document.getElementById(`${parent}ModeIndicator`);
    const mode = parent === 'father' ? fatherMode : motherMode;
    if (mode === 'manual') {
        sel.style.display = 'block'; inp.style.display = 'none'; inp.value = '';
        btn.textContent = '✏️ Enter Manually';
        ind.innerHTML = '📋 Select mode';
        if (parent === 'father') fatherMode = 'select'; else motherMode = 'select';
    } else {
        sel.style.display = 'none'; inp.style.display = 'block'; sel.value = '';
        btn.textContent = '📋 Use Existing';
        ind.innerHTML = '✏️ Manual entry mode';
        if (parent === 'father') fatherMode = 'manual'; else motherMode = 'manual';
    }
}

function getParentValue(parent) {
    const mode = parent === 'father' ? fatherMode : motherMode;
    if (mode === 'select') {
        const id = document.getElementById(`${parent}Select`).value;
        if (!id) return null;
        const p = FAMILY_DB.people.find(x => x.id === id);
        return p ? { id: p.id, name: p.name } : null;
    }
    const raw = document.getElementById(`${parent}Name`).value.trim();
    return raw ? { id: null, name: raw } : null;
}

// ==============================================================
// SUPABASE API
// ==============================================================
async function loadPeople() {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/people?select=*`, {
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const allPeople = await res.json();
    // Always filter out the hidden placeholder — it must never appear in the UI
    FAMILY_DB.people = allPeople.filter(p => !p.id.startsWith('__'));
    populateParentDropdowns();
    populateFamilyNameDropdown();
    loadPersonOwners();
    return FAMILY_DB.people;
}

async function addPersonToDB(person) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/people`, {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                   'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(person)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    if (!personOwners[person.id]) { personOwners[person.id] = currentUser; savePersonOwners(); }
    return true;
}

async function updatePersonInDB(personId, updates) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/people?id=eq.${personId}`, {
        method: 'PATCH',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                   'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return true;
}

async function deletePersonFromDB(personId) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/people?id=eq.${personId}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    delete personOwners[personId]; savePersonOwners();
    return true;
}

// ==============================================================
// LOOKUP HELPERS
// ==============================================================
function findPersonById(id) { return FAMILY_DB.people.find(p => p.id === id) || null; }
function findPeopleByName(name) {
    const l = name.trim().toLowerCase();
    return FAMILY_DB.people.filter(p => p.name.trim().toLowerCase() === l);
}
function findAllByPartialName(term) {
    const l = term.trim().toLowerCase();
    return l ? FAMILY_DB.people.filter(p => p.name.toLowerCase().includes(l)) : [];
}
function canEditPerson(id) { return isAdmin || personOwners[id] === currentUser; }
function isRootPerson(p) { return p.is_root === true || p.is_root === 'true'; }

function getParentsArray(person) {
    if (!person?.parents) return [];
    try {
        const a = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
        return Array.isArray(a) ? a : [];
    } catch { return []; }
}

// ==============================================================
// TREE TRAVERSAL
// ==============================================================
function getAncestors(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return [];
    visited.add(person.id);
    let r = [person];
    for (const pid of getParentsArray(person)) {
        const par = findPersonById(pid);
        if (par) r = r.concat(getAncestors(par, visited));
    }
    return r;
}

function getDescendants(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return [];
    visited.add(person.id);
    let r = [person];
    for (const child of FAMILY_DB.people.filter(p => getParentsArray(p).includes(person.id)))
        r = r.concat(getDescendants(child, visited));
    return r;
}

function getGenerationDepth(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return 0;
    visited.add(person.id);
    let max = 0;
    for (const pid of getParentsArray(person)) {
        const par = findPersonById(pid);
        if (par) max = Math.max(max, getGenerationDepth(par, visited) + 1);
    }
    return max;
}

function getPersonGenerationLevel(person) {
    let depth = 0, current = person;
    const seen = new Set();
    while (current) {
        if (seen.has(current.id)) break;
        seen.add(current.id);
        const parents = getParentsArray(current);
        if (!parents.length) break;
        depth++;
        current = findPersonById(parents[0]);
    }
    return depth;
}

async function validateParentsGeneration(fatherRef, motherRef) {
    if (!fatherRef || !motherRef) return { valid: true, message: '' };
    const fp = fatherRef.id ? findPersonById(fatherRef.id) : findPeopleByName(fatherRef.name)[0];
    const mp = motherRef.id ? findPersonById(motherRef.id) : findPeopleByName(motherRef.name)[0];
    if (!fp || !mp) return { valid: true, message: '' };
    const fg = getPersonGenerationLevel(fp), mg = getPersonGenerationLevel(mp);
    if (fg !== mg) return { valid: false, message: `Generation mismatch: "${fp.name}" is Gen ${fg+1} but "${mp.name}" is Gen ${mg+1}. Parents must be from the same generation.` };
    return { valid: true, message: '' };
}

// ==============================================================
// CLUSTER DETECTION  (uses family_name for grouping)
// ==============================================================
function findFamilyClusters() {
    const adj = new Map();
    FAMILY_DB.people.forEach(p => adj.set(p.id, new Set()));
    // Clusters are built from parent-child relationships ONLY.
    // family_name is a visual attribute (color) and must not influence
    // which people get grouped into the same tree cluster.
    FAMILY_DB.people.forEach(p => {
        for (const pid of getParentsArray(p)) {
            if (adj.has(pid)) { adj.get(pid).add(p.id); adj.get(p.id).add(pid); }
        }
    });
    const visited = new Set(), clusters = [];
    for (const person of FAMILY_DB.people) {
        if (!visited.has(person.id)) {
            const cluster = [], queue = [person.id];
            visited.add(person.id);
            while (queue.length) {
                const cid = queue.shift();
                const cp = findPersonById(cid);
                if (cp) cluster.push(cp);
                for (const nid of (adj.get(cid) || [])) {
                    if (!visited.has(nid)) { visited.add(nid); queue.push(nid); }
                }
            }
            if (cluster.length) clusters.push(cluster);
        }
    }
    return clusters;
}

function clusterFamilyName(cluster) {
    const roots = cluster.filter(isRootPerson);
    const base  = roots.length ? roots[0] : cluster[0];
    if (!base?.name) return 'Unknown Family';
    const parts = base.name.split(' ');
    return parts[parts.length - 1] + ' Family';
}

// ==============================================================
// NODE BUILDER  — colored by family_name
// ==============================================================
function buildNodeHtml(person, extraClass = '', onClick = null) {
    const bg      = getColorForFamily(person.family_name);
    const tx      = getTextColor(bg);
    const uid     = person.uid ? `<span style="display:block;font-size:0.6rem;opacity:0.75;margin-top:0.1rem;">#${person.uid}</span>` : '';
    const handler = onClick || `handleNodeClick('${person.id}')`;
    return `<div class="tree-node ${extraClass}"
                 style="background:${bg};border-color:${bg};color:${tx};"
                 onclick="${handler}">
                <strong>${escapeHtml(person.name)}</strong>
                ${uid}
            </div>`;
}

// Checkbox row used in multi-pick modals
function buildCheckboxRow(person, cssClass) {
    const uidBadge = person.uid ? ` <span style="font-size:0.65rem;color:#b08052;">#${person.uid}</span>` : '';
    return `<label style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;
                           border-radius:0.5rem;cursor:pointer;transition:background 0.15s;"
                   onmouseover="this.style.background='#fef3e2'"
                   onmouseout="this.style.background='transparent'">
                <input type="checkbox" class="${cssClass}" value="${person.id}"
                       style="width:auto;cursor:pointer;accent-color:#c2894b;">
                <span style="font-size:0.85rem;">${escapeHtml(person.name)}${uidBadge}</span>
            </label>`;
}

// ==============================================================
// DISAMBIGUATION MODAL
// ==============================================================
function showDisambiguationModal(matches, onSelect) {
    document.getElementById('disambigModal')?.remove();
    const items = matches.map(p => `
        <div onclick="disambigSelect('${p.id}')"
             style="padding:0.6rem 0.8rem;border-radius:0.5rem;background:#fef7ed;
                    border:1px solid #e7cfb0;cursor:pointer;margin-bottom:0.4rem;">
            <strong>${escapeHtml(p.name)}</strong>
            <span style="font-size:0.65rem;color:#b08052;margin-left:0.5rem;">#${p.uid||p.id}</span>
            ${p.dob ? `<span style="font-size:0.7rem;color:#888;margin-left:0.5rem;">b. ${p.dob}</span>` : ''}
            ${p.family_name ? `<span style="font-size:0.7rem;color:#5a7abf;margin-left:0.5rem;">${escapeHtml(p.family_name)}</span>` : ''}
        </div>`).join('');
    document.body.insertAdjacentHTML('beforeend', `
        <div id="disambigModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);
             display:flex;align-items:center;justify-content:center;z-index:10000;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;
                        max-width:400px;width:90%;max-height:80vh;overflow-y:auto;">
                <h3 style="margin-bottom:0.75rem;">Multiple matches found</h3>
                <p style="font-size:0.8rem;color:#666;margin-bottom:1rem;">Select the person you mean:</p>
                ${items}
                <button onclick="document.getElementById('disambigModal').remove()"
                        style="margin-top:0.75rem;background:#6c757d;color:white;border:none;
                               border-radius:0.5rem;padding:0.5rem 1rem;cursor:pointer;width:100%;">Cancel</button>
            </div>
        </div>`);
    window._disambigCallback = onSelect;
}
window.disambigSelect = function(id) {
    document.getElementById('disambigModal')?.remove();
    window._disambigCallback?.(id);
};

// ==============================================================
// LINEAGE MODAL  (shown when a node is clicked)
// ==============================================================
function buildLineageHtml(person) {
    // ── ancestors ──
    const ancestorsRaw = getAncestors(person);
    const uniqAncestors = [];
    const seenA = new Set();
    for (const a of ancestorsRaw) { if (!seenA.has(a.id)) { seenA.add(a.id); uniqAncestors.push(a); } }

    const aDepth = new Map();
    function calcAncDepth(p, d) {
        if (!p) return;
        if (!aDepth.has(p.id) || aDepth.get(p.id) < d) aDepth.set(p.id, d);
        for (const pid of getParentsArray(p)) calcAncDepth(findPersonById(pid), d+1);
    }
    calcAncDepth(person, 0);

    const aGroups = new Map();
    for (const a of uniqAncestors) {
        const d = aDepth.get(a.id) ?? 0;
        if (!aGroups.has(d)) aGroups.set(d, []);
        aGroups.get(d).push(a);
    }
    const aDepths = Array.from(aGroups.keys()).sort((a,b) => b-a);

    // ── descendants ──
    const descRaw = getDescendants(person);
    const uniqDesc = [];
    const seenD = new Set([person.id]);
    for (const d of descRaw) { if (!seenD.has(d.id)) { seenD.add(d.id); uniqDesc.push(d); } }

    const dDepth = new Map();
    function calcDescDepth(p, d) {
        if (!p) return;
        if (!dDepth.has(p.id) || dDepth.get(p.id) < d) dDepth.set(p.id, d);
        for (const child of FAMILY_DB.people.filter(c => getParentsArray(c).includes(p.id))) calcDescDepth(child, d+1);
    }
    calcDescDepth(person, 0);

    const dGroups = new Map();
    for (const d of uniqDesc) {
        const depth = dDepth.get(d.id) ?? 1;
        if (!dGroups.has(depth)) dGroups.set(depth, []);
        dGroups.get(depth).push(d);
    }
    const dDepths = Array.from(dGroups.keys()).sort((a,b) => a-b);

    const totalAncGen = aDepths.length;
    let html = `<div class="lineage-chain">`;

    aDepths.forEach((depth, idx) => {
        const level  = aGroups.get(depth);
        const genNum = totalAncGen - idx;
        const label  = depth === 0
            ? `📍 ${escapeHtml(person.name)}`
            : idx === 0 ? `👴👵 Oldest Ancestors — Gen ${genNum}` : `📍 Generation ${genNum}`;

        html += `<div class="lineage-gen-block">
                    <div class="lineage-gen-label">${label}</div>
                    <div class="lineage-nodes-row">`;
        for (const m of level) html += buildNodeHtml(m, m.id === person.id ? 'focused-node' : '');
        html += `</div></div>`;
        if (idx < aDepths.length - 1) html += `<div class="lineage-connector">▼</div>`;
    });

    if (dDepths.length) {
        html += `<div class="lineage-connector">▼</div>`;
        dDepths.forEach((depth, idx) => {
            const label = depth === 1 ? '👶 Children' : depth === 2 ? '📍 Grandchildren' : depth === 3 ? '📍 Great-Grandchildren' : `📍 Generation +${depth}`;
            html += `<div class="lineage-gen-block">
                        <div class="lineage-gen-label">${label}</div>
                        <div class="lineage-nodes-row">`;
            for (const m of dGroups.get(depth)) html += buildNodeHtml(m);
            html += `</div></div>`;
            if (idx < dDepths.length - 1) html += `<div class="lineage-connector">▼</div>`;
        });
    }

    html += `</div>`;
    return html;
}

function showLineageModal(personId) {
    const person = findPersonById(personId);
    if (!person) return;
    document.getElementById('lineageModal')?.remove();

    const canEdit = canEditPerson(personId);
    const editBtn = canEdit
        ? `<button onclick="closeLineageModal();showEditModal(findPersonById('${personId}'))"
                   style="background:#5a3e2b;color:white;border:none;border-radius:0.75rem;
                          padding:0.5rem 1.2rem;cursor:pointer;font-size:0.85rem;">✏️ Edit</button>`
        : `<span style="font-size:0.75rem;color:#999;">🔒 Editing restricted</span>`;

    document.body.insertAdjacentHTML('beforeend', `
        <div id="lineageModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);
             display:flex;align-items:center;justify-content:center;z-index:10000;padding:1rem;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;max-width:700px;
                        width:100%;max-height:90vh;overflow-y:auto;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
                    <h3 style="color:#4f321b;">📜 Lineage of ${escapeHtml(person.name)}</h3>
                    <button onclick="closeLineageModal()"
                            style="background:none;border:none;font-size:1.4rem;cursor:pointer;color:#888;">✕</button>
                </div>
                <div id="lineageModalBody">
                    ${buildLineageHtml(person)}
                </div>
                <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:1.25rem;
                            padding-top:1rem;border-top:1px solid #e2cfb0;">
                    ${editBtn}
                    <button onclick="closeLineageModal()"
                            style="background:#6c757d;color:white;border:none;border-radius:0.75rem;
                                   padding:0.5rem 1.2rem;cursor:pointer;font-size:0.85rem;">Close</button>
                </div>
            </div>
        </div>`);
}

window.closeLineageModal = function() { document.getElementById('lineageModal')?.remove(); };
window.handleNodeClick   = function(personId) { showLineageModal(personId); };

// ==============================================================
// EDIT MODAL
// ==============================================================
function showEditModal(person) {
    if (!person) return;
    document.getElementById('editModal')?.remove();

    const rootToggle = '';

    const fnOptions = [...new Set(FAMILY_DB.people.map(p => p.family_name).filter(Boolean))].sort()
        .map(fn => `<option value="${fn}" ${person.family_name === fn ? 'selected' : ''}>${escapeHtml(fn)}</option>`).join('');

    document.body.insertAdjacentHTML('beforeend', `
        <div id="editModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);
             display:flex;align-items:center;justify-content:center;z-index:11000;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;max-width:400px;
                        width:90%;max-height:90vh;overflow-y:auto;">
                <h3 style="margin-bottom:1rem;">✏️ Edit ${escapeHtml(person.name)}</h3>
                <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" id="editName" value="${escapeHtml(person.name)}"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                </div>
                <div class="form-group">
                    <label>Gender</label>
                    <select id="editGender" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                        <option value="male"    ${person.gender==='male'    ?'selected':''}>Male</option>
                        <option value="female"  ${person.gender==='female'  ?'selected':''}>Female</option>
                        <option value="other"   ${person.gender==='other'   ?'selected':''}>Other</option>
                        <option value="unknown" ${person.gender==='unknown' ?'selected':''}>Unknown</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" id="editDob" value="${person.dob||''}"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;cursor:pointer;">
                </div>
                <div class="form-group">
                    <label>Family Name</label>
                    <select id="editFamilyName" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                        <option value="">-- No family assigned --</option>
                        ${fnOptions}
                    </select>
                </div>
                ${rootToggle}
                <div style="font-size:0.7rem;color:#888;margin-bottom:0.75rem;">ID: <strong>#${person.uid||person.id}</strong></div>
                <div style="display:flex;gap:0.5rem;margin-top:1rem;">
                    <button onclick="saveEdit('${person.id}')" class="submit-btn" style="flex:1;">Save</button>
                    <button onclick="closeEditModal()"
                            style="flex:1;background:#6c757d;color:white;border:none;border-radius:0.5rem;cursor:pointer;">Cancel</button>
                </div>
            </div>
        </div>`);

    document.getElementById('editDob')?.addEventListener('click', function() { this.showPicker(); });
}

window.saveEdit = async function(personId) {
    const name       = document.getElementById('editName').value.trim();
    const gender     = document.getElementById('editGender').value;
    const dob        = document.getElementById('editDob').value;
    const familyName = document.getElementById('editFamilyName').value.trim();
    if (!name) { alert('Name cannot be empty'); return; }
    const v = validateFullName(name);
    if (!v.valid) { alert(v.message); return; }

    if (familyName) await assignColorForFamily(familyName);

    const updates = { name, gender };
    if (dob) updates.dob = dob;
    if (familyName !== undefined) updates.family_name = familyName || null;

    try {
        await updatePersonInDB(personId, updates);
        await loadPeople(); await loadFamilyColors();
        closeEditModal();
        showSuccess('contributeSuccessMsg', 'Updated successfully!');
    } catch(e) { showError('contributeErrorMsg', `Update failed: ${e.message}`); }
};

window.closeEditModal = function() { document.getElementById('editModal')?.remove(); };

// Expose for lineage modal's edit button
window.findPersonById = findPersonById;
window.showEditModal  = showEditModal;

// ==============================================================
// ╔══════════════════════════════════════════════╗
// ║  VIEW 1: LINEAGE TAB                         ║
// ╚══════════════════════════════════════════════╝
// ==============================================================
function renderLineageView(personId) {
    const container = document.getElementById('lineageContainer');
    const titleEl   = document.getElementById('lineageTitle');
    const person    = findPersonById(personId);
    if (!person) { container.innerHTML = `<div style="text-align:center;padding:1.5rem;">🍂 Person not found.</div>`; return; }
    titleEl.innerHTML = `📜 Full Lineage of ${escapeHtml(person.name)}`;
    renderLegend('lineageLegend');
    container.innerHTML = buildLineageHtml(person);
}

function handleLineageSearch(searchTerm) {
    const container = document.getElementById('lineageContainer');
    const statusEl  = document.getElementById('lineageStatus');
    if (!searchTerm.trim()) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">🌱 Enter a name to see their full lineage.</div>`;
        return;
    }
    const matches = findAllByPartialName(searchTerm);
    if (!matches.length) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">🍂 No records found for "${escapeHtml(searchTerm)}"</div>`;
        statusEl.textContent = ''; return;
    }
    if (matches.length === 1) {
        statusEl.textContent = `Showing lineage for "${matches[0].name}"`;
        renderLineageView(matches[0].id);
    } else {
        statusEl.textContent = `Multiple matches for "${searchTerm}"`;
        showDisambiguationModal(matches, id => {
            const p = findPersonById(id);
            if (p) { statusEl.textContent = `Showing lineage for "${p.name}"${p.uid ? ` [#${p.uid}]` : ''}`; renderLineageView(id); }
        });
    }
}

// ==============================================================
// ╔══════════════════════════════════════════════════════════╗
// ║  VIEW 2: WHOLE FAMILY TREE                              ║
// ╚══════════════════════════════════════════════════════════╝
// ==============================================================
function buildWholeTreeRows(cluster) {
    const clusterIds = new Set(cluster.map(p => p.id));
    const depthCache = new Map();

    // A person is treated as a root (depth 0) if they have no parents
    // within this cluster — regardless of the is_root flag.
    // is_root is used by the admin for explicit promotion only;
    // the tree renderer simply uses parent-child relationships.
    function depth(person) {
        if (depthCache.has(person.id)) return depthCache.get(person.id);
        const allParents    = getParentsArray(person);
        const clusterParents = allParents.filter(pid => clusterIds.has(pid));

        // If the person has NO parent IDs at all → true root, depth 0
        // If they have parent IDs but none are visible cluster members
        // (e.g. only __na__ placeholder) → still push them to depth 1
        // so they don't float up alongside real roots
        if (!allParents.length) {
            depthCache.set(person.id, 0); return 0;
        }
        if (!clusterParents.length) {
            depthCache.set(person.id, 1); return 1;
        }
        const parentDepths = clusterParents
            .map(pid => { const par = findPersonById(pid); return par ? depth(par) : 0; });
        const d = Math.max(...parentDepths) + 1;
        depthCache.set(person.id, d); return d;
    }

    cluster.forEach(p => depth(p));

    const byDepth = new Map();
    cluster.forEach(p => {
        const d = depthCache.get(p.id) ?? 0;
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d).push(p);
    });

    if (!byDepth.size) return [];
    const maxDepth = Math.max(...byDepth.keys());
    const rows = [];
    for (let d = 0; d <= maxDepth; d++) {
        const row = byDepth.get(d) || [];
        row.sort((a, b) => {
            const ka = getParentsArray(a).sort().join(',');
            const kb = getParentsArray(b).sort().join(',');
            return ka !== kb ? ka.localeCompare(kb) : a.name.localeCompare(b.name);
        });
        rows.push(row);
    }
    return rows;
}

function renderWholeFamilyTree() {
    const container = document.getElementById('wholeTreeContainer');
    const titleEl   = document.getElementById('wholeTreeTitle');
    const clusters  = findFamilyClusters();

    if (!clusters.length || clusters.every(c => !c.length)) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">🌱 No data yet. Add family members to get started.</div>`;
        return;
    }

    titleEl.innerHTML = '🌳 Whole Family Tree';
    renderLegend('wholeTreeLegend');

    function renderClusterHtml(cluster) {
        const rows = buildWholeTreeRows(cluster);
        if (!rows.length) return `<div style="text-align:center;padding:1rem;font-size:0.82rem;color:#888;">No members to display in this group yet.</div>`;

        let html = `<div class="generations-tree">`;
        rows.forEach((row, idx) => {
            if (!row.length) return;
            const genNum   = idx + 1;
            const genLabel = idx === 0 ? '👴👵 Oldest Generation' : `📍 Generation ${genNum}`;
            const rowIds   = row.map(m => m.id).join(',');

            html += `<div class="gen-label">${genLabel}</div><div class="generation">`;
            for (const m of row) html += buildNodeHtml(m);
            html += `<div class="tree-node add-gen-btn"
                          onclick="showWholeTreeAddModal(${genNum},'${rowIds}',${idx},${idx===0})">＋ Add</div>`;
            html += `</div>`;
            if (idx < rows.length - 1) html += `<div class="connector-line">▼</div>`;
        });
        html += `</div>`;
        return html;
    }

    if (clusters.length === 1) {
        container.innerHTML = renderClusterHtml(clusters[0]);
    } else {
        let html = `<div style="display:flex;flex-direction:column;gap:1rem;">`;
        clusters.forEach(cluster => {
            const fn = clusterFamilyName(cluster);
            html += `<div class="family-separator">
                        <h3 class="family-heading">🏠 ${escapeHtml(fn)} (${cluster.length} members)</h3>
                        ${renderClusterHtml(cluster)}
                     </div>`;
        });
        html += `</div>`;
        container.innerHTML = html;
    }
}

// ==============================================================
// WHOLE TREE ＋ ADD MODAL
// ==============================================================
window.showWholeTreeAddModal = function(genNum, rowIdsStr, depthIdx, isOldest) {
    document.getElementById('wholeTreeAddModal')?.remove();
    const rowIds = rowIdsStr ? rowIdsStr.split(',').filter(Boolean) : [];

    const rowOpts = rowIds.map(id => {
        const p = findPersonById(id);
        return p ? `<option value="${id}">${escapeHtml(p.name)}${p.uid?` [#${p.uid}]`:''}</option>` : '';
    }).join('');

    const allOpts = [...FAMILY_DB.people].sort((a,b) => a.name.localeCompare(b.name))
        .map(p => `<option value="${p.id}">${escapeHtml(p.name)}${p.uid?` [#${p.uid}]`:''}</option>`).join('');

    const existingFamilies = [...new Set(FAMILY_DB.people.map(p => p.family_name).filter(Boolean))].sort();
    const fnOpts = existingFamilies.map(fn => `<option value="${fn}">${escapeHtml(fn)}</option>`).join('');

    const aboveNote = isOldest ? `<div style="font-size:0.72rem;color:#856404;background:#fff3cd;padding:0.4rem;border-radius:0.4rem;margin-top:0.3rem;">
        ⚠️ No generation above. New person will be marked as <strong>root ancestor</strong> automatically.</div>` : '';

    document.body.insertAdjacentHTML('beforeend', `
        <div id="wholeTreeAddModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.55);
             display:flex;align-items:center;justify-content:center;z-index:10000;padding:1rem;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;max-width:460px;
                        width:100%;max-height:90vh;overflow-y:auto;">
                <h3 style="margin-bottom:0.25rem;">➕ Add Member — Generation ${genNum}</h3>
                <p style="font-size:0.8rem;color:#888;margin-bottom:1rem;">Choose placement relative to Generation ${genNum}.</p>
                <div class="form-group">
                    <label>Placement *</label>
                    <select id="wtPlacement" onchange="wtPlacementChanged(${genNum},${depthIdx},${isOldest})"
                            style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                        <option value="">-- Choose placement --</option>
                        <option value="above">⬆️ Above — new person is a parent of someone in Gen ${genNum}</option>
                        <option value="within">↔️ Within — new person is a sibling at Gen ${genNum}</option>
                        <option value="below">⬇️ Below — new person is a child of someone in Gen ${genNum}</option>
                    </select>
                </div>
                <div id="wtContextSection"></div>
                <div class="form-group" style="margin-top:0.75rem;">
                    <label>Full Name *</label>
                    <input type="text" id="wtName" placeholder="First Last"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;box-sizing:border-box;">
                </div>
                <div class="form-group">
                    <label>Gender</label>
                    <select id="wtGender" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                        <option value="unknown">Unknown</option><option value="male">Male</option>
                        <option value="female">Female</option><option value="other">Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date of Birth <span style="color:#aaa;font-weight:normal;">(optional)</span></label>
                    <input type="date" id="wtDob" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;cursor:pointer;">
                </div>
                <div class="form-group">
                    <label>Family Name <span style="color:#aaa;font-weight:normal;">(optional)</span></label>
                    <select id="wtFamilyNameSelect" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;margin-bottom:0.4rem;">
                        <option value="">-- Select existing family --</option>${fnOpts}
                    </select>
                    <input type="text" id="wtFamilyNameInput" placeholder="Or type a new family name"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;box-sizing:border-box;">
                    <div style="font-size:0.68rem;color:#888;margin-top:0.2rem;">Select from dropdown OR type a new name below it.</div>
                </div>
                <div id="wtError" style="color:#c33;font-size:0.82rem;margin-top:0.5rem;display:none;"></div>
                <div style="display:flex;gap:0.5rem;margin-top:1rem;">
                    <button onclick="submitWholeTreeAdd('${rowIdsStr}',${depthIdx},${isOldest})"
                            class="submit-btn" style="flex:1;">Add to Tree</button>
                    <button onclick="closeWholeTreeAddModal()"
                            style="flex:1;background:#6c757d;color:white;border:none;border-radius:0.5rem;cursor:pointer;padding:0.5rem;">Cancel</button>
                </div>
            </div>
        </div>`);

    window._wtRowIds    = rowIds;
    window._wtAllOpts   = allOpts;
    window._wtRowOpts   = rowOpts;
    window._wtAboveNote = aboveNote;
    window._wtAllPeople = [...FAMILY_DB.people].sort((a,b) => a.name.localeCompare(b.name));

    // Pre-compute people who sit exactly one generation below this row (depthIdx + 1).
    // We do this by finding all people whose parents include at least one member of the
    // current row, OR whose parent-chain depth equals depthIdx + 1 in the same cluster.
    // Simplest reliable approach: anyone who has a parent in the current row.
    const nextGenPeople = FAMILY_DB.people.filter(p => {
        const parents = getParentsArray(p);
        return parents.some(pid => rowIds.includes(pid));
    }).sort((a,b) => a.name.localeCompare(b.name));
    window._wtNextGenPeople = nextGenPeople;

    document.getElementById('wtDob')?.addEventListener('click', function() { this.showPicker(); });
};

window.wtPlacementChanged = function(genNum, depthIdx, isOldest) {
    const placement = document.getElementById('wtPlacement').value;
    const section   = document.getElementById('wtContextSection');
    const rowOpts   = window._wtRowOpts || '';
    const allOpts   = window._wtAllOpts || '';
    const aboveNote = window._wtAboveNote || '';
    if (!placement) { section.innerHTML = ''; return; }
    if (placement === 'above') {
        // Build checkbox list from rowIds
        const aboveCheckboxes = (window._wtRowIds || [])
            .map(id => { const p = FAMILY_DB.people.find(x => x.id === id); return p ? buildCheckboxRow(p, 'wt-above-child') : ''; })
            .join('');

        section.innerHTML = `${aboveNote}
            <div class="form-group" style="margin-top:0.75rem;">
                <label>Their child(ren) from Generation ${genNum} *</label>
                <div id="wtAboveChildrenWrap"
                     style="border:1px solid #ccc;border-radius:0.5rem;padding:0.4rem 0.25rem;
                            max-height:160px;overflow-y:auto;background:white;">
                    ${aboveCheckboxes || '<div style="padding:0.5rem;color:#888;font-size:0.8rem;">No members found</div>'}
                </div>
                <div style="font-size:0.68rem;color:#888;margin-top:0.25rem;">
                    Tick the members who are children of the new person.
                    Unticked members stay as roots and are unaffected.
                </div>
            </div>`;
    } else if (placement === 'within') {
        section.innerHTML = `
            <div class="form-group" style="margin-top:0.75rem;">
                <label>Inherit parents from sibling <span style="color:#aaa;font-weight:normal;">(optional)</span></label>
                <select id="wtSiblingRef" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;margin-bottom:0.4rem;">
                    <option value="">-- Auto-inherit from first sibling with parents --</option>${rowOpts}
                </select>
                <select id="wtParent1" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;margin-bottom:0.4rem;">
                    <option value="">-- Specify Parent 1 (optional) --</option>${allOpts}
                </select>
                <select id="wtParent2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                    <option value="">-- Specify Parent 2 (optional) --</option>${allOpts}
                </select>
            </div>
            <div class="form-group">
                <label>Child(ren) <span style="color:#aaa;font-weight:normal;">(optional)</span></label>
                <div id="wtChildLink2Wrap"
                     style="border:1px solid #ccc;border-radius:0.5rem;padding:0.4rem 0.25rem;
                            max-height:160px;overflow-y:auto;background:white;">
                    ${(window._wtNextGenPeople||[]).length
                        ? (window._wtNextGenPeople||[]).map(p => buildCheckboxRow(p, 'wt-child-link2')).join('')
                        : '<div style="padding:0.5rem;color:#888;font-size:0.8rem;">No members in the generation below yet.</div>'
                    }
                </div>
                <div style="font-size:0.68rem;color:#888;margin-top:0.25rem;">
                    Only members of the generation directly below are shown.
                    Tick those who will be children of the new person.
                </div>
            </div>`;
    } else if (placement === 'below') {
        section.innerHTML = `
            <div class="form-group" style="margin-top:0.75rem;">
                <label>Parent(s) from Generation ${genNum} *</label>
                <select id="wtParentLink1" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;margin-bottom:0.4rem;">
                    <option value="">-- Select Parent 1 --</option>${rowOpts}
                </select>
                <select id="wtParentLink2" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                    <option value="">-- Select Parent 2 (optional) --</option>${rowOpts}
                </select>
            </div>`;
    }
};

window.closeWholeTreeAddModal = function() { document.getElementById('wholeTreeAddModal')?.remove(); };

window.submitWholeTreeAdd = async function(rowIdsStr, depthIdx, isOldest) {
    const name      = document.getElementById('wtName').value.trim();
    const gender    = document.getElementById('wtGender').value;
    const dob       = document.getElementById('wtDob').value;
    const placement = document.getElementById('wtPlacement').value;
    const fnSelect  = document.getElementById('wtFamilyNameSelect').value.trim();
    const fnInput   = document.getElementById('wtFamilyNameInput').value.trim();
    const familyName = fnSelect || fnInput || null;
    const errorDiv  = document.getElementById('wtError');

    const showErr = msg => { errorDiv.textContent = '❌ ' + msg; errorDiv.style.display = 'block'; setTimeout(() => { errorDiv.style.display = 'none'; }, 6000); };

    if (!placement) return showErr('Please choose a placement.');
    const nv = validateFullName(name); if (!nv.valid) return showErr(nv.message);
    if (familyName) await assignColorForFamily(familyName);

    const uid = generateUID(), newId = makePersonId(name, uid);

    try {
        if (placement === 'above') {
            // Only re-parent the children the user explicitly selected.
            // Unselected members of that generation stay untouched as roots.
            const selectedChildren = Array.from(
                document.querySelectorAll('.wt-above-child:checked') || []
            ).map(o => o.value).filter(Boolean);

            if (!selectedChildren.length)
                return showErr('Please select at least one child from the generation below.');

            // Snapshot selected children BEFORE any writes
            const selectedMembers = selectedChildren
                .map(id => FAMILY_DB.people.find(p => p.id === id))
                .filter(Boolean);

            // Add the new person as a root (no parents)
            await addPersonToDB({
                id: newId, uid, name, gender, dob: dob||null,
                parents: JSON.stringify([]),
                is_root: true,
                family_name: familyName
            });

            // Re-parent selected children to the new root
            for (const member of selectedMembers) {
                const updatedParents = [...new Set([...getParentsArray(member), newId])];
                await updatePersonInDB(member.id, {
                    parents: JSON.stringify(updatedParents),
                    is_root: false
                });
            }

            // Unselected members get the hidden __na__ placeholder as their parent.
            // This pushes them to depth 1 (generation 2) without displaying
            // any false relationship on the tree. __na__ is filtered out of FAMILY_DB
            // so it never appears as a visible node.
            const allRowIds = rowIdsStr ? rowIdsStr.split(',').filter(Boolean) : [];
            const unselected = allRowIds.filter(id => !selectedChildren.includes(id));
            for (const uid2 of unselected) {
                const member = FAMILY_DB.people.find(p => p.id === uid2);
                if (!member) continue;
                const existingParents = getParentsArray(member);
                // Only stamp __na__ if they have no real visible parent yet.
                // A "real" parent is one that exists in FAMILY_DB (not __na__ itself).
                const hasRealParent = existingParents.some(pid =>
                    pid !== '__na__' && FAMILY_DB.people.find(p => p.id === pid)
                );
                if (!hasRealParent) {
                    await updatePersonInDB(uid2, {
                        parents: JSON.stringify(['__na__']),
                        is_root: false
                    });
                }
            }

        } else if (placement === 'within') {
            const siblingRefId = document.getElementById('wtSiblingRef')?.value || '';
            const p1 = document.getElementById('wtParent1')?.value || '';
            const p2 = document.getElementById('wtParent2')?.value || '';
            const childLinks = Array.from(
                document.querySelectorAll('.wt-child-link2:checked') || []
            ).map(o => o.value);
            let parentIds = [];
            if (p1) parentIds.push(p1);
            if (p2 && p2 !== p1) parentIds.push(p2);
            if (!parentIds.length && siblingRefId) {
                const sib = FAMILY_DB.people.find(p => p.id === siblingRefId);
                if (sib) parentIds = getParentsArray(sib);
            }
            if (!parentIds.length) {
                const rowIds = rowIdsStr ? rowIdsStr.split(',').filter(Boolean) : [];
                for (const sid of rowIds) {
                    const s = FAMILY_DB.people.find(p => p.id === sid);
                    if (s) { const sp = getParentsArray(s); if (sp.length) { parentIds = sp; break; } }
                }
            }
            await addPersonToDB({
                id: newId, uid, name, gender, dob: dob||null,
                parents: JSON.stringify(parentIds),
                is_root: parentIds.length === 0 && depthIdx === 0,
                family_name: familyName
            });
            // Wire up any explicitly chosen children
            for (const cid of childLinks) {
                const child = FAMILY_DB.people.find(p => p.id === cid);
                if (child) {
                    await updatePersonInDB(cid, {
                        parents: JSON.stringify([...new Set([...getParentsArray(child), newId])])
                    });
                }
            }

        } else if (placement === 'below') {
            const pl1 = document.getElementById('wtParentLink1')?.value || '';
            const pl2 = document.getElementById('wtParentLink2')?.value || '';
            if (!pl1) return showErr('Please select at least one parent.');
            const parentIds = [pl1];
            if (pl2 && pl2 !== pl1) parentIds.push(pl2);
            await addPersonToDB({
                id: newId, uid, name, gender, dob: dob||null,
                parents: JSON.stringify(parentIds),
                is_root: false,
                family_name: familyName
            });
        }

        // Single reload at the very end, after all DB writes are complete
        await loadPeople();
        personOwners[newId] = currentUser; savePersonOwners();
        closeWholeTreeAddModal();
        showSuccess('contributeSuccessMsg', `✅ "${name}" added to the tree!`);
        renderWholeFamilyTree();
        if (isAdmin) await updateAdminPanel();
    } catch(err) { showErr(`Failed: ${err.message}`); }
};

// ==============================================================
// CONTRIBUTE
// ==============================================================
async function addOrGetPerson(nameOrRef, gender = 'unknown', familyName = null) {
    if (!nameOrRef) return null;
    const isRef = typeof nameOrRef === 'object';
    const name  = isRef ? nameOrRef.name : nameOrRef;
    const existingId = isRef ? nameOrRef.id : null;

    // If selected from dropdown, return the existing record directly
    if (existingId) return findPersonById(existingId);

    const v = validateFullName(name);
    if (!v.valid) throw new Error(v.message);

    // If exactly one person with this name already exists, reuse them
    const exactMatches = findPeopleByName(name);
    if (exactMatches.length === 1) return exactMatches[0];

    // Create new person — always with a fresh uid so same names never collide
    const uid = generateUID(), newId = makePersonId(name, uid);
    // No loadPeople() here — caller does one reload at the end
    await addPersonToDB({
        id: newId, uid, name, gender,
        parents: JSON.stringify([]),
        is_root: false,
        family_name: familyName
    });
    // Return a local object so the caller can use the id immediately
    // without waiting for a DB reload
    return { id: newId, uid, name, gender, parents: '[]', is_root: false, family_name: familyName };
}

async function contributeToTree(event) {
    event.preventDefault();
    const userName   = document.getElementById('userFullName').value.trim();
    const userGender = document.getElementById('userGender').value;
    const userDob    = document.getElementById('userDob')?.value || null;
    const fatherRef        = getParentValue('father');
    const motherRef        = getParentValue('mother');
    const familyName       = getFamilyNameValue() || null;
    const fatherFamilyName = getParentFamilyName('father') || familyName;
    const motherFamilyName = getParentFamilyName('mother') || familyName;

    const uv = validateFullName(userName);
    if (!uv.valid) { showError('contributeErrorMsg', `Your name: ${uv.message}`); return; }

    if (!familyName) {
        showError('contributeErrorMsg', '⚠️ Family name is required. Please select an existing family or type a new one.');
        return;
    }

    if (fatherRef && motherRef) {
        const gv = await validateParentsGeneration(fatherRef, motherRef);
        if (!gv.valid) { showError('contributeErrorMsg', gv.message); return; }
    }

    showSuccess('contributeSuccessMsg', 'Adding to the family tree…');

    try {
        // Assign color first so it's ready before any person is written
        if (familyName) await assignColorForFamily(familyName);

        // Add father and mother without intermediate reloads.
        // addOrGetPerson now returns a local object immediately after the DB write.
        let parentIds = [];
        if (fatherRef) {
            const father = await addOrGetPerson(fatherRef, 'male', fatherFamilyName);
            if (father) parentIds.push(father.id);
        }
        if (motherRef) {
            const mother = await addOrGetPerson(motherRef, 'female', motherFamilyName);
            if (mother) parentIds.push(mother.id);
        }

        // Add the child (the person filling the form)
        const uid = generateUID(), newId = makePersonId(userName, uid);
        const autoRoot = parentIds.length === 0;
        await addPersonToDB({
            id: newId, uid, name: userName, gender: userGender, dob: userDob,
            parents: JSON.stringify(parentIds),
            is_root: autoRoot,
            family_name: familyName
        });

        // Single reload after ALL three writes are done
        await loadPeople();
        personOwners[newId] = currentUser; savePersonOwners();

        let msg = `Added "${userName}" [#${uid}]`;
        if (fatherRef) msg += ` · Father: ${fatherRef.name}`;
        if (motherRef) msg += ` · Mother: ${motherRef.name}`;
        if (familyName) msg += ` · Family: ${familyName}`;

        document.getElementById('contributeForm').reset();
        ['fatherName','motherName'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        ['fatherSelect','motherSelect'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        if (fatherMode === 'select') toggleParentMode('father');
        if (motherMode === 'select') toggleParentMode('mother');
        const fnInp = document.getElementById('familyNameInput');
        const fnSel = document.getElementById('familyNameSelect');
        if (fnInp) fnInp.value = '';
        if (fnSel) fnSel.value = '';
        // Reset parent family name fields
        ['father','mother'].forEach(p => {
            const pi = document.getElementById(`${p}FamilyNameInput`);
            const ps = document.getElementById(`${p}FamilyNameSelect`);
            const pm = document.getElementById(`${p}FamilyNameMode`);
            if (pi) pi.value = '';
            if (ps) ps.value = '';
            // Return to manual (text) mode
            if (pm && pm.value === 'existing') toggleParentFamilyMode(p);
        });

        showSuccess('contributeSuccessMsg', msg);
        if (isAdmin) await updateAdminPanel();
    } catch(e) { showError('contributeErrorMsg', `Failed: ${e.message}`); }
}

// ==============================================================
// EXPORT
// ==============================================================
function exportToSpreadsheet() {
    if (!FAMILY_DB.people.length) { showError('contributeErrorMsg', 'No data to export.'); return; }
    const clusters = findFamilyClusters();

    const getFather = p => { for (const pid of getParentsArray(p)) { const x = findPersonById(pid); if (x?.gender==='male') return x.name; } return ''; };
    const getMother = p => { for (const pid of getParentsArray(p)) { const x = findPersonById(pid); if (x?.gender==='female') return x.name; } return ''; };
    const getChildren = p => FAMILY_DB.people.filter(x => getParentsArray(x).includes(p.id)).map(x=>x.name).sort().join('; ');

    let rows = ['# ANCESTRAL THREADS - FAMILY TREE EXPORT', `# Generated: ${new Date().toLocaleString()}`, `# Total Families: ${clusters.length}`, `# Total Members: ${FAMILY_DB.people.length}`, ''];

    clusters.forEach((cluster, ci) => {
        const letter = String.fromCharCode(65+ci), fn = clusterFamilyName(cluster);
        rows.push(`"=== FAMILY ${letter}: ${fn} (${cluster.length} members) ==="`);
        rows.push('"Generation","Full Name","Unique ID","Family Name","Root?","Gender","Date of Birth","Father","Mother","Children"');

        const sorted = [...cluster].sort((a,b) => { const d = getPersonGenerationLevel(a)-getPersonGenerationLevel(b); return d||a.name.localeCompare(b.name); });
        let lastGen = null;
        sorted.forEach(person => {
            const gen = getPersonGenerationLevel(person)+1;
            if (lastGen !== null && gen !== lastGen) rows.push('');
            lastGen = gen;
            rows.push(`"Gen ${gen}","${person.name}","#${person.uid||person.id}","${person.family_name||''}","${isRootPerson(person)?'Yes':'No'}","${person.gender||''}","${person.dob||''}","${getFather(person)}","${getMother(person)}","${getChildren(person)}"`);
        });
        rows.push('','');
    });

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `family_tree_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    showSuccess('contributeSuccessMsg', `Exported ${FAMILY_DB.people.length} members!`);
}

// ==============================================================
// ADMIN PANEL
// ==============================================================
async function updateAdminPanel() {
    if (!isAdmin) return;
    await loadPeople();
    document.getElementById('totalPeopleCount').textContent = FAMILY_DB.people.length;
    let maxDepth = 0;
    FAMILY_DB.people.forEach(p => { maxDepth = Math.max(maxDepth, getPersonGenerationLevel(p)); });
    document.getElementById('totalGenerations').textContent  = maxDepth + 1;
    document.getElementById('totalContributors').textContent = FAMILY_DB.people.length;

    document.getElementById('namesGrid').innerHTML = FAMILY_DB.people.map(person => {
        const bg = getColorForFamily(person.family_name);
        const tx = getTextColor(bg);
        return `<div class="name-item">
            <div>
                <strong>${escapeHtml(person.name)}</strong>
                <span style="font-size:0.65rem;color:#b08052;margin-left:0.3rem;">#${person.uid||''}</span>
                ${person.family_name ? `<span style="background:${bg};color:${tx};font-size:0.6rem;padding:0.1rem 0.4rem;border-radius:0.5rem;margin-left:0.3rem;">${escapeHtml(person.family_name)}</span>` : ''}
                ${isRootPerson(person) ? '<span style="font-size:0.6rem;color:#856404;margin-left:0.3rem;">👑 root</span>' : ''}
                <br><small>DOB: ${person.dob||'Not set'} · Owner: ${personOwners[person.id]||'Unknown'}</small>
            </div>
            <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                <button class="delete-btn" onclick="deletePersonHandler('${person.id}')">🗑️ Delete</button>
            </div>
        </div>`;
    }).join('');
}

window.toggleRootHandler = async function(personId) {
    if (!isAdmin) { alert('Admins only.'); return; }
    const p = findPersonById(personId); if (!p) return;
    try { await updatePersonInDB(personId, { is_root: !isRootPerson(p) }); await updateAdminPanel(); }
    catch(e) { alert(`Failed: ${e.message}`); }
};

window.deletePersonHandler = async function(personId) {
    if (!isAdmin) { alert('Admins only.'); return; }
    const p = findPersonById(personId); if (!p) return;
    if (confirm(`Delete "${p.name}" [#${p.uid||''}]? This removes them from all relationships.`)) {
        try { await deletePersonFromDB(personId); await updateAdminPanel(); alert('Deleted.'); }
        catch(e) { alert(`Failed: ${e.message}`); }
    }
};

// ==============================================================
// AUTH
// ==============================================================
function checkAuth() {
    currentUser = sessionStorage.getItem('currentUser');
    isAdmin     = sessionStorage.getItem('isAdmin') === 'true';
    if (!currentUser) { window.location.href = 'login.html'; return false; }
    document.getElementById('usernameDisplay').textContent = currentUser;
    if (isAdmin) {
        document.getElementById('adminBadge').style.display  = 'inline-block';
        document.getElementById('adminTabBtn').style.display = 'block';
    }
    return true;
}
function logout() { sessionStorage.clear(); window.location.href = 'login.html'; }

// ==============================================================
// EVENT LISTENERS & INIT
// ==============================================================
function setupEventListeners() {
    document.getElementById('logoutBtn').addEventListener('click', logout);

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${tabName}Tab`).classList.add('active');
            // Auto-render whole tree when tab is clicked
            if (tabName === 'wholetree') renderWholeFamilyTree();
        });
    });

    document.getElementById('contributeForm').addEventListener('submit', contributeToTree);

    document.getElementById('userDob')?.addEventListener('click', function() { this.showPicker(); });

    document.getElementById('searchLineageForm').addEventListener('submit', e => {
        e.preventDefault();
        handleLineageSearch(document.getElementById('searchLineageName').value);
    });

    document.getElementById('exportLineageBtn')?.addEventListener('click', exportToSpreadsheet);
    document.getElementById('exportWholeTreeBtn')?.addEventListener('click', exportToSpreadsheet);
}

async function init() {
    if (!checkAuth()) return;
    try {
        await ensurePlaceholderExists();
        await loadFamilyColors();
        await loadPeople();
        if (isAdmin) await updateAdminPanel();
        console.log('✅ App initialized —', FAMILY_DB.people.length, 'people,', Object.keys(FAMILY_COLORS).length, 'family colors');
    } catch(e) {
        console.error('Init error:', e);
        ['lineageContainer','wholeTreeContainer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#c33;font-size:0.85rem;">
                ❌ Failed to load: ${e.message}<br><br>
                <button onclick="location.reload()" class="submit-btn" style="margin-top:0.5rem;">🔄 Retry</button>
            </div>`;
        });
    }
}

window.toggleParentMode = toggleParentMode;
setupEventListeners();
init();