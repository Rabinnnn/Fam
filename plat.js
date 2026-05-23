// ==============================================================
// SUPABASE CONFIGURATION
// ==============================================================
const SUPABASE_URL = 'https://snkcdsfzxjruxhwxnoxh.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_-IHen1e8xLiVH9_mJBpKmA_0GQSRFJx';

let currentUser = null;
let isAdmin = false;
let FAMILY_DB = { people: [] };

let fatherMode = 'manual';
let motherMode = 'manual';

let personOwners = {};

// ==============================================================
// UNIQUE ID GENERATION
// Returns a short random alphanumeric string, e.g. "a3f9k"
// ==============================================================
function generateUID() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let uid = '';
    for (let i = 0; i < 5; i++) {
        uid += chars[Math.floor(Math.random() * chars.length)];
    }
    return uid;
}

// Build a DB-safe record ID from a name + uid
// e.g. "John Smith" + "a3f9k" → "john_smith_a3f9k"
function makePersonId(name, uid) {
    const base = name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
    return `${base}_${uid}`;
}

// ==============================================================
// PERSISTENCE HELPERS
// ==============================================================
function loadPersonOwners() {
    const saved = localStorage.getItem('person_owners');
    if (saved) personOwners = JSON.parse(saved);
}

function savePersonOwners() {
    localStorage.setItem('person_owners', JSON.stringify(personOwners));
}

// ==============================================================
// UI HELPERS
// ==============================================================
function showError(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = `❌ ${message}`;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 5000);
    }
    console.error('ERROR:', message);
}

function showSuccess(elementId, message) {
    const el = document.getElementById(elementId);
    if (el) {
        el.textContent = `✅ ${message}`;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 3000);
    }
    console.log('SUCCESS:', message);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, m => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[m]);
}

// ==============================================================
// VALIDATION
// ==============================================================
function validateFullName(name) {
    const trimmed = name.trim();
    if (!trimmed) return { valid: false, message: 'Name cannot be empty' };
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) return { valid: false, message: 'Please enter both first and last name' };
    if (parts.length > 5) return { valid: false, message: 'Name seems too long. Please enter a valid name.' };
    return { valid: true, message: '' };
}

// ==============================================================
// PARENT DROPDOWN HELPERS
// ==============================================================
function populateParentDropdowns() {
    const fatherSelect = document.getElementById('fatherSelect');
    const motherSelect = document.getElementById('motherSelect');
    if (!fatherSelect || !motherSelect) return;

    // Sort people alphabetically by display name
    const sorted = [...FAMILY_DB.people].sort((a, b) =>
        (a.name || '').localeCompare(b.name || ''));

    fatherSelect.innerHTML = '<option value="">-- Select Father from existing records --</option>';
    motherSelect.innerHTML = '<option value="">-- Select Mother from existing records --</option>';

    sorted.forEach(person => {
        const label = person.uid ? `${person.name} [#${person.uid}]` : person.name;

        const fo = document.createElement('option');
        fo.value = person.id;        // store DB id, not name
        fo.textContent = label;
        fatherSelect.appendChild(fo);

        const mo = document.createElement('option');
        mo.value = person.id;
        mo.textContent = label;
        motherSelect.appendChild(mo);
    });
}

function toggleParentMode(parent) {
    const sel = document.getElementById(`${parent}Select`);
    const inp = document.getElementById(`${parent}Name`);
    const btn = document.querySelector(`#${parent}Container .toggle-mode-btn`);
    const ind = document.getElementById(`${parent}ModeIndicator`);

    const currentMode = parent === 'father' ? fatherMode : motherMode;

    if (currentMode === 'manual') {
        sel.style.display = 'block';
        inp.style.display = 'none';
        inp.value = '';
        btn.textContent = '✏️ Enter Manually';
        ind.innerHTML = '📋 Select mode - choose from existing records';
        if (parent === 'father') fatherMode = 'select';
        else motherMode = 'select';
    } else {
        sel.style.display = 'none';
        inp.style.display = 'block';
        sel.value = '';
        btn.textContent = '📋 Use Existing';
        ind.innerHTML = '✏️ Manual entry mode (type any name)';
        if (parent === 'father') fatherMode = 'manual';
        else motherMode = 'manual';
    }
}

// Returns { id, name } for the selected/typed parent, or null
function getParentValue(parent) {
    const mode = parent === 'father' ? fatherMode : motherMode;
    if (mode === 'select') {
        const selectEl = document.getElementById(`${parent}Select`);
        const selectedId = selectEl.value;
        if (!selectedId) return null;
        const person = FAMILY_DB.people.find(p => p.id === selectedId);
        return person ? { id: person.id, name: person.name } : null;
    } else {
        const raw = document.getElementById(`${parent}Name`).value.trim();
        if (!raw) return null;
        return { id: null, name: raw }; // id resolved later
    }
}

// ==============================================================
// SUPABASE API CALLS
// ==============================================================
async function loadPeople() {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/people?select=*`, {
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const data = await response.json();
    FAMILY_DB.people = data;
    populateParentDropdowns();
    loadPersonOwners();
    return data;
}

async function addPersonToDB(person) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/people`, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
        },
        body: JSON.stringify(person)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    if (!personOwners[person.id]) {
        personOwners[person.id] = currentUser;
        savePersonOwners();
    }
    return true;
}

async function updatePersonInDB(personId, updates) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/people?id=eq.${personId}`, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(updates)
    });
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    return true;
}

async function deletePersonFromDB(personId) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/people?id=eq.${personId}`, {
        method: 'DELETE',
        headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
        }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    delete personOwners[personId];
    savePersonOwners();
    return true;
}

// ==============================================================
// LOOKUP HELPERS
// ==============================================================
function findPersonById(id) {
    return FAMILY_DB.people.find(p => p.id === id) || null;
}

