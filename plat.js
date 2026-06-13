// ==============================================================
// CONFIGURATION (MySQL via PHP API)
// ==============================================================
const API_BASE = './api.php';

let currentUser = null;
let isAdmin = false;
let FAMILY_DB = { people: [] };
let FAMILY_COLORS = {};
let personOwners = {};

const COLOR_PALETTE = [
    '#c2894b','#5a7abf','#6aaa6a','#c2607a','#8f6abf',
    '#bf9a3a','#3aabab','#bf5a3a','#7a8fbf','#7abf6a',
    '#bf3a7a','#3a7abf','#bfaa3a','#6abfbf','#bf6a3a',
    '#a06abf','#3abf7a','#bf3a3a','#3a6abf','#bf7a6a'
];

// ==============================================================
// HELPER FUNCTIONS
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

function loadPersonOwners() {
    const saved = localStorage.getItem('person_owners');
    if (saved) try { personOwners = JSON.parse(saved); } catch {}
}
function savePersonOwners() {
    localStorage.setItem('person_owners', JSON.stringify(personOwners));
}

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

function getColorForFamily(familyName) {
    if (!familyName) return '#e8dcc8';
    return FAMILY_COLORS[familyName] || '#e8dcc8';
}

function getTextColor(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
    return luminance > 0.55 ? '#3a2010' : '#fff8f0';
}

// ==============================================================
// SENTINEL VALUES
// __na__ = person has no known parent (existing placeholder)
// __nc__ = person is a childless root — used only for clustering
// Both are stripped from all depth/generation/ancestry calculations
// and never rendered in the tree.
// ==============================================================
const SENTINELS = new Set(['__na__', '__nc__']);

// ==============================================================
// API CALLS
// ==============================================================
async function apiFetch(path, options = {}) {
    let table = path.split('?')[0];
    let url = `${API_BASE}?table=${table}`;
    const match = path.match(/[?&]id=([^&]+)/);
    if (match) {
        url += `&id=${encodeURIComponent(match[1])}`;
    }
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    let responseText = await res.text();
    let data;
    try {
        data = JSON.parse(responseText);
    } catch (e) {
        console.error('API returned non-JSON:', responseText.substring(0, 200));
        throw new Error(`API error (${res.status}): ${responseText.substring(0, 100)}`);
    }
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}

async function loadPeople() {
    const data = await apiFetch('people');
    FAMILY_DB.people = data.filter(p => !p.id.startsWith('__'));
    populateFamilyNameDropdown();
    loadPersonOwners();
    refreshGenerationCache();
    return FAMILY_DB.people;
}

async function addPersonToDB(person) {
    await apiFetch('people', { method: 'POST', body: JSON.stringify(person) });
    if (!personOwners[person.id]) { personOwners[person.id] = currentUser; savePersonOwners(); }
    return true;
}

async function updatePersonInDB(personId, updates) {
    await apiFetch(`people?id=${encodeURIComponent(personId)}`, { method: 'PATCH', body: JSON.stringify(updates) });
    return true;
}

async function deletePersonFromDB(personId) {
    // First remove this person from all other people's parent lists
    await removePersonFromAllRelations(personId);
    // Then delete the person itself
    await apiFetch(`people?id=${encodeURIComponent(personId)}`, { method: 'DELETE' });
    delete personOwners[personId];
    savePersonOwners();
    return true;
}

async function removePersonFromAllRelations(personId) {
    const peopleToUpdate = FAMILY_DB.people.filter(p => {
        const parents = getRawParentsArray(p);
        return parents.includes(personId);
    });
    for (const p of peopleToUpdate) {
        let newParents = getRawParentsArray(p).filter(pid => pid !== personId);
        if (newParents.length === 0) {
            await updatePersonInDB(p.id, {
                parents: JSON.stringify([]),
                is_root: true
            });
        } else {
            await updatePersonInDB(p.id, {
                parents: JSON.stringify(newParents)
            });
        }
    }
}

async function loadFamilyColors() {
    try {
        const data = await apiFetch('family_colors');
        if (Array.isArray(data)) {
            data.forEach(row => {
                if (row.family_name && row.color) {
                    FAMILY_COLORS[row.family_name] = row.color;
                }
            });
            console.log(`✅ Loaded ${Object.keys(FAMILY_COLORS).length} family colors from DB`);
        }
    } catch(e) {
        console.warn('Could not load family colors, starting fresh:', e.message);
        FAMILY_COLORS = {};
    }
}

// ==============================================================
// FOOLPROOF COLOR ASSIGNMENT – GLOBAL UNIQUENESS
// ==============================================================
let _colorAssignLock = Promise.resolve();

async function assignColorForFamily(familyName) {
    if (!familyName) return null;
    if (FAMILY_COLORS[familyName]) return FAMILY_COLORS[familyName];
    _colorAssignLock = _colorAssignLock.then(() => _doAssignColor(familyName));
    return _colorAssignLock;
}

async function _doAssignColor(familyName) {
    if (FAMILY_COLORS[familyName]) return FAMILY_COLORS[familyName];
    let dbRows = [];
    try {
        dbRows = await apiFetch('family_colors');
        if (!Array.isArray(dbRows)) dbRows = [];
    } catch (e) {
        console.warn('assignColorForFamily: could not fetch DB colors, using local cache only', e);
    }
    for (const row of dbRows) {
        if (row.family_name && row.color && !FAMILY_COLORS[row.family_name]) {
            FAMILY_COLORS[row.family_name] = row.color;
        }
    }
    const dbMatch = dbRows.find(r => r.family_name === familyName);
    if (dbMatch?.color) {
        FAMILY_COLORS[familyName] = dbMatch.color;
        return dbMatch.color;
    }
    const usedColors = new Set(Object.values(FAMILY_COLORS).filter(Boolean));
    let newColor = COLOR_PALETTE.find(c => !usedColors.has(c));
    if (!newColor) {
        const allKnown = Object.keys(FAMILY_COLORS).sort();
        newColor = COLOR_PALETTE[allKnown.length % COLOR_PALETTE.length];
        console.warn(`⚠️ Palette exhausted. Cycling color ${newColor} for "${familyName}"`);
    }
    FAMILY_COLORS[familyName] = newColor;
    try {
        await apiFetch('family_colors', {
            method: 'POST',
            body: JSON.stringify({ family_name: familyName, color: newColor })
        });
        console.log(`🎨 Assigned ${newColor} to "${familyName}"`);
    } catch (e) {
        console.error(`Failed to persist color for "${familyName}":`, e);
        try {
            const retry = await apiFetch('family_colors');
            const found = Array.isArray(retry) && retry.find(r => r.family_name === familyName);
            if (found?.color) {
                FAMILY_COLORS[familyName] = found.color;
                return found.color;
            }
        } catch (_) {}
    }
    return newColor;
}

async function ensurePlaceholderExists() {
    try {
        const existing = FAMILY_DB.people.find(p => p.id === '__na__');
        if (!existing) {
            await addPersonToDB({
                id: '__na__', uid: '__na__', name: 'N/A',
                gender: 'unknown', parents: '[]',
                is_root: false, family_name: null
            });
            console.log('✅ __na__ placeholder created');
        }
    } catch(e) {
        console.warn('Could not create __na__ placeholder:', e.message);
    }
}