// Finds by exact name match — returns ALL matches (for disambiguation display)
function findPeopleByName(name) {
    const lower = name.trim().toLowerCase();
    return FAMILY_DB.people.filter(p => p.name.trim().toLowerCase() === lower);
}

// For search: exact first, then partial
function findPersonByPartialName(searchTerm) {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return null;
    const exact = FAMILY_DB.people.find(p => p.name.toLowerCase() === term);
    if (exact) return exact;
    const partial = FAMILY_DB.people.filter(p => p.name.toLowerCase().includes(term));
    return partial.length > 0 ? partial[0] : null;
}

// Returns all people whose name contains searchTerm (for disambiguation)
function findAllByPartialName(searchTerm) {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    return FAMILY_DB.people.filter(p => p.name.toLowerCase().includes(term));
}

function canEditPerson(personId) {
    return isAdmin || personOwners[personId] === currentUser;
}

// ==============================================================
// GENERATION / ANCESTRY HELPERS
// ==============================================================
function getParentsArray(person) {
    if (!person || !person.parents) return [];
    try {
        const arr = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
        return Array.isArray(arr) ? arr : [];
    } catch { return []; }
}

function getAncestors(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return [];
    visited.add(person.id);
    let result = [person];
    for (const pid of getParentsArray(person)) {
        const par = findPersonById(pid);
        if (par) result = result.concat(getAncestors(par, visited));
    }
    return result;
}

function getDescendants(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return [];
    visited.add(person.id);
    let result = [person];
    const children = FAMILY_DB.people.filter(p =>
        getParentsArray(p).includes(person.id));
    for (const child of children) {
        result = result.concat(getDescendants(child, visited));
    }
    return result;
}

function getGenerationDepth(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return 0;
    visited.add(person.id);
    let maxDepth = 0;
    for (const pid of getParentsArray(person)) {
        const par = findPersonById(pid);
        if (par) maxDepth = Math.max(maxDepth, getGenerationDepth(par, visited) + 1);
    }
    return maxDepth;
}

function getPersonGenerationLevel(person) {
    let depth = 0;
    let current = person;
    const seen = new Set();
    while (current) {
        if (seen.has(current.id)) break;
        seen.add(current.id);
        const parents = getParentsArray(current);
        if (parents.length === 0) break;
        depth++;
        current = findPersonById(parents[0]);
    }
    return depth;
}

async function validateParentsGeneration(fatherRef, motherRef) {
    if (!fatherRef || !motherRef) return { valid: true, message: '' };
    const fatherPerson = fatherRef.id ? findPersonById(fatherRef.id) : findPeopleByName(fatherRef.name)[0];
    const motherPerson = motherRef.id ? findPersonById(motherRef.id) : findPeopleByName(motherRef.name)[0];
    if (!fatherPerson || !motherPerson) return { valid: true, message: '' };
    const fg = getPersonGenerationLevel(fatherPerson);
    const mg = getPersonGenerationLevel(motherPerson);
    if (fg !== mg) {
        return {
            valid: false,
            message: `Generation mismatch: "${fatherPerson.name}" is in generation ${fg + 1}, but "${motherPerson.name}" is in generation ${mg + 1}. Parents must be from the SAME generation.`
        };
    }
    return { valid: true, message: '' };
}

// ==============================================================
// CLUSTER / FAMILY GROUP DETECTION
// ==============================================================
function findFamilyClusters() {
    const adjacency = new Map();
    FAMILY_DB.people.forEach(p => adjacency.set(p.id, new Set()));

    FAMILY_DB.people.forEach(person => {
        for (const pid of getParentsArray(person)) {
            if (adjacency.has(pid)) {
                adjacency.get(pid).add(person.id);
                adjacency.get(person.id).add(pid);
            }
        }
    });

    // Link by shared family_group
    const groupMap = new Map();
    FAMILY_DB.people.forEach(person => {
        if (person.family_group) {
            if (!groupMap.has(person.family_group)) groupMap.set(person.family_group, []);
            groupMap.get(person.family_group).push(person.id);
        }
    });
    groupMap.forEach(ids => {
        for (let i = 0; i < ids.length - 1; i++) {
            if (adjacency.has(ids[i]) && adjacency.has(ids[i + 1])) {
                adjacency.get(ids[i]).add(ids[i + 1]);
                adjacency.get(ids[i + 1]).add(ids[i]);
            }
        }
    });

    const visited = new Set();
    const clusters = [];

    for (const person of FAMILY_DB.people) {
        if (!visited.has(person.id)) {
            const cluster = [];
            const queue = [person.id];
            visited.add(person.id);
            while (queue.length) {
                const cid = queue.shift();
                const cp = findPersonById(cid);
                if (cp) cluster.push(cp);
                for (const nid of (adjacency.get(cid) || [])) {
                    if (!visited.has(nid)) { visited.add(nid); queue.push(nid); }
                }
            }
            if (cluster.length) clusters.push(cluster);
        }
    }
    return clusters;
}

function clusterFamilyName(cluster) {
    const roots = cluster.filter(p => getParentsArray(p).length === 0);
    const base = roots.length > 0 ? roots[0] : cluster[0];
    if (!base || !base.name) return 'Unknown Family';
    const parts = base.name.split(' ');
    return parts[parts.length - 1] + ' Family';
}

// ==============================================================
// DISAMBIGUATION MODAL
// Shows when multiple people share the same search name
// ==============================================================
function showDisambiguationModal(matches, onSelect) {
    const existing = document.getElementById('disambigModal');
    if (existing) existing.remove();

    const items = matches.map(p => `
        <div onclick="disambigSelect('${p.id}')"
             style="padding:0.6rem 0.8rem;border-radius:0.5rem;background:#fef7ed;
                    border:1px solid #e7cfb0;cursor:pointer;margin-bottom:0.4rem;">
            <strong>${escapeHtml(p.name)}</strong>
            <span style="font-size:0.65rem;color:#b08052;margin-left:0.5rem;">#${p.uid || p.id}</span>
            ${p.dob ? `<span style="font-size:0.7rem;color:#888;margin-left:0.5rem;">b. ${p.dob}</span>` : ''}
        </div>
    `).join('');

    const html = `
        <div id="disambigModal" style="position:fixed;top:0;left:0;right:0;bottom:0;
             background:rgba(0,0,0,0.5);display:flex;align-items:center;
             justify-content:center;z-index:10000;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;
                        max-width:400px;width:90%;max-height:80vh;overflow-y:auto;">
                <h3 style="margin-bottom:0.75rem;">Multiple matches found</h3>
                <p style="font-size:0.8rem;color:#666;margin-bottom:1rem;">
                    Several people share this name. Please select the one you mean:
                </p>
                ${items}
                <button onclick="document.getElementById('disambigModal').remove()"
                        style="margin-top:0.75rem;background:#6c757d;color:white;
                               border:none;border-radius:0.5rem;padding:0.5rem 1rem;
                               cursor:pointer;width:100%;">Cancel</button>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    window._disambigCallback = onSelect;
}

window.disambigSelect = function(personId) {
    const modal = document.getElementById('disambigModal');
    if (modal) modal.remove();
    if (window._disambigCallback) window._disambigCallback(personId);
};

// ==============================================================
// EDIT MODAL
// ==============================================================
function showEditModal(person) {
    const existing = document.getElementById('editModal');
    if (existing) existing.remove();

    const html = `
        <div id="editModal" style="position:fixed;top:0;left:0;right:0;bottom:0;
             background:rgba(0,0,0,0.5);display:flex;align-items:center;
             justify-content:center;z-index:10000;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;max-width:400px;width:90%;">
                <h3 style="margin-bottom:1rem;">✏️ Edit ${escapeHtml(person.name)}</h3>
                <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" id="editName" value="${escapeHtml(person.name)}"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                </div>
                <div class="form-group">
                    <label>Gender</label>
                    <select id="editGender" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                        <option value="male"    ${person.gender === 'male'    ? 'selected' : ''}>Male</option>
                        <option value="female"  ${person.gender === 'female'  ? 'selected' : ''}>Female</option>
                        <option value="other"   ${person.gender === 'other'   ? 'selected' : ''}>Other</option>
                        <option value="unknown" ${person.gender === 'unknown' ? 'selected' : ''}>Unknown</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" id="editDob" value="${person.dob || ''}"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;cursor:pointer;">
                </div>
                <div style="font-size:0.7rem;color:#888;margin-bottom:0.75rem;">
                    Unique ID: <strong>#${person.uid || person.id}</strong>
                </div>
                <div style="display:flex;gap:0.5rem;margin-top:1rem;">
                    <button onclick="saveEdit('${person.id}')" class="submit-btn" style="flex:1;">Save Changes</button>
                    <button onclick="closeEditModal()"
                            style="flex:1;background:#6c757d;color:white;border:none;border-radius:0.5rem;cursor:pointer;">
                        Cancel
                    </button>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', html);

    const editDob = document.getElementById('editDob');
    if (editDob) editDob.addEventListener('click', function() { this.showPicker(); });
}

window.saveEdit = async function(personId) {
    const newName   = document.getElementById('editName').value.trim();
    const newGender = document.getElementById('editGender').value;
    const newDob    = document.getElementById('editDob').value;

    if (!newName) { alert('Name cannot be empty'); return; }
    const validation = validateFullName(newName);
    if (!validation.valid) { alert(validation.message); return; }

    const updates = { name: newName, gender: newGender };
    if (newDob) updates.dob = newDob;

    try {
        await updatePersonInDB(personId, updates);
        await loadPeople();
        closeEditModal();
        showSuccess('contributeSuccessMsg', 'Person updated successfully!');
    } catch (error) {
        showError('contributeErrorMsg', `Failed to update: ${error.message}`);
    }
};

window.closeEditModal = function() {
    const modal = document.getElementById('editModal');
    if (modal) modal.remove();
};

window.handleNodeClick = async function(personId) {
    const person = findPersonById(personId);
    if (!person) return;
    if (canEditPerson(personId)) {
        showEditModal(person);
    } else {
        const owner = personOwners[personId] || 'another user';
        alert(`🔒 You cannot edit "${person.name}" because this record was added by ${owner}.`);
    }
};

// ==============================================================
// NODE HTML BUILDER (shared across views)
// ==============================================================
function buildNodeHtml(person, extraClass = '') {
    const canEdit = canEditPerson(person.id);
    const editIcon = canEdit ? ' ✏️' : ' 🔒';
    const uidBadge = person.uid ? `<span class="uid-badge">#${person.uid}</span>` : '';
    return `<div class="tree-node ${extraClass}"
                 onclick="handleNodeClick('${person.id}')">
                <strong>${escapeHtml(person.name)}</strong>${editIcon}
                ${uidBadge}
            </div>`;
}