function renderLegend(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;
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
// CUSTOM AUTOCOMPLETE DROPDOWN
// ==============================================================
function setupAutocomplete(inputId, onSelectCallback) {
    const input = document.getElementById(inputId);
    const dropdownId = inputId === 'fatherName' ? 'fatherAutocomplete' : 'motherAutocomplete';
    const dropdown = document.getElementById(dropdownId);
    if (!input || !dropdown) return;

    let selectedIndex = -1;
    let currentSuggestions = [];

    function renderSuggestions(filterText) {
        const term = filterText.trim().toLowerCase();
        let matches = [];
        if (term.length === 0) {
            matches = FAMILY_DB.people.slice(0, 10);
        } else {
            matches = FAMILY_DB.people.filter(p => p.name.toLowerCase().includes(term));
        }
        currentSuggestions = matches;
        if (matches.length === 0) {
            dropdown.innerHTML = '<div class="autocomplete-item" style="color:#888;">No matches</div>';
        } else {
            dropdown.innerHTML = matches.map((p, idx) => `
                <div class="autocomplete-item ${idx === selectedIndex ? 'selected' : ''}" data-id="${p.id}" data-name="${escapeHtml(p.name)}" data-family="${escapeHtml(p.family_name || '')}">
                    ${escapeHtml(p.name)} ${p.family_name ? `<span style="color:#b08052;font-size:0.7rem;">[${escapeHtml(p.family_name)}]</span>` : ''}
                </div>
            `).join('');
        }
        dropdown.classList.add('show');
        dropdown.querySelectorAll('.autocomplete-item').forEach((item, idx) => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const name = item.getAttribute('data-name');
                const family = item.getAttribute('data-family');
                input.value = name;
                dropdown.classList.remove('show');
                if (onSelectCallback) onSelectCallback(name, family);
                input.focus();
            });
            item.addEventListener('mouseenter', () => {
                if (selectedIndex !== -1) dropdown.children[selectedIndex]?.classList.remove('selected');
                selectedIndex = idx;
                item.classList.add('selected');
            });
        });
        selectedIndex = -1;
    }

    function hideDropdown() {
        dropdown.classList.remove('show');
        selectedIndex = -1;
    }

    input.addEventListener('input', (e) => { renderSuggestions(e.target.value); });
    input.addEventListener('focus', () => { renderSuggestions(input.value); });
    input.addEventListener('blur', () => { setTimeout(() => hideDropdown(), 200); });
    input.addEventListener('keydown', (e) => {
        const items = dropdown.querySelectorAll('.autocomplete-item');
        if (items.length === 0) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selectedIndex < items.length - 1) {
                if (selectedIndex !== -1) items[selectedIndex].classList.remove('selected');
                selectedIndex++;
                items[selectedIndex].classList.add('selected');
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selectedIndex > 0) {
                items[selectedIndex].classList.remove('selected');
                selectedIndex--;
                items[selectedIndex].classList.add('selected');
                items[selectedIndex].scrollIntoView({ block: 'nearest' });
            } else if (selectedIndex === 0) {
                items[0].classList.remove('selected');
                selectedIndex = -1;
            }
        } else if (e.key === 'Enter') {
            if (selectedIndex >= 0 && selectedIndex < items.length) {
                e.preventDefault();
                const selectedItem = items[selectedIndex];
                const name = selectedItem.getAttribute('data-name');
                const family = selectedItem.getAttribute('data-family');
                input.value = name;
                hideDropdown();
                if (onSelectCallback) onSelectCallback(name, family);
            }
        } else if (e.key === 'Escape') {
            hideDropdown();
        }
    });
}

function onPersonAutocomplete(name, family, targetFamilyInputId) {
    const familyInput = document.getElementById(targetFamilyInputId);
    if (familyInput && family) familyInput.value = family;
    else if (familyInput) familyInput.value = '';
}

// ==============================================================
// DATABASE LOOKUP HELPERS & GENERATION CACHE (SPOUSE-AWARE)
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

// Returns real parents only — strips ALL sentinel values
function getParentsArray(person) {
    if (!person?.parents) return [];
    try {
        const a = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
        return Array.isArray(a) ? a.filter(pid => !SENTINELS.has(pid)) : [];
    } catch { return []; }
}

// Returns raw parents including sentinels — used only where we need them
function getRawParentsArray(person) {
    if (!person?.parents) return [];
    try {
        const a = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
        return Array.isArray(a) ? a : [];
    } catch { return []; }
}

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

// ---------- SPOUSE INFERENCE & GENERATION CACHE ----------
let generationCache = new Map();

function buildSpouseMap() {
    const spouseMap = new Map();
    for (const p of FAMILY_DB.people) {
        // getParentsArray already strips sentinels
        const parents = getParentsArray(p);
        if (parents.length >= 2) {
            const [a, b] = parents;
            if (!spouseMap.has(a)) spouseMap.set(a, new Set());
            if (!spouseMap.has(b)) spouseMap.set(b, new Set());
            spouseMap.get(a).add(b);
            spouseMap.get(b).add(a);
        }
    }
    return spouseMap;
}

function computeGenerations() {
    const spouseMap = buildSpouseMap();
    const childrenMap = new Map();
    for (const p of FAMILY_DB.people) {
        // getParentsArray strips sentinels — only real parents used for depth
        for (const pid of getParentsArray(p)) {
            if (!childrenMap.has(pid)) childrenMap.set(pid, new Set());
            childrenMap.get(pid).add(p.id);
        }
    }

    const gen = new Map();
    const queue = [];

    // Roots: people with no real parents (sentinels don't count)
    for (const p of FAMILY_DB.people) {
        if (getParentsArray(p).length === 0) {
            gen.set(p.id, 0);
            queue.push(p.id);
        }
    }

    while (queue.length) {
        const pid = queue.shift();
        const currentGen = gen.get(pid);

        const children = childrenMap.get(pid) || new Set();
        for (const childId of children) {
            const targetGen = currentGen + 1;
            if (!gen.has(childId)) {
                gen.set(childId, targetGen);
                queue.push(childId);
            } else if (gen.get(childId) !== targetGen) {
                const newGen = Math.max(gen.get(childId), targetGen);
                gen.set(childId, newGen);
                queue.push(childId);
            }
        }

        const spouses = spouseMap.get(pid) || new Set();
        for (const spouseId of spouses) {
            if (!gen.has(spouseId)) {
                gen.set(spouseId, currentGen);
                queue.push(spouseId);
            } else if (gen.get(spouseId) !== currentGen) {
                const newGen = Math.max(gen.get(spouseId), currentGen);
                gen.set(spouseId, newGen);
                queue.push(spouseId);
            }
        }
    }

    for (const p of FAMILY_DB.people) {
        if (!gen.has(p.id)) gen.set(p.id, 0);
    }
    return gen;
}

function refreshGenerationCache() {
    generationCache = computeGenerations();
}

function getPersonGenerationLevel(person) {
    if (!person) return 0;
    if (!generationCache.has(person.id)) refreshGenerationCache();
    return generationCache.get(person.id) || 0;
}

// ==============================================================
// HELPER FUNCTIONS
// ==============================================================
function getParentValue(parent) {
    const inp = document.getElementById(`${parent}Name`);
    if (!inp) return null;
    const raw = inp.value.trim();
    if (!raw) return null;
    const matches = findPeopleByName(raw);
    if (matches.length === 1) {
        return { id: matches[0].id, name: matches[0].name };
    }
    return { id: null, name: raw };
}

function getParentFamilyName(parent) {
    return document.getElementById(`${parent}FamilyNameInput`)?.value.trim() || '';
}