// ==============================================================
// ╔══════════════════════════════════════════════╗
// ║  VIEW 1: LINEAGE (ancestors + descendants)  ║
// ╚══════════════════════════════════════════════╝
// ==============================================================
function renderLineageView(personId) {
    const container = document.getElementById('lineageContainer');
    const titleEl   = document.getElementById('lineageTitle');

    const person = findPersonById(personId);
    if (!person) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">
            🍂 Person not found. Try searching again.</div>`;
        return;
    }

    // ── Collect ancestors (upward) ──
    const ancestorsRaw = getAncestors(person);
    const uniqueAncestors = [];
    const seenA = new Set();
    for (const a of ancestorsRaw) {
        if (!seenA.has(a.id)) { seenA.add(a.id); uniqueAncestors.push(a); }
    }

    // ── Collect descendants (downward, excluding person themselves) ──
    const descendantsRaw = getDescendants(person);
    const uniqueDescendants = [];
    const seenD = new Set();
    seenD.add(person.id); // exclude self from desc list
    for (const d of descendantsRaw) {
        if (!seenD.has(d.id)) { seenD.add(d.id); uniqueDescendants.push(d); }
    }

    // ── Build ancestor generations (oldest first) ──
    // Depth relative to the searched person (person = depth 0)
    const depthMap = new Map();
    function computeAncestorDepth(p, depth) {
        if (!p) return;
        if (!depthMap.has(p.id) || depthMap.get(p.id) < depth) depthMap.set(p.id, depth);
        for (const pid of getParentsArray(p)) {
            const par = findPersonById(pid);
            if (par) computeAncestorDepth(par, depth + 1);
        }
    }
    computeAncestorDepth(person, 0);

    const ancestorGroupMap = new Map();
    for (const a of uniqueAncestors) {
        const d = depthMap.get(a.id) ?? 0;
        if (!ancestorGroupMap.has(d)) ancestorGroupMap.set(d, []);
        ancestorGroupMap.get(d).push(a);
    }
    // Sort depths descending so oldest generation renders first
    const ancestorDepths = Array.from(ancestorGroupMap.keys()).sort((a, b) => b - a);

    // ── Build descendant generations ──
    const descDepthMap = new Map();
    function computeDescDepth(p, depth) {
        if (!p) return;
        if (!descDepthMap.has(p.id) || descDepthMap.get(p.id) < depth) descDepthMap.set(p.id, depth);
        const children = FAMILY_DB.people.filter(c => getParentsArray(c).includes(p.id));
        for (const child of children) computeDescDepth(child, depth + 1);
    }
    computeDescDepth(person, 0);

    const descGroupMap = new Map();
    for (const d of uniqueDescendants) {
        const depth = descDepthMap.get(d.id) ?? 1;
        if (!descGroupMap.has(depth)) descGroupMap.set(depth, []);
        descGroupMap.get(depth).push(d);
    }
    const descDepths = Array.from(descGroupMap.keys()).sort((a, b) => a - b);

    // ── Render ──
    titleEl.innerHTML = `📜 Full Lineage of ${escapeHtml(person.name)}`;

    let html = `<div class="lineage-chain">`;

    // Ancestor rows (oldest → person)
    const totalAncestorGens = ancestorDepths.length;
    ancestorDepths.forEach((depth, idx) => {
        const level = ancestorGroupMap.get(depth);
        const genNum = totalAncestorGens - idx;
        const label = depth === 0
            ? `📍 ${escapeHtml(person.name)} (You)`
            : (idx === 0 ? `👴👵 Oldest Ancestors — Generation ${genNum}` : `📍 Generation ${genNum}`);

        html += `<div class="lineage-gen-block">
                    <div class="lineage-gen-label">${label}</div>
                    <div class="lineage-nodes-row">`;
        for (const member of level) {
            html += buildNodeHtml(member, member.id === person.id ? 'focused-node' : '');
        }
        html += `</div></div>`;

        if (idx < ancestorDepths.length - 1) {
            html += `<div class="lineage-connector">▼</div>`;
        }
    });

    // Descendant rows (children → grandchildren → …)
    if (descDepths.length > 0) {
        html += `<div class="lineage-connector">▼</div>`;
        descDepths.forEach((depth, idx) => {
            const level = descGroupMap.get(depth);
            const label = depth === 1
                ? `👶 Children`
                : `📍 Generation +${depth} (${depth === 2 ? 'Grandchildren' : depth === 3 ? 'Great-Grandchildren' : `Descendants`})`;

            html += `<div class="lineage-gen-block">
                        <div class="lineage-gen-label">${label}</div>
                        <div class="lineage-nodes-row">`;
            for (const member of level) {
                html += buildNodeHtml(member);
            }
            html += `</div></div>`;

            if (idx < descDepths.length - 1) {
                html += `<div class="lineage-connector">▼</div>`;
            }
        });
    }

    html += `</div>`;
    container.innerHTML = html;
}

// ── Lineage search handler ──
function handleLineageSearch(searchTerm) {
    const container  = document.getElementById('lineageContainer');
    const statusEl   = document.getElementById('lineageStatus');

    if (!searchTerm.trim()) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">
            🌱 Enter a name to see their full lineage.</div>`;
        return;
    }

    const matches = findAllByPartialName(searchTerm);
    if (matches.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">
            🍂 No records found for "${escapeHtml(searchTerm)}"<br><br>
            💡 Try contributing your family using the "Add Your Details" tab!</div>`;
        statusEl.textContent = '';
        return;
    }

    if (matches.length === 1) {
        statusEl.textContent = `🔍 Showing lineage for "${matches[0].name}"`;
        renderLineageView(matches[0].id);
    } else {
        // Multiple people with similar names — show disambiguation
        statusEl.textContent = `Multiple matches found for "${searchTerm}"`;
        showDisambiguationModal(matches, (chosenId) => {
            const chosen = findPersonById(chosenId);
            if (chosen) {
                statusEl.textContent = `🔍 Showing lineage for "${chosen.name}" [#${chosen.uid || chosen.id}]`;
                renderLineageView(chosenId);
            }
        });
    }
}

// ==============================================================
// ╔══════════════════════════════════════════════════════════╗
// ║  VIEW 2: WHOLE FAMILY TREE (div-based, relationship-    ║
// ║  aware — siblings on same row, parents above children)  ║
// ╚══════════════════════════════════════════════════════════╝
// ==============================================================

/**
 * Given a cluster of people, returns an ordered array of generation rows
 * where each row is grouped by shared parentage so that siblings always
 * appear together, and the ordering of rows reflects actual parent→child
 * relationships rather than just depth buckets.
 *
 * Returns: Array of rows, each row = Array of people (same generation level)
 * Rows are ordered oldest-first (roots at index 0).
 */
function buildWholeTreeRows(cluster) {
    // Assign each person a depth based on their longest ancestor chain
    // within this cluster only.
    const clusterIds = new Set(cluster.map(p => p.id));

    const depthCache = new Map();
    function depth(person) {
        if (depthCache.has(person.id)) return depthCache.get(person.id);
        const clusterParents = getParentsArray(person).filter(pid => clusterIds.has(pid));
        if (!clusterParents.length) {
            depthCache.set(person.id, 0);
            return 0;
        }
        const maxParentDepth = Math.max(
            ...clusterParents.map(pid => {
                const par = findPersonById(pid);
                return par ? depth(par) : 0;
            })
        );
        const d = maxParentDepth + 1;
        depthCache.set(person.id, d);
        return d;
    }

    cluster.forEach(p => depth(p));

    // Group by depth
    const byDepth = new Map();
    cluster.forEach(p => {
        const d = depthCache.get(p.id);
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d).push(p);
    });

    const maxDepth = Math.max(...Array.from(byDepth.keys()));
    const rows = [];

    for (let d = 0; d <= maxDepth; d++) {
        const row = byDepth.get(d) || [];

        // Sort within each row: group siblings together (same parent set),
        // then sort alphabetically within each sibling group.
        row.sort((a, b) => {
            const keyA = getParentsArray(a).slice().sort().join(',');
            const keyB = getParentsArray(b).slice().sort().join(',');
            if (keyA !== keyB) return keyA.localeCompare(keyB);
            return a.name.localeCompare(b.name);
        });

        rows.push(row);
    }

    return rows;
}

function renderWholeFamilyTree() {
    const container = document.getElementById('wholeTreeContainer');
    const titleEl   = document.getElementById('wholeTreeTitle');

    const clusters = findFamilyClusters();
    if (!clusters.length || clusters.every(c => !c.length)) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">
            🌱 Not enough data. Add more family members first.</div>`;
        return;
    }

    titleEl.innerHTML = `🌳 Whole Family Tree`;

    // Render a single cluster as a div-based flowchart
    function renderClusterHtml(cluster) {
        const rows = buildWholeTreeRows(cluster);
        let html = `<div class="generations-tree">`;

        rows.forEach((row, idx) => {
            if (!row.length) return;
            const genNum   = idx + 1;
            const genLabel = genNum === 1 ? '👴👵 Oldest Generation' : `📍 Generation ${genNum}`;

            html += `<div class="gen-label">${genLabel}</div>`;
            html += `<div class="generation">`;
            for (const member of row) {
                html += buildNodeHtml(member);
            }
            html += `</div>`;

            if (idx < rows.length - 1) {
                html += `<div class="connector-line">▼</div>`;
            }
        });

        html += `</div>`;
        return html;
    }

    if (clusters.length === 1) {
        container.innerHTML = renderClusterHtml(clusters[0]);
    } else {
        let fullHtml = `<div style="display:flex;flex-direction:column;gap:1rem;">`;
        clusters.forEach(cluster => {
            const familyName = clusterFamilyName(cluster);
            fullHtml += `
                <div class="family-separator">
                    <h3 class="family-heading">🏠 ${escapeHtml(familyName)} (${cluster.length} members)</h3>
                    ${renderClusterHtml(cluster)}
                </div>`;
        });
        fullHtml += `</div>`;
        container.innerHTML = fullHtml;
    }
}

// ==============================================================
// ╔══════════════════════════════════════════════════════════╗
// ║  VIEW 3: GENERATIONS (flat rows + ＋ Add button)        ║
// ╚══════════════════════════════════════════════════════════╝
// ==============================================================
function getFamilyTreeForCluster(cluster) {
    const savedDB  = FAMILY_DB;
    FAMILY_DB = { people: cluster };

    const roots = cluster.filter(p => {
        const parents = getParentsArray(p);
        return !parents || parents.length === 0;
    });

    let allMembers = new Set();
    for (const root of roots) {
        getDescendants(root).forEach(d => allMembers.add(d));
    }
    if (!allMembers.size) cluster.forEach(p => allMembers.add(p));

    const members = Array.from(allMembers);
    const depths  = new Map();
    let maxDepth  = 0;

    for (const p of members) {
        const d = getGenerationDepth(p);
        depths.set(p.id, d);
        maxDepth = Math.max(maxDepth, d);
    }

    const groups = new Map();
    for (const p of members) {
        const d = depths.get(p.id) || 0;
        if (!groups.has(d)) groups.set(d, []);
        groups.get(d).push(p);
    }

    const result = [];
    for (let i = 0; i <= maxDepth; i++) {
        if (groups.has(i)) result.push(groups.get(i));
    }

    FAMILY_DB = savedDB;
    return {
        generations: result,
        familyName:  clusterFamilyName(cluster),
        memberCount: members.length,
        depths
    };
}

function renderGenerationsView() {
    const container = document.getElementById('generationsContainer');
    const titleEl   = document.getElementById('generationsTitle');

    const clusters = findFamilyClusters();
    if (!clusters.length || clusters.every(c => !c.length)) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">
            🌱 Not enough data. Add more family members first.</div>`;
        return;
    }

    titleEl.innerHTML = `📊 Generations View (${clusters.length} family group${clusters.length > 1 ? 's' : ''})`;

    function renderCluster(cluster) {
        const family = getFamilyTreeForCluster(cluster);
        let html = `<div class="generations-tree">`;

        family.generations.forEach((level, idx) => {
            if (!level.length) return;
            const genNum = idx + 1;
            const genLabel = genNum === 1 ? '👴👵 Oldest Generation' : `📍 Generation ${genNum}`;

            html += `<div class="gen-label">${genLabel}</div>`;
            html += `<div class="generation" data-gen="${genNum}" data-depth="${idx}">`;
            for (const member of level) {
                html += buildNodeHtml(member);
            }
            // ＋ Add button
            const siblingIds = level.map(m => m.id).join(',');
            html += `<div class="tree-node add-gen-btn"
                          onclick="showAddAtGenerationModal(${genNum}, '${siblingIds}', ${idx})">＋ Add</div>`;
            html += `</div>`;

            if (idx < family.generations.length - 1) {
                html += `<div class="connector-line">▼</div>`;
            }
        });

        html += `</div>`;
        return { html, familyName: family.familyName, memberCount: family.memberCount };
    }

    if (clusters.length === 1) {
        const { html } = renderCluster(clusters[0]);
        container.innerHTML = html;
    } else {
        let fullHtml = `<div style="display:flex;flex-direction:column;gap:1rem;">`;
        clusters.forEach(cluster => {
            const { html, familyName, memberCount } = renderCluster(cluster);
            fullHtml += `
                <div class="family-separator">
                    <h3 class="family-heading">🏠 ${escapeHtml(familyName)} (${memberCount} members)</h3>
                    ${html}
                </div>`;
        });
        fullHtml += `</div>`;
        container.innerHTML = fullHtml;
    }
}