function getFamilyNameValue() {
    return document.getElementById('familyNameInput')?.value.trim() || '';
}

function populateFamilyNameDropdown() {
    const dl = document.getElementById('dl-families');
    if (!dl) return;
    const families = [...new Set(FAMILY_DB.people.map(p => p.family_name).filter(Boolean))].sort();
    dl.innerHTML = '';
    families.forEach(fn => {
        const opt = document.createElement('option');
        opt.value = fn;
        dl.appendChild(opt);
    });
}

// ==============================================================
// TREE RENDERING & MODALS (WHOLE TREE)
// ==============================================================
function findFamilyClusters() {
    const adj = new Map();
    FAMILY_DB.people.forEach(p => adj.set(p.id, new Set()));

    // Edge type 1: real parent ↔ child (sentinels stripped by getParentsArray)
    FAMILY_DB.people.forEach(p => {
        for (const pid of getParentsArray(p)) {
            if (adj.has(pid)) {
                adj.get(pid).add(p.id);
                adj.get(p.id).add(pid);
            }
        }
    });

    // Edge type 2: __nc__ clustering
    // Anyone whose raw parents array contains '__nc__' is a childless root member
    // that was deliberately added to an existing tree. Link all such members
    // directly to each other so they share the same cluster.
    const ncMembers = FAMILY_DB.people
        .filter(p => getRawParentsArray(p).includes('__nc__'))
        .map(p => p.id);
    for (let i = 0; i < ncMembers.length; i++) {
        for (let j = i + 1; j < ncMembers.length; j++) {
            adj.get(ncMembers[i]).add(ncMembers[j]);
            adj.get(ncMembers[j]).add(ncMembers[i]);
        }
    }

    // Edge type 3: also link __nc__ members to any existing member
    // in the same generation row they were added to (via rowIds passed
    // at add time — we approximate this by linking each __nc__ member
    // to the first non-__nc__ root-generation person found in FAMILY_DB)
    if (ncMembers.length) {
        const firstRealRoot = FAMILY_DB.people.find(p =>
            !getRawParentsArray(p).includes('__nc__') &&
            getParentsArray(p).length === 0
        );
        if (firstRealRoot) {
            ncMembers.forEach(id => {
                adj.get(id).add(firstRealRoot.id);
                adj.get(firstRealRoot.id).add(id);
            });
        }
    }

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
    const gen0 = cluster.filter(p => getPersonGenerationLevel(p) === 0);

    const scored = gen0
        .filter(p => p.family_name)
        .map(p => ({
            p,
            score: getDescendants(p).length,
            dbIndex: FAMILY_DB.people.findIndex(x => x.id === p.id)
        }))
        .sort((a, b) => b.score - a.score || a.dbIndex - b.dbIndex);

    if (scored.length) return scored[0].p.family_name;

    const gen0sorted = [...gen0].sort((a, b) =>
        FAMILY_DB.people.findIndex(x => x.id === a.id) -
        FAMILY_DB.people.findIndex(x => x.id === b.id)
    );
    if (gen0sorted.length && gen0sorted[0].family_name) return gen0sorted[0].family_name;

    const roots = cluster.filter(isRootPerson).filter(p => p.family_name);
    if (roots.length) return roots[0].family_name;

    for (const p of cluster) { if (p.family_name) return p.family_name; }
    return 'Unknown Family';
}