// ==============================================================
// ADD AT GENERATION MODAL (used by Generations view)
// ==============================================================
window.showAddAtGenerationModal = function(generationNumber, siblingIdsStr, depthIdx) {
    const existing = document.getElementById('addAtGenModal');
    if (existing) existing.remove();

    const html = `
        <div id="addAtGenModal" style="position:fixed;top:0;left:0;right:0;bottom:0;
             background:rgba(0,0,0,0.55);display:flex;align-items:center;
             justify-content:center;z-index:10000;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;max-width:380px;width:90%;">
                <h3 style="margin-bottom:0.25rem;">➕ Add to Generation ${generationNumber}</h3>
                <p style="font-size:0.8rem;color:#888;margin-bottom:1rem;">
                    This person will be placed in Generation ${generationNumber}.
                </p>
                <div class="form-group">
                    <label>Full Name *</label>
                    <input type="text" id="addAtGenName" placeholder="First Last"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;box-sizing:border-box;">
                </div>
                <div class="form-group" style="margin-top:0.75rem;">
                    <label>Date of Birth <span style="color:#aaa;font-weight:normal;">(optional)</span></label>
                    <input type="date" id="addAtGenDob"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;box-sizing:border-box;cursor:pointer;">
                </div>
                <div id="addAtGenError" style="color:#c33;font-size:0.82rem;margin-top:0.5rem;display:none;"></div>
                <div style="display:flex;gap:0.5rem;margin-top:1rem;">
                    <button onclick="submitAddAtGeneration(${generationNumber}, '${siblingIdsStr}', ${depthIdx})"
                            class="submit-btn" style="flex:1;">Add to Tree</button>
                    <button onclick="closeAddAtGenModal()"
                            style="flex:1;background:#6c757d;color:white;border:none;border-radius:0.5rem;cursor:pointer;padding:0.5rem;">
                        Cancel
                    </button>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
    const dobInput = document.getElementById('addAtGenDob');
    if (dobInput) dobInput.addEventListener('click', function() { this.showPicker(); });
};

window.closeAddAtGenModal = function() {
    const modal = document.getElementById('addAtGenModal');
    if (modal) modal.remove();
};

window.submitAddAtGeneration = async function(generationNumber, siblingIdsStr, depthIdx) {
    const name = document.getElementById('addAtGenName').value.trim();
    const dob  = document.getElementById('addAtGenDob').value;
    const errorDiv = document.getElementById('addAtGenError');

    const showModalError = (msg) => {
        errorDiv.textContent = '❌ ' + msg;
        errorDiv.style.display = 'block';
        setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
    };

    const nameValidation = validateFullName(name);
    if (!nameValidation.valid) return showModalError(nameValidation.message);

    const siblingIds = siblingIdsStr ? siblingIdsStr.split(',').filter(Boolean) : [];
    const uid  = generateUID();
    const newId = makePersonId(name, uid);

    try {
        if (depthIdx === 0) {
            let familyGroup = null;
            for (const sibId of siblingIds) {
                const sib = findPersonById(sibId);
                if (sib && sib.family_group) { familyGroup = sib.family_group; break; }
            }
            if (!familyGroup && siblingIds.length > 0) {
                familyGroup = `fg_${siblingIds[0]}`;
                for (const sibId of siblingIds) {
                    const sib = findPersonById(sibId);
                    if (sib && !sib.family_group) await updatePersonInDB(sibId, { family_group: familyGroup });
                }
            }

            const newPerson = { id: newId, uid, name, gender: 'unknown', dob: dob || null, parents: JSON.stringify([]), family_group: familyGroup };
            await addPersonToDB(newPerson);
            await loadPeople();

            // Wire up co-parent link if a shared child exists
            let anchorChild = null;
            for (const sibId of siblingIds) {
                anchorChild = FAMILY_DB.people.find(p => getParentsArray(p).includes(sibId));
                if (anchorChild) break;
            }
            if (anchorChild) {
                const childParents = getParentsArray(anchorChild);
                const updatedParents = [...new Set([...childParents, newId])];
                await updatePersonInDB(anchorChild.id, { parents: JSON.stringify(updatedParents) });
                await loadPeople();
            }

        } else {
            let inheritedParentIds = [];
            for (const sibId of siblingIds) {
                const sibling = findPersonById(sibId);
                if (sibling) {
                    const sibParents = getParentsArray(sibling);
                    if (sibParents.length) { inheritedParentIds = sibParents; break; }
                }
            }
            const newPerson = { id: newId, uid, name, gender: 'unknown', dob: dob || null, parents: JSON.stringify(inheritedParentIds) };
            await addPersonToDB(newPerson);
            await loadPeople();
        }

        personOwners[newId] = currentUser;
        savePersonOwners();

        closeAddAtGenModal();
        showSuccess('contributeSuccessMsg', `✅ "${name}" added to Generation ${generationNumber}!`);
        renderGenerationsView(); // refresh generations view

        if (isAdmin) await updateAdminPanel();

    } catch (err) {
        showModalError(`Failed to add: ${err.message}`);
    }
};

// ==============================================================
// CONTRIBUTE (Add to Tree)
// ==============================================================
async function addOrGetPerson(nameOrRef, gender = 'unknown') {
    // nameOrRef can be { id, name } or just a string
    if (!nameOrRef) return null;

    const isRef = typeof nameOrRef === 'object';
    const name  = isRef ? nameOrRef.name : nameOrRef;
    const existingId = isRef ? nameOrRef.id : null;

    if (existingId) {
        // Selected from dropdown — already in DB
        return findPersonById(existingId);
    }

    const validation = validateFullName(name);
    if (!validation.valid) { showError('contributeErrorMsg', validation.message); return null; }

    // Check for exact name match — if exists, return it (don't force duplicate)
    const exactMatches = findPeopleByName(name);
    if (exactMatches.length === 1) return exactMatches[0];

    // Multiple matches OR no match — create new with uid
    const uid   = generateUID();
    const newId = makePersonId(name, uid);
    const newPerson = { id: newId, uid, name, gender, parents: JSON.stringify([]) };

    try {
        await addPersonToDB(newPerson);
        await loadPeople();
        return findPersonById(newId);
    } catch (error) {
        console.error('Failed to add person:', error);
        return null;
    }
}

async function contributeToTree(event) {
    event.preventDefault();

    const userName   = document.getElementById('userFullName').value.trim();
    const userGender = document.getElementById('userGender').value;
    const userDob    = document.getElementById('userDob')?.value || null;

    const fatherRef  = getParentValue('father'); // { id, name } or null
    const motherRef  = getParentValue('mother');

    const userValidation = validateFullName(userName);
    if (!userValidation.valid) {
        showError('contributeErrorMsg', `Your name: ${userValidation.message}`);
        return;
    }

    if (!isAdmin && (!fatherRef || !motherRef)) {
        showError('contributeErrorMsg', '⚠️ Both father and mother names are required.');
        return;
    }

    if (fatherRef && motherRef) {
        const genVal = await validateParentsGeneration(fatherRef, motherRef);
        if (!genVal.valid) { showError('contributeErrorMsg', genVal.message); return; }
    }

    showSuccess('contributeSuccessMsg', 'Adding your information to the family tree...');

    try {
        let parentIds = [];

        if (fatherRef) {
            const fVal = validateFullName(fatherRef.name);
            if (!fVal.valid) { showError('contributeErrorMsg', `Father's name: ${fVal.message}`); return; }
            const father = await addOrGetPerson(fatherRef, 'male');
            if (father) parentIds.push(father.id);
        }

        if (motherRef) {
            const mVal = validateFullName(motherRef.name);
            if (!mVal.valid) { showError('contributeErrorMsg', `Mother's name: ${mVal.message}`); return; }
            const mother = await addOrGetPerson(motherRef, 'female');
            if (mother) parentIds.push(mother.id);
        }

        // Always create a new person with a unique uid — same names are allowed
        const uid   = generateUID();
        const newId = makePersonId(userName, uid);

        const newUser = {
            id:     newId,
            uid,
            name:   userName,
            gender: userGender,
            dob:    userDob,
            parents: JSON.stringify(parentIds)
        };

        await addPersonToDB(newUser);
        await loadPeople();

        personOwners[newId] = currentUser;
        savePersonOwners();

        let message = `Successfully added "${userName}" [#${uid}] to the family tree!`;
        if (fatherRef) message += ` 👨 Father: ${fatherRef.name}`;
        if (motherRef) message += ` 👩 Mother: ${motherRef.name}`;
        if (userDob)   message += ` 📅 Born: ${userDob}`;

        // Reset form
        document.getElementById('contributeForm').reset();
        ['fatherName','motherName'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        ['fatherSelect','motherSelect'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        if (fatherMode === 'select') toggleParentMode('father');
        if (motherMode === 'select') toggleParentMode('mother');

        showSuccess('contributeSuccessMsg', message);
        if (isAdmin) await updateAdminPanel();

    } catch (error) {
        showError('contributeErrorMsg', `Failed to add: ${error.message}. Please check your internet connection.`);
    }
}