function buildWholeTreeRows(cluster) {
    const clusterIds = new Set(cluster.map(p => p.id));
    const spouseMap = new Map();
    for (const p of cluster) {
        // getParentsArray strips sentinels
        const parents = getParentsArray(p).filter(pid => clusterIds.has(pid));
        if (parents.length >= 2) {
            const [a, b] = parents;
            if (!spouseMap.has(a)) spouseMap.set(a, new Set());
            if (!spouseMap.has(b)) spouseMap.set(b, new Set());
            spouseMap.get(a).add(b);
            spouseMap.get(b).add(a);
        }
    }

    const byDepth = new Map();
    for (const p of cluster) {
        const d = getPersonGenerationLevel(p);
        if (!byDepth.has(d)) byDepth.set(d, []);
        byDepth.get(d).push(p);
    }

    if (!byDepth.size) return [];
    const maxDepth = Math.max(...byDepth.keys());
    const rows = [];
    for (let d = 0; d <= maxDepth; d++) {
        const row = byDepth.get(d) || [];
        const paired = new Set();
        const sorted = [];
        for (const person of row) {
            if (paired.has(person.id)) continue;
            const spouses = spouseMap.get(person.id);
            if (spouses && spouses.size) {
                const spouseInRow = Array.from(spouses).find(sid => row.some(p => p.id === sid));
                if (spouseInRow && !paired.has(spouseInRow)) {
                    const spouseObj = row.find(p => p.id === spouseInRow);
                    sorted.push(person);
                    sorted.push(spouseObj);
                    paired.add(person.id);
                    paired.add(spouseObj.id);
                    continue;
                }
            }
            sorted.push(person);
            paired.add(person.id);
        }
        rows.push(sorted);
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
        // For the root generation (isOldest === true), show a clear message that ALL existing roots will become children
        if (isOldest) {
            section.innerHTML = `${aboveNote}
                <div class="form-group" style="margin-top:0.75rem; background:#e9f5ff; padding:0.6rem; border-radius:0.5rem;">
                    <strong>📌 This will make the new person the new root ancestor.</strong><br>
                    All existing members of the oldest generation (${genNum}) will automatically become children of the new person.
                </div>`;
        } else {
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
                </div>
                <div class="form-group" style="margin-top:0.75rem;">
                    <label>➕ Add new children (comma‑separated full names)</label>
                    <input type="text" id="wtNewChildrenNames" placeholder="e.g. John Smith, Jane Doe"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;">
                    <div style="font-size:0.68rem;color:#888;margin-top:0.25rem;">
                        New persons will be created with the same family name as the new person above.
                    </div>
                </div>`;
        }
    } else if (placement === 'within') {
        const allNameOpts = [...FAMILY_DB.people].sort((a,b) => a.name.localeCompare(b.name))
            .map(p => `<option value="${escapeHtml(p.name)}">`).join('');

        // --- FIX: Show ALL members of the generation directly below ---
        const targetGen = depthIdx + 1;
        const childrenBelow = FAMILY_DB.people.filter(p => getPersonGenerationLevel(p) === targetGen);
        const childrenHtml = childrenBelow.length
            ? childrenBelow.map(p => buildCheckboxRow(p, 'wt-child-link2')).join('')
            : '<div style="padding:0.5rem;color:#888;font-size:0.8rem;">No members in the generation below yet.</div>';
        // -------------------------------------------------------------

        section.innerHTML = `
            <div class="form-group" style="margin-top:0.75rem;">
                <label>Inherit parents from sibling <span style="color:#aaa;font-weight:normal;">(optional)</span></label>
                <select id="wtSiblingRef" style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;margin-bottom:0.4rem;">
                    <option value="">-- Auto-inherit from first sibling with parents --</option>${rowOpts}
                </select>
            </div>
            <div class="form-group">
                <label>Parent 1 <span style="color:#aaa;font-weight:normal;">(optional — select existing or type new name)</span></label>
                <input type="text" id="wtParent1Text" list="wtParent1List"
                    placeholder="Search or type full name"
                    style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;box-sizing:border-box;margin-bottom:0.4rem;">
                <datalist id="wtParent1List">${allNameOpts}</datalist>
            </div>
            <div class="form-group">
                <label>Parent 2 <span style="color:#aaa;font-weight:normal;">(optional — select existing or type new name)</span></label>
                <input type="text" id="wtParent2Text" list="wtParent2List"
                    placeholder="Search or type full name"
                    style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;box-sizing:border-box;margin-bottom:0.4rem;">
                <datalist id="wtParent2List">${allNameOpts}</datalist>
            </div>
            <div class="form-group">
                <label>Child(ren) <span style="color:#aaa;font-weight:normal;">(optional)</span></label>
                <div id="wtChildLink2Wrap"
                    style="border:1px solid #ccc;border-radius:0.5rem;padding:0.4rem 0.25rem;
                            max-height:160px;overflow-y:auto;background:white;">
                    ${childrenHtml}
                </div>
                <div style="font-size:0.68rem;color:#888;margin-top:0.25rem;">
                    All people in the generation directly below are shown. Tick those who will be children of the new person.
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
    const name       = document.getElementById('wtName').value.trim();
    const gender     = document.getElementById('wtGender').value;
    const dob        = document.getElementById('wtDob').value;
    const placement  = document.getElementById('wtPlacement').value;
    const fnSelect   = document.getElementById('wtFamilyNameSelect').value.trim();
    const fnInput    = document.getElementById('wtFamilyNameInput').value.trim();
    const familyName = fnSelect || fnInput || null;
    const errorDiv   = document.getElementById('wtError');

    const showErr = msg => { errorDiv.textContent = '❌ ' + msg; errorDiv.style.display = 'block'; setTimeout(() => { errorDiv.style.display = 'none'; }, 6000); };

    if (!placement) return showErr('Please choose a placement.');
    const nv = validateFullName(name); if (!nv.valid) return showErr(nv.message);
    if (familyName) await assignColorForFamily(familyName);

    const uid = generateUID(), newId = makePersonId(name, uid);

    try {
        if (placement === 'above') {
            if (isOldest) {
                // Original behaviour for root generation: all previous roots become children
                const allRootIds = rowIdsStr ? rowIdsStr.split(',').filter(Boolean) : [];
                if (allRootIds.length === 0) {
                    return showErr('No root members found to attach above.');
                }

                await addPersonToDB({
                    id: newId, uid, name, gender, dob: dob||null,
                    parents: JSON.stringify([]),
                    is_root: true,
                    family_name: familyName
                });

                for (const rootId of allRootIds) {
                    const rootPerson = FAMILY_DB.people.find(p => p.id === rootId);
                    if (!rootPerson) continue;
                    const updatedParents = [...new Set([...getParentsArray(rootPerson), newId])];
                    await updatePersonInDB(rootId, {
                        parents: JSON.stringify(updatedParents),
                        is_root: false
                    });
                }
            } else {
                // Non-root generation: selected children + new children
                const selectedChildren = Array.from(
                    document.querySelectorAll('.wt-above-child:checked') || []
                ).map(o => o.value).filter(Boolean);

                // New children from text input
                const newChildrenInput = document.getElementById('wtNewChildrenNames')?.value.trim() || '';
                const newChildNames = newChildrenInput.split(',').map(s => s.trim()).filter(s => s);
                const newChildIds = [];

                for (const childName of newChildNames) {
                    const childUid = generateUID();
                    const childId = makePersonId(childName, childUid);
                    await addPersonToDB({
                        id: childId, uid: childUid, name: childName,
                        gender: 'unknown', dob: null,
                        parents: JSON.stringify([newId]),
                        is_root: false,
                        family_name: familyName
                    });
                    newChildIds.push(childId);
                    personOwners[childId] = currentUser;
                }

                // Add the new person
                await addPersonToDB({
                    id: newId, uid, name, gender, dob: dob||null,
                    parents: JSON.stringify([]),
                    is_root: true,
                    family_name: familyName
                });

                // Link selected existing children
                for (const memberId of selectedChildren) {
                    const member = FAMILY_DB.people.find(p => p.id === memberId);
                    if (member) {
                        const updatedParents = [...new Set([...getParentsArray(member), newId])];
                        await updatePersonInDB(member.id, { parents: JSON.stringify(updatedParents), is_root: false });
                    }
                }

                // Handle unticked members (set __na__ as parent if no real parent)
                const allRowIds = rowIdsStr ? rowIdsStr.split(',').filter(Boolean) : [];
                const unselected = allRowIds.filter(id => !selectedChildren.includes(id));
                for (const uid2 of unselected) {
                    const member = FAMILY_DB.people.find(p => p.id === uid2);
                    if (!member) continue;
                    const existingParents = getParentsArray(member);
                    const hasRealParent = existingParents.some(pid => FAMILY_DB.people.find(p => p.id === pid));
                    if (!hasRealParent) {
                        await updatePersonInDB(uid2, { parents: JSON.stringify(['__na__']), is_root: false });
                    }
                }
            }

        } else if (placement === 'within') {
            const siblingRefId = document.getElementById('wtSiblingRef')?.value || '';
            const p1Text = document.getElementById('wtParent1Text')?.value.trim() || '';
            const p2Text = document.getElementById('wtParent2Text')?.value.trim() || '';

            const resolveParentText = async (text, gdr) => {
                if (!text) return null;
                const matches = findPeopleByName(text);
                if (matches.length >= 1) return matches[0];
                const v = validateFullName(text);
                if (!v.valid) return null;
                const nuid = generateUID(), nid = makePersonId(text, nuid);
                await addPersonToDB({ id: nid, uid: nuid, name: text, gender: gdr, parents: JSON.stringify([]), is_root: true, family_name: null });
                FAMILY_DB.people.push({ id: nid, uid: nuid, name: text, gender: gdr, parents: '[]', is_root: true, family_name: null });
                return { id: nid };
            };

            const parent1Obj = await resolveParentText(p1Text, 'male');
            const parent2Obj = await resolveParentText(p2Text, 'female');
            const p1 = parent1Obj?.id || '';
            const p2 = parent2Obj?.id || '';

            const childLinks = Array.from(
                document.querySelectorAll('.wt-child-link2:checked') || []
            ).map(o => o.value);

            // New children from text input
            const newChildrenInput = document.getElementById('wtNewChildrenNamesWithin')?.value.trim() || '';
            const newChildNames = newChildrenInput.split(',').map(s => s.trim()).filter(s => s);
            const newChildIds = [];

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

            // Add the new person (sibling)
            await addPersonToDB({
                id: newId, uid, name, gender, dob: dob||null,
                parents: JSON.stringify(parentIds),
                is_root: parentIds.length === 0,
                family_name: familyName
            });

            // Link specified existing children to new person
            for (const cid of childLinks) {
                const child = FAMILY_DB.people.find(p => p.id === cid);
                if (child) {
                    await updatePersonInDB(cid, {
                        parents: JSON.stringify([...new Set([...getParentsArray(child), newId])])
                    });
                }
            }

            // Create new children and link them to new person
            for (const childName of newChildNames) {
                const childUid = generateUID();
                const childId = makePersonId(childName, childUid);
                await addPersonToDB({
                    id: childId, uid: childUid, name: childName,
                    gender: 'unknown', dob: null,
                    parents: JSON.stringify([newId]),
                    is_root: false,
                    family_name: familyName
                });
                newChildIds.push(childId);
                personOwners[childId] = currentUser;
            }

            // If no parents and no children, root clustering logic (__na__) may apply
            if (childLinks.length === 0 && newChildIds.length === 0 && parentIds.length === 0) {
                const rowIds = rowIdsStr ? rowIdsStr.split(',').filter(Boolean) : [];
                const rowChildIds = [];
                for (const rid of rowIds) {
                    const rowChildren = FAMILY_DB.people.filter(p =>
                        getParentsArray(p).includes(rid)
                    );
                    for (const rc of rowChildren) {
                        if (!rowChildIds.includes(rc.id)) rowChildIds.push(rc.id);
                    }
                }
                if (rowChildIds.length) {
                    for (const cid of rowChildIds) {
                        const child = FAMILY_DB.people.find(p => p.id === cid);
                        if (child) {
                            await updatePersonInDB(cid, {
                                parents: JSON.stringify([...new Set([...getParentsArray(child), newId])])
                            });
                        }
                    }
                } else {
                    await updatePersonInDB(newId, { is_root: true });
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

        await loadPeople();
        personOwners[newId] = currentUser; savePersonOwners();
        closeWholeTreeAddModal();
        showSuccess('contributeSuccessMsg', `✅ "${name}" added to the tree!`);
        renderWholeFamilyTree();
        if (isAdmin) await updateAdminPanel();
    } catch(err) { showErr(`Failed: ${err.message}`); }
};

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

function buildNodeHtml(person, extraClass = '', onClick = null) {
    const bg = getColorForFamily(person.family_name);
    const tx = getTextColor(bg);
    const uid = person.uid ? `<span style="display:block;font-size:0.6rem;opacity:0.75;margin-top:0.1rem;">#${person.uid}</span>` : '';
    const handler = onClick || `handleNodeClick('${person.id}')`;
    return `<div class="tree-node ${extraClass}"
                 style="background:${bg};border-color:${bg};color:${tx};"
                 onclick="${handler}">
                <strong>${escapeHtml(person.name)}</strong>
                ${uid}
            </div>`;
}

// ==============================================================
// LINEAGE MODAL (with spouse pairing)
// ==============================================================
function buildLineageHtml(person) {
    if (!person) return '<div>Person not found</div>';
    const familyName = person.family_name;
    if (!familyName) {
        return `<div style="text-align:center;padding:1rem;">⚠️ This person has no family name. Lineage view requires a family name to filter by.</div>`;
    }

    // Helper: get ancestors with same family name (direct line)
    function getDirectAncestors(p, visited = new Set()) {
        if (!p || visited.has(p.id)) return [];
        visited.add(p.id);
        const result = [];
        const parents = getParentsArray(p).map(pid => findPersonById(pid)).filter(Boolean);
        // Only keep parents with same family name
        const sameFamilyParents = parents.filter(par => par.family_name === familyName);
        for (const parent of sameFamilyParents) {
            result.push(parent);
            result.push(...getDirectAncestors(parent, visited));
        }
        return result;
    }

    // Helper: get descendants with same family name (direct line)
    function getDirectDescendants(p, visited = new Set()) {
        if (!p || visited.has(p.id)) return [];
        visited.add(p.id);
        const result = [];
        const children = FAMILY_DB.people.filter(child => getParentsArray(child).includes(p.id));
        // Only keep children with same family name
        const sameFamilyChildren = children.filter(child => child.family_name === familyName);
        for (const child of sameFamilyChildren) {
            result.push(child);
            result.push(...getDirectDescendants(child, visited));
        }
        return result;
    }

    // Get unique ancestors and descendants
    const rawAncestors = getDirectAncestors(person);
    const uniqueAncestors = [];
    const seenA = new Set();
    for (const a of rawAncestors) {
        if (!seenA.has(a.id)) {
            seenA.add(a.id);
            uniqueAncestors.push(a);
        }
    }
    // Order ancestors from oldest to youngest (by generation level ascending)
    uniqueAncestors.sort((a, b) => getPersonGenerationLevel(a) - getPersonGenerationLevel(b));

    const rawDescendants = getDirectDescendants(person);
    const uniqueDescendants = [];
    const seenD = new Set();
    for (const d of rawDescendants) {
        if (!seenD.has(d.id)) {
            seenD.add(d.id);
            uniqueDescendants.push(d);
        }
    }
    // Order descendants from youngest to oldest? Actually we want children, grandchildren, etc. ascending by generation level
    uniqueDescendants.sort((a, b) => getPersonGenerationLevel(a) - getPersonGenerationLevel(b));

    // Build HTML
    let html = `<div class="lineage-chain" style="display:flex; flex-direction:column; align-items:center;">`;

    // Ancestors section
    if (uniqueAncestors.length) {
        for (let i = 0; i < uniqueAncestors.length; i++) {
            const anc = uniqueAncestors[i];
            const genNum = getPersonGenerationLevel(anc) + 1;
            const label = i === 0 ? `👴👵 Oldest Ancestors — Generation ${genNum}` : `📍 Generation ${genNum}`;
            html += `<div class="lineage-gen-block">
                        <div class="lineage-gen-label">${label}</div>
                        <div class="lineage-nodes-row" style="justify-content:center;">
                            ${buildNodeHtml(anc)}
                        </div>
                    </div>`;
            if (i < uniqueAncestors.length - 1) html += `<div class="lineage-connector">▼</div>`;
        }
        if (uniqueAncestors.length) html += `<div class="lineage-connector">▼</div>`;
    }

    // Current person
    const currentGen = getPersonGenerationLevel(person) + 1;
    html += `<div class="lineage-gen-block">
                <div class="lineage-gen-label">📍 ${escapeHtml(person.name)} — Generation ${currentGen}</div>
                <div class="lineage-nodes-row" style="justify-content:center;">
                    ${buildNodeHtml(person, 'focused-node')}
                </div>
            </div>`;

    // Descendants section
    if (uniqueDescendants.length) {
        html += `<div class="lineage-connector">▼</div>`;
        for (let i = 0; i < uniqueDescendants.length; i++) {
            const desc = uniqueDescendants[i];
            const genNum = getPersonGenerationLevel(desc) + 1;
            const label = i === 0 ? `👶 Children — Generation ${genNum}` : (genNum === currentGen + 1 ? `📍 Generation ${genNum}` : `📍 Generation ${genNum}`);
            html += `<div class="lineage-gen-block">
                        <div class="lineage-gen-label">${label}</div>
                        <div class="lineage-nodes-row" style="justify-content:center;">
                            ${buildNodeHtml(desc)}
                        </div>
                    </div>`;
            if (i < uniqueDescendants.length - 1) html += `<div class="lineage-connector">▼</div>`;
        }
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
                <div id="lineageModalBody">${buildLineageHtml(person)}</div>
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
window.handleNodeClick = function(personId) { showLineageModal(personId); };

function showEditModal(person) {
    if (!person) return;
    document.getElementById('editModal')?.remove();

    const existingFamilies = [...new Set(FAMILY_DB.people.map(p => p.family_name).filter(Boolean))].sort();
    const fnDatalist = existingFamilies.map(fn => `<option value="${escapeHtml(fn)}">`).join('');

    const allPeopleOpts = [...FAMILY_DB.people]
        .filter(p => p.id !== person.id)
        .sort((a,b) => a.name.localeCompare(b.name))
        .map(p => `<option value="${escapeHtml(p.name)}">`).join('');

    const currentParents = getParentsArray(person)
        .map(pid => findPersonById(pid))
        .filter(Boolean);

    const currentChildren = FAMILY_DB.people.filter(p => getParentsArray(p).includes(person.id));

    const parentTags = currentParents.map(p =>
        `<span style="background:#fef3e2;border:1px solid #e2cfb0;border-radius:0.5rem;
                      padding:0.2rem 0.5rem;font-size:0.75rem;display:inline-flex;align-items:center;gap:0.3rem;">
            ${escapeHtml(p.name)}
            <button type="button" onclick="editRemoveParent('${p.id}')"
                    style="background:none;border:none;cursor:pointer;color:#c33;font-size:0.8rem;line-height:1;">✕</button>
        </span>`
    ).join('');

    const childTags = currentChildren.map(p =>
        `<span style="background:#eaf7ee;border:1px solid #aed6b5;border-radius:0.5rem;
                      padding:0.2rem 0.5rem;font-size:0.75rem;display:inline-flex;align-items:center;gap:0.3rem;">
            ${escapeHtml(p.name)}
            <button type="button" onclick="editRemoveChild('${p.id}')"
                    style="background:none;border:none;cursor:pointer;color:#c33;font-size:0.8rem;line-height:1;">✕</button>
        </span>`
    ).join('');

    document.body.insertAdjacentHTML('beforeend', `
        <div id="editModal" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);
             display:flex;align-items:center;justify-content:center;z-index:11000;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;max-width:460px;
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
                    <label>Family Name <span style="font-weight:400;color:#888;">(select or type new)</span></label>
                    <input type="text" id="editFamilyName" list="editFamilyList"
                           value="${escapeHtml(person.family_name || '')}"
                           placeholder="Select existing or type new family name"
                           style="width:100%;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;box-sizing:border-box;">
                    <datalist id="editFamilyList">${fnDatalist}</datalist>
                </div>
                <div class="form-group">
                    <label>Parents <span style="font-weight:400;color:#888;">(optional)</span></label>
                    <div id="editParentTags" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.4rem;min-height:1.5rem;">
                        ${parentTags || '<span style="font-size:0.75rem;color:#aaa;">No parents set</span>'}
                    </div>
                    <div style="display:flex;gap:0.4rem;">
                        <input type="text" id="editAddParentInput" list="editAddParentList"
                               placeholder="Type or search parent name"
                               style="flex:1;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;font-size:0.85rem;">
                        <datalist id="editAddParentList">${allPeopleOpts}</datalist>
                        <button type="button" onclick="editAddParent('${person.id}')"
                                style="background:#5a3e2b;color:white;border:none;border-radius:0.5rem;
                                       padding:0.5rem 0.8rem;cursor:pointer;font-size:0.8rem;white-space:nowrap;">+ Add</button>
                    </div>
                    <div style="font-size:0.68rem;color:#888;margin-top:0.25rem;">Select an existing person or type a new name and click Add.</div>
                </div>
                <div class="form-group">
                    <label>Children <span style="font-weight:400;color:#888;">(optional)</span></label>
                    <div id="editChildTags" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.4rem;min-height:1.5rem;">
                        ${childTags || '<span style="font-size:0.75rem;color:#aaa;">No children set</span>'}
                    </div>
                    <div style="display:flex;gap:0.4rem;">
                        <input type="text" id="editAddChildInput" list="editAddChildList"
                               placeholder="Type or search child name"
                               style="flex:1;padding:0.5rem;border:1px solid #ccc;border-radius:0.5rem;font-size:0.85rem;">
                        <datalist id="editAddChildList">${allPeopleOpts}</datalist>
                        <button type="button" onclick="editAddChild('${person.id}')"
                                style="background:#28a745;color:white;border:none;border-radius:0.5rem;
                                       padding:0.5rem 0.8rem;cursor:pointer;font-size:0.8rem;white-space:nowrap;">+ Add</button>
                    </div>
                    <div style="font-size:0.68rem;color:#888;margin-top:0.25rem;">Select an existing person or type a new name and click Add.</div>
                </div>
                <div style="font-size:0.7rem;color:#888;margin-bottom:0.75rem;">ID: <strong>#${person.uid||person.id}</strong></div>
                <div style="display:flex;gap:0.5rem;margin-top:1rem;">
                    <button onclick="saveEdit('${person.id}')" class="submit-btn" style="flex:1;">Save</button>
                    <button onclick="closeEditModal()"
                            style="flex:1;background:#6c757d;color:white;border:none;border-radius:0.5rem;cursor:pointer;">Cancel</button>
                </div>
            </div>
        </div>`);

    document.getElementById('editDob')?.addEventListener('click', function() { this.showPicker(); });
    window._editParents  = currentParents.map(p => p.id);
    window._editChildren = currentChildren.map(p => p.id);
    window._editPersonId = person.id;
}

window.editRemoveParent = function(parentId) {
    window._editParents = (window._editParents || []).filter(id => id !== parentId);
    const tag = document.querySelector(`#editParentTags button[onclick="editRemoveParent('${parentId}')"]`)?.parentElement;
    if (tag) tag.remove();
    const wrap = document.getElementById('editParentTags');
    if (wrap && !wrap.querySelector('span[style*="background"]')) {
        wrap.innerHTML = '<span style="font-size:0.75rem;color:#aaa;">No parents set</span>';
    }
};

window.editRemoveChild = function(childId) {
    window._editChildren = (window._editChildren || []).filter(id => id !== childId);
    const tag = document.querySelector(`#editChildTags button[onclick="editRemoveChild('${childId}')"]`)?.parentElement;
    if (tag) tag.remove();
    const wrap = document.getElementById('editChildTags');
    if (wrap && !wrap.querySelector('span[style*="background"]')) {
        wrap.innerHTML = '<span style="font-size:0.75rem;color:#aaa;">No children set</span>';
    }
};

window.editAddParent = async function(personId) {
    const input = document.getElementById('editAddParentInput');
    const name  = input?.value.trim();
    if (!name) return;
    let parentObj = findPeopleByName(name)[0] || null;
    if (!parentObj) {
        const v = validateFullName(name);
        if (!v.valid) { alert(v.message); return; }
        const nuid = generateUID(), nid = makePersonId(name, nuid);
        await addPersonToDB({ id: nid, uid: nuid, name, gender: 'unknown', parents: JSON.stringify([]), is_root: true, family_name: null });
        FAMILY_DB.people.push({ id: nid, uid: nuid, name, gender: 'unknown', parents: '[]', is_root: true, family_name: null });
        parentObj = { id: nid, name };
    }
    if ((window._editParents || []).includes(parentObj.id)) { alert('Already added.'); return; }
    window._editParents = [...(window._editParents || []), parentObj.id];
    const wrap = document.getElementById('editParentTags');
    const placeholder = wrap?.querySelector('span[style*="color:#aaa"]');
    if (placeholder) placeholder.remove();
    wrap?.insertAdjacentHTML('beforeend',
        `<span style="background:#fef3e2;border:1px solid #e2cfb0;border-radius:0.5rem;
                      padding:0.2rem 0.5rem;font-size:0.75rem;display:inline-flex;align-items:center;gap:0.3rem;">
            ${escapeHtml(parentObj.name)}
            <button type="button" onclick="editRemoveParent('${parentObj.id}')"
                    style="background:none;border:none;cursor:pointer;color:#c33;font-size:0.8rem;line-height:1;">✕</button>
        </span>`);
    if (input) input.value = '';
};

window.editAddChild = async function(personId) {
    const input = document.getElementById('editAddChildInput');
    const name  = input?.value.trim();
    if (!name) return;
    let childObj = findPeopleByName(name)[0] || null;
    if (!childObj) {
        const v = validateFullName(name);
        if (!v.valid) { alert(v.message); return; }
        const nuid = generateUID(), nid = makePersonId(name, nuid);
        await addPersonToDB({ id: nid, uid: nuid, name, gender: 'unknown', parents: JSON.stringify([personId]), is_root: false, family_name: null });
        FAMILY_DB.people.push({ id: nid, uid: nuid, name, gender: 'unknown', parents: JSON.stringify([personId]), is_root: false, family_name: null });
        childObj = { id: nid, name };
    }
    if ((window._editChildren || []).includes(childObj.id)) { alert('Already added.'); return; }
    window._editChildren = [...(window._editChildren || []), childObj.id];
    const wrap = document.getElementById('editChildTags');
    const placeholder = wrap?.querySelector('span[style*="color:#aaa"]');
    if (placeholder) placeholder.remove();
    wrap?.insertAdjacentHTML('beforeend',
        `<span style="background:#eaf7ee;border:1px solid #aed6b5;border-radius:0.5rem;
                      padding:0.2rem 0.5rem;font-size:0.75rem;display:inline-flex;align-items:center;gap:0.3rem;">
            ${escapeHtml(childObj.name)}
            <button type="button" onclick="editRemoveChild('${childObj.id}')"
                    style="background:none;border:none;cursor:pointer;color:#c33;font-size:0.8rem;line-height:1;">✕</button>
        </span>`);
    if (input) input.value = '';
};

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
    updates.family_name = familyName || null;

    const newParents = (window._editParents || []);
    updates.parents  = JSON.stringify(newParents.length ? newParents : []);
    updates.is_root  = newParents.length === 0;

    try {
        await updatePersonInDB(personId, updates);

        const desiredChildren = new Set(window._editChildren || []);
        const oldChildren = FAMILY_DB.people.filter(p => getParentsArray(p).includes(personId));
        for (const child of oldChildren) {
            if (!desiredChildren.has(child.id)) {
                const updatedParents = getParentsArray(child).filter(pid => pid !== personId);
                await updatePersonInDB(child.id, { parents: JSON.stringify(updatedParents) });
            }
        }
        for (const childId of desiredChildren) {
            const child = findPersonById(childId);
            if (!child) continue;
            const existingParents = getParentsArray(child);
            if (!existingParents.includes(personId)) {
                await updatePersonInDB(childId, {
                    parents: JSON.stringify([...existingParents, personId]),
                    is_root: false
                });
            }
        }

        await loadPeople();
        await loadFamilyColors();
        closeEditModal();
        renderWholeFamilyTree();
        showSuccess('contributeSuccessMsg', 'Updated successfully!');
    } catch(e) {
        showError('contributeErrorMsg', `Update failed: ${e.message}`);
    }
};

window.closeEditModal = function() { document.getElementById('editModal')?.remove(); };
window.findPersonById = findPersonById;
window.showEditModal = showEditModal;

// ==============================================================
// CONTRIBUTE
// ==============================================================
async function addOrGetPerson(nameOrRef, gender = 'unknown', familyName = null) {
    if (!nameOrRef) return null;
    const isRef = typeof nameOrRef === 'object';
    const name  = isRef ? nameOrRef.name : nameOrRef;
    const existingId = isRef ? nameOrRef.id : null;
    if (existingId) return findPersonById(existingId);
    if (familyName) await assignColorForFamily(familyName);
    const v = validateFullName(name);
    if (!v.valid) throw new Error(v.message);
    const exactMatches = findPeopleByName(name);
    if (exactMatches.length === 1) return exactMatches[0];
    const uid = generateUID(), newId = makePersonId(name, uid);
    await addPersonToDB({
        id: newId, uid, name, gender,
        parents: JSON.stringify([]),
        is_root: false,
        family_name: familyName
    });
    return { id: newId, uid, name, gender, parents: '[]', is_root: false, family_name: familyName };
}

async function contributeToTree(event) {
    event.preventDefault();
    const userName         = document.getElementById('userFullName').value.trim();
    const userGender       = document.getElementById('userGender').value;
    const userDob          = document.getElementById('userDob')?.value || null;
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

    showSuccess('contributeSuccessMsg', 'Adding to the family tree…');

    try {
        await assignColorForFamily(familyName);
        if (fatherFamilyName) await assignColorForFamily(fatherFamilyName);
        if (motherFamilyName) await assignColorForFamily(motherFamilyName);

        let parentIds = [];
        if (fatherRef) {
            const father = await addOrGetPerson(fatherRef, 'male', fatherFamilyName);
            if (father) parentIds.push(father.id);
        }
        if (motherRef) {
            const mother = await addOrGetPerson(motherRef, 'female', motherFamilyName);
            if (mother) parentIds.push(mother.id);
        }
        const uid = generateUID(), newId = makePersonId(userName, uid);
        const autoRoot = parentIds.length === 0;
        await addPersonToDB({
            id: newId, uid, name: userName, gender: userGender, dob: userDob,
            parents: JSON.stringify(parentIds),
            is_root: autoRoot,
            family_name: familyName
        });
        await loadPeople();
        personOwners[newId] = currentUser; savePersonOwners();
        document.getElementById('contributeForm').reset();
        ['fatherName','motherName'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        ['familyNameInput','fatherName','motherName','fatherFamilyNameInput','motherFamilyNameInput'].forEach(id => {
            const el = document.getElementById(id); if (el) el.value = '';
        });
        showSuccess('contributeSuccessMsg', `Added "${userName}" [#${uid}]`);
        if (isAdmin) await updateAdminPanel();
        renderWholeFamilyTree();
    } catch(e) { showError('contributeErrorMsg', `Failed: ${e.message}`); }
}

// ==============================================================
// LINEAGE TAB
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
        // Removed "Root?" column
        rows.push('"Generation","Full Name","Unique ID","Family Name","Gender","Date of Birth","Father","Mother","Children"');
        const sorted = [...cluster].sort((a,b) => { const d = getPersonGenerationLevel(a)-getPersonGenerationLevel(b); return d||a.name.localeCompare(b.name); });
        let lastGen = null;
        sorted.forEach(person => {
            const gen = getPersonGenerationLevel(person)+1;
            if (lastGen !== null && gen !== lastGen) rows.push('');
            lastGen = gen;
            rows.push(`"Gen ${gen}","${person.name}","#${person.uid||person.id}","${person.family_name||''}","${person.gender||''}","${person.dob||''}","${getFather(person)}","${getMother(person)}","${getChildren(person)}"`);
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

    const toolbar = document.getElementById('adminBulkToolbar');
    if (toolbar) {
        toolbar.innerHTML = `
            <div style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:center;
                        padding:0.6rem 0.8rem;background:#fef7ed;border-radius:0.75rem;
                        border:1px solid #e2cfb0;margin-bottom:0.75rem;">
                <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;font-size:0.82rem;font-weight:600;color:#5a3e2b;">
                    <input type="checkbox" id="selectAllCheckbox" style="width:auto;cursor:pointer;accent-color:#c2894b;"
                           onchange="toggleSelectAll(this.checked)">
                    Select all
                </label>
                <button onclick="deleteSelectedHandler()"
                        style="background:#dc3545;color:white;border:none;border-radius:0.5rem;
                               padding:0.35rem 0.8rem;cursor:pointer;font-size:0.8rem;">🗑️ Delete selected</button>
                <button onclick="deleteAllHandler()"
                        style="background:#7a1a2a;color:white;border:none;border-radius:0.5rem;
                               padding:0.35rem 0.8rem;cursor:pointer;font-size:0.8rem;">⚠️ Delete all</button>
                <span id="selectedCount" style="font-size:0.75rem;color:#888;margin-left:auto;">0 selected</span>
            </div>`;
    }

    document.getElementById('namesGrid').innerHTML = FAMILY_DB.people.map(person => {
        const bg = getColorForFamily(person.family_name);
        const tx = getTextColor(bg);
        return `<div class="name-item">
            <label style="display:flex;align-items:center;gap:0.5rem;flex:1;cursor:pointer;min-width:0;">
                <input type="checkbox" class="person-checkbox" value="${person.id}"
                       style="width:auto;flex-shrink:0;cursor:pointer;accent-color:#c2894b;"
                       onchange="updateSelectedCount()">
                <div style="min-width:0;">
                    <strong>${escapeHtml(person.name)}</strong>
                    <span style="font-size:0.65rem;color:#b08052;margin-left:0.3rem;">#${person.uid||''}</span>
                    ${person.family_name ? `<span style="background:${bg};color:${tx};font-size:0.6rem;padding:0.1rem 0.4rem;border-radius:0.5rem;margin-left:0.3rem;">${escapeHtml(person.family_name)}</span>` : ''}
                    ${isRootPerson(person) ? '<span style="font-size:0.6rem;color:#856404;margin-left:0.3rem;">👑 root</span>' : ''}
                    <br><small>DOB: ${person.dob||'Not set'} · Owner: ${personOwners[person.id]||'Unknown'}</small>
                </div>
            </label>
            <button class="delete-btn" onclick="deletePersonHandler('${person.id}')">🗑️</button>
        </div>`;
    }).join('');
}

window.toggleSelectAll = function(checked) {
    document.querySelectorAll('.person-checkbox').forEach(cb => cb.checked = checked);
    updateSelectedCount();
};

window.updateSelectedCount = function() {
    const checked = document.querySelectorAll('.person-checkbox:checked').length;
    const total   = document.querySelectorAll('.person-checkbox').length;
    const countEl = document.getElementById('selectedCount');
    if (countEl) countEl.textContent = `${checked} of ${total} selected`;
    const selAll = document.getElementById('selectAllCheckbox');
    if (selAll) {
        selAll.checked       = checked === total && total > 0;
        selAll.indeterminate = checked > 0 && checked < total;
    }
};

function showConfirmModal(message, onConfirm) {
    document.getElementById('adminConfirmModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
        <div id="adminConfirmModal"
             style="position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;
                    align-items:center;justify-content:center;z-index:20000;padding:1rem;">
            <div style="background:white;border-radius:1rem;padding:1.5rem;max-width:380px;
                        width:100%;box-shadow:0 8px 30px rgba(0,0,0,0.2);">
                <p style="font-size:0.9rem;color:#3a2010;margin-bottom:1.25rem;line-height:1.5;">${message}</p>
                <div style="display:flex;gap:0.5rem;justify-content:flex-end;">
                    <button onclick="document.getElementById('adminConfirmModal').remove()"
                            style="background:#6c757d;color:white;border:none;border-radius:0.5rem;
                                   padding:0.5rem 1rem;cursor:pointer;font-size:0.85rem;">Cancel</button>
                    <button id="adminConfirmOkBtn"
                            style="background:#dc3545;color:white;border:none;border-radius:0.5rem;
                                   padding:0.5rem 1rem;cursor:pointer;font-size:0.85rem;">Confirm</button>
                </div>
            </div>
        </div>`);
    document.getElementById('adminConfirmOkBtn').onclick = () => {
        document.getElementById('adminConfirmModal')?.remove();
        onConfirm();
    };
}

window.deleteSelectedHandler = async function() {
    if (!isAdmin) { alert('Admins only.'); return; }
    const checked = Array.from(document.querySelectorAll('.person-checkbox:checked')).map(cb => cb.value);
    if (!checked.length) { alert('No members selected.'); return; }
    showConfirmModal(
        `Delete <strong>${checked.length}</strong> selected member${checked.length > 1 ? 's' : ''}?<br>This will also remove them from all parent/child relationships.`,
        async () => {
            try {
                for (const id of checked) {
                    await removePersonFromAllRelations(id);
                }
                for (const id of checked) {
                    await apiFetch(`people?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
                    delete personOwners[id];
                }
                savePersonOwners();
                await updateAdminPanel();
                renderWholeFamilyTree();
            } catch(e) { alert(`Failed: ${e.message}`); }
        }
    );
};

window.deleteAllHandler = async function() {
    if (!isAdmin) { alert('Admins only.'); return; }
    if (!FAMILY_DB.people.length) { alert('Nothing to delete.'); return; }
    showConfirmModal(
        `⚠️ Delete <strong>ALL ${FAMILY_DB.people.length} members</strong> and ALL family colors?<br>This will wipe the entire tree and <strong>cannot be undone</strong>.`,
        async () => {
            try {
                // First, clear all parents arrays to break all relationships
                for (const person of FAMILY_DB.people) {
                    await updatePersonInDB(person.id, { parents: JSON.stringify([]), is_root: true });
                }
                // Then delete all people
                for (const person of [...FAMILY_DB.people]) {
                    await apiFetch(`people?id=${encodeURIComponent(person.id)}`, { method: 'DELETE' });
                    delete personOwners[person.id];
                }
                savePersonOwners();
                // Delete family colors table
                await apiFetch('family_colors', { method: 'DELETE' });
                FAMILY_COLORS = {};
                await loadPeople();
                if (isAdmin) await updateAdminPanel();
                renderWholeFamilyTree();
                alert('All data deleted successfully.');
            } catch(e) { alert(`Failed: ${e.message}`); }
        }
    );
};

window.deletePersonHandler = async function(personId) {
    if (!isAdmin) { alert('Admins only.'); return; }
    const p = findPersonById(personId); if (!p) return;
    if (confirm(`Delete "${p.name}" [#${p.uid||''}]? This removes them from all relationships.`)) {
        try { await deletePersonFromDB(personId); await updateAdminPanel(); renderWholeFamilyTree(); alert('Deleted.'); }
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
        await loadFamilyColors();
        await loadPeople();
        await ensurePlaceholderExists();
        setupAutocomplete('fatherName', (name, family) => onPersonAutocomplete(name, family, 'fatherFamilyNameInput'));
        setupAutocomplete('motherName', (name, family) => onPersonAutocomplete(name, family, 'motherFamilyNameInput'));
        if (isAdmin) await updateAdminPanel();
        renderWholeFamilyTree();
        console.log('✅ App initialized —', FAMILY_DB.people.length, 'people,', Object.keys(FAMILY_COLORS).length, 'family colors');
    } catch(e) {
        console.error('Init error:', e);
        const container = document.getElementById('wholeTreeContainer');
        if (container) {
            container.innerHTML = `<div style="text-align:center;padding:1.5rem;color:#c33;">
                ❌ Failed to load: ${e.message}<br><br>
                <button onclick="location.reload()" class="submit-btn">🔄 Retry</button>
            </div>`;
        }
    }
}

setupEventListeners();
init();