// ==============================================================
// EXPORT
// ==============================================================
function exportToSpreadsheet() {
    if (!FAMILY_DB.people.length) {
        showError('contributeErrorMsg', 'No data to export.');
        return;
    }

    const clusters = findFamilyClusters();

    function getFatherName(person) {
        for (const pid of getParentsArray(person)) {
            const p = findPersonById(pid);
            if (p && p.gender === 'male') return p.name;
        }
        return '';
    }

    function getMotherName(person) {
        for (const pid of getParentsArray(person)) {
            const p = findPersonById(pid);
            if (p && p.gender === 'female') return p.name;
        }
        return '';
    }

    function getChildrenNames(person) {
        return FAMILY_DB.people
            .filter(p => getParentsArray(p).includes(person.id))
            .map(p => p.name)
            .sort()
            .join('; ');
    }

    let csvRows = [];
    csvRows.push('# ANCESTRAL THREADS - FAMILY TREE EXPORT');
    csvRows.push(`# Generated: ${new Date().toLocaleString()}`);
    csvRows.push(`# Total Families: ${clusters.length}`);
    csvRows.push(`# Total Members: ${FAMILY_DB.people.length}`);
    csvRows.push('');

    clusters.forEach((cluster, ci) => {
        const letter     = String.fromCharCode(65 + ci);
        const familyName = clusterFamilyName(cluster);

        csvRows.push(`"=== FAMILY ${letter}: ${familyName} (${cluster.length} members) ==="`);
        csvRows.push('"Generation","Full Name","Unique ID","Gender","Date of Birth","Father","Mother","Children"');

        const sortedMembers = [...cluster].sort((a, b) => {
            const ga = getPersonGenerationLevel(a);
            const gb = getPersonGenerationLevel(b);
            if (ga !== gb) return ga - gb;
            return a.name.localeCompare(b.name);
        });

        let lastGen = null;
        sortedMembers.forEach(person => {
            const gen     = getPersonGenerationLevel(person) + 1;
            const gender  = person.gender ? person.gender.charAt(0).toUpperCase() + person.gender.slice(1) : 'Unknown';
            const uid     = person.uid || person.id;
            const dob     = person.dob || '';
            const father  = getFatherName(person);
            const mother  = getMotherName(person);
            const children = getChildrenNames(person);

            if (lastGen !== null && gen !== lastGen) csvRows.push('');
            lastGen = gen;

            csvRows.push(`"Gen ${gen}","${person.name}","#${uid}","${gender}","${dob}","${father}","${mother}","${children}"`);
        });

        csvRows.push('');
        csvRows.push('');
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `family_tree_export_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    showSuccess('contributeSuccessMsg', `Exported ${FAMILY_DB.people.length} members across ${clusters.length} families!`);
}

// ==============================================================
// ADMIN PANEL
// ==============================================================
async function updateAdminPanel() {
    if (!isAdmin) return;
    await loadPeople();

    document.getElementById('totalPeopleCount').textContent = FAMILY_DB.people.length;

    let maxDepth = 0;
    FAMILY_DB.people.forEach(person => {
        const d = getPersonGenerationLevel(person);
        maxDepth = Math.max(maxDepth, d);
    });
    document.getElementById('totalGenerations').textContent   = maxDepth + 1;
    document.getElementById('totalContributors').textContent  = FAMILY_DB.people.length;

    const namesGrid = document.getElementById('namesGrid');
    namesGrid.innerHTML = FAMILY_DB.people.map(person => `
        <div class="name-item">
            <div>
                <strong>${escapeHtml(person.name)}</strong>
                <span style="font-size:0.65rem;color:#b08052;margin-left:0.3rem;">#${person.uid || ''}</span>
                <br>
                <small>ID: ${person.id} | DOB: ${person.dob || 'Not set'} | Owner: ${personOwners[person.id] || 'Unknown'}</small>
            </div>
            <button class="delete-btn" onclick="deletePersonHandler('${person.id}')">🗑️ Delete</button>
        </div>
    `).join('');
}

window.deletePersonHandler = async function(personId) {
    if (!isAdmin) { alert('Only administrators can delete records.'); return; }
    const person = findPersonById(personId);
    if (!person) return;
    if (confirm(`Are you sure you want to delete "${person.name}" [#${person.uid || ''}]? This will remove them from all family relationships.`)) {
        try {
            await deletePersonFromDB(personId);
            await updateAdminPanel();
            alert(`"${person.name}" deleted successfully!`);
        } catch (error) {
            alert(`Failed to delete: ${error.message}`);
        }
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

function logout() {
    sessionStorage.clear();
    window.location.href = 'login.html';
}

// ==============================================================
// DATE PICKER SETUP
// ==============================================================
function setupDatePickers() {
    const dobInput = document.getElementById('userDob');
    if (dobInput) dobInput.addEventListener('click', function() { this.showPicker(); });
}

// ==============================================================
// EVENT LISTENERS
// ==============================================================
function setupEventListeners() {
    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${tabName}Tab`).classList.add('active');
        });
    });

    // Contribute form
    document.getElementById('contributeForm').addEventListener('submit', contributeToTree);

    // ── Lineage tab ──
    document.getElementById('searchLineageForm').addEventListener('submit', (e) => {
        e.preventDefault();
        handleLineageSearch(document.getElementById('searchLineageName').value);
    });
    document.getElementById('exportLineageBtn').addEventListener('click', exportToSpreadsheet);

    // ── Whole tree tab ──
    document.getElementById('renderWholeTreeBtn').addEventListener('click', renderWholeFamilyTree);
    document.getElementById('exportWholeTreeBtn').addEventListener('click', exportToSpreadsheet);

    // ── Generations tab ──
    document.getElementById('renderGenerationsBtn').addEventListener('click', renderGenerationsView);
    document.getElementById('exportGenerationsBtn').addEventListener('click', exportToSpreadsheet);
}

// ==============================================================
// INIT
// ==============================================================
async function init() {
    if (!checkAuth()) return;

    try {
        await loadPeople();
        setupDatePickers();
        if (isAdmin) await updateAdminPanel();

        console.log('✅ App initialized with', FAMILY_DB.people.length, 'people');
    } catch (error) {
        console.error('Init error:', error);
        const containers = ['lineageContainer', 'wholeTreeContainer', 'generationsContainer'];
        containers.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = `
                <div style="text-align:center;padding:1.5rem;color:#c33;font-size:0.85rem;">
                    ❌ Failed to load data: ${error.message}<br><br>
                    <button onclick="location.reload()" class="submit-btn retry-btn">🔄 Retry</button>
                </div>`;
        });
    }
}

// Expose toggleParentMode globally (called via inline onclick in HTML)
window.toggleParentMode = toggleParentMode;

setupEventListeners();
init();