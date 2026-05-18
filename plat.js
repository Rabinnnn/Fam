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

// Store who created each person (in localStorage for now - would need a 'createdBy' column in Supabase for production)
// For now, we'll track in a separate object in localStorage
let personOwners = {};

function loadPersonOwners() {
    const saved = localStorage.getItem('person_owners');
    if (saved) {
        personOwners = JSON.parse(saved);
    }
}

function savePersonOwners() {
    localStorage.setItem('person_owners', JSON.stringify(personOwners));
}

function showError(elementId, message) {
    const errorDiv = document.getElementById(elementId);
    if (errorDiv) {
        errorDiv.textContent = `❌ ${message}`;
        errorDiv.classList.add('show');
        setTimeout(() => errorDiv.classList.remove('show'), 5000);
    }
    console.error('ERROR:', message);
}

function showSuccess(elementId, message) {
    const successDiv = document.getElementById(elementId);
    if (successDiv) {
        successDiv.textContent = `✅ ${message}`;
        successDiv.classList.add('show');
        setTimeout(() => successDiv.classList.remove('show'), 3000);
    }
    console.log('SUCCESS:', message);
}

function validateFullName(name) {
    const trimmed = name.trim();
    if (!trimmed) return { valid: false, message: 'Name cannot be empty' };
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
        return { valid: false, message: 'Please enter both first and last name' };
    }
    if (parts.length > 4) {
        return { valid: false, message: 'Name seems too long. Please enter a valid name.' };
    }
    return { valid: true, message: '' };
}

function nameToId(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function getPersonGenerationLevel(person) {
    let depth = 0;
    let current = person;
    let parents = typeof current.parents === 'string' ? JSON.parse(current.parents) : current.parents;
    while(parents && parents.length > 0) {
        depth++;
        current = FAMILY_DB.people.find(p => p.id === parents[0]);
        if(!current) break;
        parents = typeof current.parents === 'string' ? JSON.parse(current.parents) : current.parents;
    }
    return depth;
}

async function validateParentsGeneration(fatherName, motherName) {
    if (!fatherName || !motherName) return { valid: true, message: '' };
    
    const father = findPersonByName(fatherName);
    const mother = findPersonByName(motherName);
    
    if (!father || !mother) return { valid: true, message: '' };
    
    const fatherGen = getPersonGenerationLevel(father);
    const motherGen = getPersonGenerationLevel(mother);
    
    if (fatherGen !== motherGen) {
        return { 
            valid: false, 
            message: `❌ Generation mismatch: "${father.name}" is in generation ${fatherGen + 1}, but "${mother.name}" is in generation ${motherGen + 1}. Parents must be from the SAME generation.` 
        };
    }
    
    return { valid: true, message: '' };
}

function populateParentDropdowns() {
    const peopleNames = FAMILY_DB.people.map(p => p.name).sort();
    
    const fatherSelect = document.getElementById('fatherSelect');
    const motherSelect = document.getElementById('motherSelect');
    
    fatherSelect.innerHTML = '<option value="">-- Select Father from existing records --</option>';
    motherSelect.innerHTML = '<option value="">-- Select Mother from existing records --</option>';
    
    peopleNames.forEach(name => {
        const fatherOption = document.createElement('option');
        fatherOption.value = name;
        fatherOption.textContent = name;
        fatherSelect.appendChild(fatherOption);
        
        const motherOption = document.createElement('option');
        motherOption.value = name;
        motherOption.textContent = name;
        motherSelect.appendChild(motherOption);
    });
}

function toggleParentMode(parent) {
    const selectElement = document.getElementById(`${parent}Select`);
    const inputElement = document.getElementById(`${parent}Name`);
    const toggleBtn = document.querySelector(`#${parent}Container .toggle-mode-btn`);
    const modeIndicator = document.getElementById(`${parent}ModeIndicator`);
    
    if (parent === 'father') {
        if (fatherMode === 'manual') {
            selectElement.style.display = 'block';
            inputElement.style.display = 'none';
            inputElement.value = '';
            toggleBtn.textContent = '✏️ Enter Manually';
            modeIndicator.innerHTML = '📋 Select mode - choose from existing records';
            fatherMode = 'select';
        } else {
            selectElement.style.display = 'none';
            inputElement.style.display = 'block';
            selectElement.value = '';
            toggleBtn.textContent = '📋 Use Existing';
            modeIndicator.innerHTML = '✏️ Manual entry mode (type any name)';
            fatherMode = 'manual';
        }
    } else if (parent === 'mother') {
        if (motherMode === 'manual') {
            selectElement.style.display = 'block';
            inputElement.style.display = 'none';
            inputElement.value = '';
            toggleBtn.textContent = '✏️ Enter Manually';
            modeIndicator.innerHTML = '📋 Select mode - choose from existing records';
            motherMode = 'select';
        } else {
            selectElement.style.display = 'none';
            inputElement.style.display = 'block';
            selectElement.value = '';
            toggleBtn.textContent = '📋 Use Existing';
            modeIndicator.innerHTML = '✏️ Manual entry mode (type any name)';
            motherMode = 'manual';
        }
    }
}

function getParentName(parent) {
    if (parent === 'father') {
        if (fatherMode === 'select') {
            return document.getElementById('fatherSelect').value;
        } else {
            return document.getElementById('fatherName').value.trim();
        }
    } else if (parent === 'mother') {
        if (motherMode === 'select') {
            return document.getElementById('motherSelect').value;
        } else {
            return document.getElementById('motherName').value.trim();
        }
    }
    return '';
}

async function loadPeople() {
    try {
        console.log('Loading people from Supabase...');
        const response = await fetch(`${SUPABASE_URL}/rest/v1/people?select=*`, {
            method: 'GET',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        FAMILY_DB.people = data;
        console.log(`✅ Loaded ${data.length} people`);
        
        populateParentDropdowns();
        loadPersonOwners();
        
        return data;
    } catch (error) {
        console.error('❌ Load error:', error);
        throw error;
    }
}

async function addPersonToDB(person) {
    try {
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
        
        // Store ownership
        if (!personOwners[person.id]) {
            personOwners[person.id] = currentUser;
            savePersonOwners();
        }
        
        return true;
    } catch (error) {
        console.error('❌ Add error:', error);
        throw error;
    }
}

async function updatePersonInDB(personId, updates) {
    try {
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
    } catch (error) {
        console.error('❌ Update error:', error);
        throw error;
    }
}

async function deletePersonFromDB(personId) {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/people?id=eq.${personId}`, {
            method: 'DELETE',
            headers: {
                'apikey': SUPABASE_ANON_KEY,
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
            }
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        // Remove ownership
        delete personOwners[personId];
        savePersonOwners();
        
        return true;
    } catch (error) {
        console.error('❌ Delete error:', error);
        throw error;
    }
}

function findPersonByName(name) {
    return FAMILY_DB.people.find(p => p.name.toLowerCase() === name.trim().toLowerCase());
}

function findPersonByPartialName(searchTerm) {
    const term = searchTerm.trim().toLowerCase();
    if (term === "") return null;
    
    let exactMatch = FAMILY_DB.people.find(p => p.name.toLowerCase() === term);
    if (exactMatch) return exactMatch;
    
    let partialMatches = FAMILY_DB.people.filter(p => p.name.toLowerCase().includes(term));
    return partialMatches.length > 0 ? partialMatches[0] : null;
}

function canEditPerson(personId) {
    if (isAdmin) return true;
    return personOwners[personId] === currentUser;
}

function showEditModal(person) {
    const modalHtml = `
        <div id="editModal" style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;">
            <div style="background: white; border-radius: 1rem; padding: 1.5rem; max-width: 400px; width: 90%;">
                <h3 style="margin-bottom: 1rem;">✏️ Edit ${escapeHtml(person.name)}</h3>
                <div class="form-group">
                    <label>Full Name</label>
                    <input type="text" id="editName" value="${escapeHtml(person.name)}" class="form-control" style="width:100%; padding:0.5rem; border:1px solid #ccc; border-radius:0.5rem;">
                </div>
                <div class="form-group">
                    <label>Gender</label>
                    <select id="editGender" style="width:100%; padding:0.5rem; border:1px solid #ccc; border-radius:0.5rem;">
                        <option value="male" ${person.gender === 'male' ? 'selected' : ''}>Male</option>
                        <option value="female" ${person.gender === 'female' ? 'selected' : ''}>Female</option>
                        <option value="other" ${person.gender === 'other' ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Date of Birth</label>
                    <input type="date" id="editDob" value="${person.dob || ''}" style="width:100%; padding:0.5rem; border:1px solid #ccc; border-radius:0.5rem;">
                </div>
                <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                    <button onclick="saveEdit('${person.id}')" class="submit-btn" style="flex:1;">Save Changes</button>
                    <button onclick="closeEditModal()" style="flex:1; background:#6c757d; color:white; border:none; border-radius:0.5rem; cursor:pointer;">Cancel</button>
                </div>
            </div>
        </div>
    `;
    
    // Remove existing modal if any
    const existingModal = document.getElementById('editModal');
    if (existingModal) existingModal.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

window.saveEdit = async function(personId) {
    const newName = document.getElementById('editName').value.trim();
    const newGender = document.getElementById('editGender').value;
    const newDob = document.getElementById('editDob').value;
    
    if (!newName) {
        alert('Name cannot be empty');
        return;
    }
    
    const validation = validateFullName(newName);
    if (!validation.valid) {
        alert(validation.message);
        return;
    }
    
    const updates = { name: newName, gender: newGender };
    if (newDob) updates.dob = newDob;
    
    try {
        await updatePersonInDB(personId, updates);
        await loadPeople();
        closeEditModal();
        
        // Refresh current view
        const currentSearch = document.getElementById('searchName').value;
        if (currentSearch) {
            renderLineageView(currentSearch);
        }
        if (isAdmin) await updateAdminPanel();
        
        showSuccess('contributeSuccessMsg', 'Person updated successfully!');
    } catch (error) {
        showError('contributeErrorMsg', `Failed to update: ${error.message}`);
    }
};

window.closeEditModal = function() {
    const modal = document.getElementById('editModal');
    if (modal) modal.remove();
};

function getAncestors(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return [];
    visited.add(person.id);
    let ancestors = [person];
    
    if (person.parents && person.parents.length) {
        let parentsArray = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
        for (let parentId of parentsArray) {
            const parentObj = FAMILY_DB.people.find(p => p.id === parentId);
            if (parentObj) {
                ancestors = ancestors.concat(getAncestors(parentObj, visited));
            }
        }
    }
    return ancestors;
}

function getDescendants(person, visited = new Set()) {
    if (!person || visited.has(person.id)) return [];
    visited.add(person.id);
    let descendants = [person];
    
    const children = FAMILY_DB.people.filter(p => {
        if (!p.parents || p.parents.length === 0) return false;
        let parentsArray = typeof p.parents === 'string' ? JSON.parse(p.parents) : p.parents;
        return parentsArray.includes(person.id);
    });
    
    for (let child of children) {
        descendants = descendants.concat(getDescendants(child, visited));
    }
    return descendants;
}

function getGenerationDepth(person, visited = new Set()) {
    if (visited.has(person.id)) return 0;
    visited.add(person.id);
    
    let maxDepth = 0;
    if (person.parents && person.parents.length) {
        let parentsArray = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
        for (let parentId of parentsArray) {
            const parent = FAMILY_DB.people.find(p => p.id === parentId);
            if (parent) {
                maxDepth = Math.max(maxDepth, getGenerationDepth(parent, visited) + 1);
            }
        }
    }
    return maxDepth;
}

function findFamilyClusters() {
    const adjacency = new Map();
    FAMILY_DB.people.forEach(person => {
        adjacency.set(person.id, new Set());
    });
    
    FAMILY_DB.people.forEach(person => {
        if (person.parents && person.parents.length) {
            let parentsArray = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
            parentsArray.forEach(parentId => {
                if (adjacency.has(parentId)) {
                    adjacency.get(parentId).add(person.id);
                    adjacency.get(person.id).add(parentId);
                }
            });
        }
    });
    
    const visited = new Set();
    const clusters = [];
    
    for (let person of FAMILY_DB.people) {
        if (!visited.has(person.id)) {
            const cluster = [];
            const queue = [person.id];
            visited.add(person.id);
            
            while (queue.length > 0) {
                const currentId = queue.shift();
                const currentPerson = FAMILY_DB.people.find(p => p.id === currentId);
                if (currentPerson) cluster.push(currentPerson);
                
                const neighbors = adjacency.get(currentId) || new Set();
                for (let neighborId of neighbors) {
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        queue.push(neighborId);
                    }
                }
            }
            
            if (cluster.length > 0) {
                clusters.push(cluster);
            }
        }
    }
    
    return clusters;
}

function getFamilyTreeForCluster(cluster) {
    const originalDB = FAMILY_DB;
    FAMILY_DB = { people: cluster };
    
    const rootAncestors = cluster.filter(person => {
        let parents = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
        return !parents || parents.length === 0;
    });
    
    let allTreeMembers = new Set();
    for (let root of rootAncestors) {
        const descendants = getDescendants(root);
        descendants.forEach(d => allTreeMembers.add(d));
    }
    
    if (allTreeMembers.size === 0) {
        cluster.forEach(p => allTreeMembers.add(p));
    }
    
    const members = Array.from(allTreeMembers);
    
    const depths = new Map();
    let maxDepth = 0;
    
    for (let person of members) {
        const depth = getGenerationDepth(person);
        depths.set(person.id, depth);
        maxDepth = Math.max(maxDepth, depth);
    }
    
    const groups = new Map();
    for (let person of members) {
        const depth = depths.get(person.id) || 0;
        if (!groups.has(depth)) groups.set(depth, []);
        groups.get(depth).push(person);
    }
    
    const result = [];
    for (let i = 0; i <= maxDepth; i++) {
        if (groups.has(i)) {
            result.push(groups.get(i));
        }
    }
    
    let familyName = "Unknown Family";
    if (rootAncestors.length > 0 && rootAncestors[0].name) {
        const nameParts = rootAncestors[0].name.split(' ');
        familyName = nameParts[nameParts.length - 1] + " Family";
    } else if (members.length > 0 && members[0].name) {
        const nameParts = members[0].name.split(' ');
        familyName = nameParts[nameParts.length - 1] + " Family";
    }
    
    FAMILY_DB = originalDB;
    
    return { generations: result, familyName, memberCount: members.length, depths };
}

function buildLineageGenerations(ancestors) {
    if (!ancestors.length) return [];
    
    const depthMap = new Map();
    const targetId = ancestors[0].id;
    
    function computeDepth(person, currentDepth) {
        if (!person) return;
        depthMap.set(person.id, currentDepth);
        if (person.parents && person.parents.length) {
            let parentsArray = typeof person.parents === 'string' ? JSON.parse(person.parents) : person.parents;
            for (let pid of parentsArray) {
                const par = FAMILY_DB.people.find(p => p.id === pid);
                if (par && !depthMap.has(par.id)) {
                    computeDepth(par, currentDepth + 1);
                }
            }
        }
    }
    
    const targetPerson = ancestors.find(a => a.id === targetId);
    if (targetPerson) computeDepth(targetPerson, 0);
    
    const groups = new Map();
    for (let anc of ancestors) {
        let d = depthMap.get(anc.id);
        if (d !== undefined) {
            if (!groups.has(d)) groups.set(d, []);
            groups.get(d).push(anc);
        }
    }
    
    const depths = Array.from(groups.keys()).sort((a, b) => b - a);
    const result = [];
    for (let depth of depths) {
        result.push(groups.get(depth));
    }
    
    return result;
}

function renderLineageView(searchTerm) {
    const container = document.getElementById("visualTreeContainer");
    const titleSpan = document.getElementById("treeTitle");
    
    if (!searchTerm || searchTerm.trim() === "") {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">🌱 Enter a name to see their ancestors.</div>`;
        return;
    }
    
    const person = findPersonByPartialName(searchTerm);
    if (!person) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">🍂 No records found for "${escapeHtml(searchTerm)}"<br><br>💡 Try contributing your family using the "Add Your Details" tab!</div>`;
        return;
    }
    
    const ancestorsList = getAncestors(person);
    const uniqueAncestors = [];
    const seenIds = new Set();
    for (let a of ancestorsList) {
        if (!seenIds.has(a.id)) {
            seenIds.add(a.id);
            uniqueAncestors.push(a);
        }
    }
    
    const generations = buildLineageGenerations(uniqueAncestors);
    titleSpan.innerHTML = `📜 Lineage of ${escapeHtml(person.name)}`;
    
    let html = `<div class="family-tree">`;
    let generationCounter = 1;
    for (let idx = 0; idx < generations.length; idx++) {
        const level = generations[idx];
        if (level.length === 0) continue;
        
        const isLastLevel = (idx === generations.length - 1);
        const labelText = isLastLevel ? `📍 Generation ${generationCounter} (You)` : `📍 Generation ${generationCounter}`;
        
        html += `<div class="gen-label">${labelText}</div>`;
        html += `<div class="generation">`;
        for (let member of level) {
            const canEdit = canEditPerson(member.id);
            const editIcon = canEdit ? ' ✏️' : ' 🔒';
            html += `<div class="tree-node" onclick="handleNodeClick('${member.id}', '${escapeHtml(member.name)}')"><strong>${escapeHtml(member.name)}</strong>${editIcon}</div>`;
        }
        html += `</div>`;
        if (idx < generations.length - 1) {
            html += `<div class="connector-line">▼</div>`;
        }
        generationCounter++;
    }
    html += `</div>`;
    container.innerHTML = html;
}

window.handleNodeClick = async function(personId, personName) {
    const person = FAMILY_DB.people.find(p => p.id === personId);
    if (!person) return;
    
    if (canEditPerson(personId)) {
        // User can edit - show edit modal
        showEditModal(person);
    } else {
        // User cannot edit - show notification
        alert(`🔒 You cannot edit "${person.name}" because you didn't add this record.\n\nPlease contact the administrator to request changes.`);
    }
};

function renderWholeFamilyTree() {
    const container = document.getElementById("visualTreeContainer");
    const titleSpan = document.getElementById("treeTitle");
    
    const clusters = findFamilyClusters();
    
    if (clusters.length === 0 || clusters.every(c => c.length === 0)) {
        container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">🌱 Not enough data to build the family tree. Add more family members using the "Add Your Details" tab!</div>`;
        return;
    }
    
    if (clusters.length === 1) {
        const family = getFamilyTreeForCluster(clusters[0]);
        titleSpan.innerHTML = `🌳 Complete Family Tree - ${family.familyName} (${family.memberCount} members)`;
        
        let html = `<div class="family-tree">`;
        for (let idx = 0; idx < family.generations.length; idx++) {
            const level = family.generations[idx];
            if (level.length === 0) continue;
            const generationNumber = idx + 1;
            const genLabel = generationNumber === 1 ? "👴👵 Oldest Generation" : `📍 Generation ${generationNumber}`;
            html += `<div class="gen-label">${genLabel}</div>`;
            html += `<div class="generation">`;
            for (let member of level) {
                const canEdit = canEditPerson(member.id);
                const editIcon = canEdit ? ' ✏️' : ' 🔒';
                html += `<div class="tree-node" onclick="handleNodeClick('${member.id}', '${escapeHtml(member.name)}')"><strong>${escapeHtml(member.name)}</strong>${editIcon}</div>`;
            }
            html += `</div>`;
            if (idx < family.generations.length - 1) {
                html += `<div class="connector-line">▼</div>`;
            }
        }
        html += `</div>`;
        container.innerHTML = html;
        
    } else {
        titleSpan.innerHTML = `🌳 Family Trees (${clusters.length} separate families found)`;
        
        let html = `<div style="display: flex; flex-direction: column; gap: 1rem;">`;
        
        for (let i = 0; i < clusters.length; i++) {
            const cluster = clusters[i];
            const family = getFamilyTreeForCluster(cluster);
            
            html += `<div class="family-separator">`;
            html += `<h3 class="family-heading">🏠 ${family.familyName} (${family.memberCount} members)</h3>`;
            html += `<div class="family-tree">`;
            
            for (let idx = 0; idx < family.generations.length; idx++) {
                const level = family.generations[idx];
                if (level.length === 0) continue;
                const generationNumber = idx + 1;
                const genLabel = generationNumber === 1 ? "👴👵 Oldest Generation" : `📍 Generation ${generationNumber}`;
                html += `<div class="gen-label">${genLabel}</div>`;
                html += `<div class="generation">`;
                for (let member of level) {
                    const canEdit = canEditPerson(member.id);
                    const editIcon = canEdit ? ' ✏️' : ' 🔒';
                    html += `<div class="tree-node" onclick="handleNodeClick('${member.id}', '${escapeHtml(member.name)}')"><strong>${escapeHtml(member.name)}</strong>${editIcon}</div>`;
                }
                html += `</div>`;
                if (idx < family.generations.length - 1) {
                    html += `<div class="connector-line">▼</div>`;
                }
            }
            html += `</div></div>`;
        }
        
        html += `</div>`;
        container.innerHTML = html;
    }
}

window.searchThisPerson = function(name) {
    document.getElementById('searchName').value = name;
    renderLineageView(name);
    document.getElementById('searchStatus').innerHTML = `🔍 Showing lineage for "${escapeHtml(name)}"`;
    document.querySelector('.tab-btn[data-tab="view"]').click();
};

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

async function addOrGetPerson(name, gender = 'unknown') {
    if (!name) return null;
    
    const validation = validateFullName(name);
    if (!validation.valid) {
        showError('contributeErrorMsg', validation.message);
        return null;
    }
    
    let existingPerson = findPersonByName(name);
    if (existingPerson) return existingPerson;
    
    const newId = nameToId(name);
    const newPerson = {
        id: newId,
        name: name,
        gender: gender,
        parents: JSON.stringify([])
    };
    
    try {
        await addPersonToDB(newPerson);
        await loadPeople();
        return findPersonByName(name);
    } catch (error) {
        console.error('Failed to add person:', error);
        return null;
    }
}

async function contributeToTree(event) {
    event.preventDefault();
    
    const userName = document.getElementById('userFullName').value.trim();
    const userGender = document.getElementById('userGender').value;
    const fatherName = getParentName('father');
    const motherName = getParentName('mother');
    
    const userValidation = validateFullName(userName);
    if (!userValidation.valid) {
        showError('contributeErrorMsg', `Your name: ${userValidation.message}`);
        return;
    }
    
    const existingUser = findPersonByName(userName);
    if (existingUser) {
        showError('contributeErrorMsg', `"${userName}" is already in the family tree! Try searching for them instead.`);
        return;
    }
    
    if (!isAdmin) {
        if (!fatherName || !motherName) {
            showError('contributeErrorMsg', '⚠️ Both father and mother names are required. Please provide both parents\' information.');
            return;
        }
    }
    
    if (fatherName && motherName) {
        const generationValidation = await validateParentsGeneration(fatherName, motherName);
        if (!generationValidation.valid) {
            showError('contributeErrorMsg', generationValidation.message);
            return;
        }
    }
    
    showSuccess('contributeSuccessMsg', 'Adding your information to the family tree...');
    
    try {
        let parentIds = [];
        
        if (fatherName) {
            const fatherValidation = validateFullName(fatherName);
            if (fatherValidation.valid) {
                const father = await addOrGetPerson(fatherName, 'male');
                if (father) parentIds.push(father.id);
            } else {
                showError('contributeErrorMsg', `Father's name: ${fatherValidation.message}`);
                return;
            }
        }
        
        if (motherName) {
            const motherValidation = validateFullName(motherName);
            if (motherValidation.valid) {
                const mother = await addOrGetPerson(motherName, 'female');
                if (mother) parentIds.push(mother.id);
            } else {
                showError('contributeErrorMsg', `Mother's name: ${motherValidation.message}`);
                return;
            }
        }
        
        const userId = nameToId(userName);
        const newUser = {
            id: userId,
            name: userName,
            gender: userGender,
            dob: document.getElementById('userDob').value || null,
            parents: JSON.stringify(parentIds)
        };
        
        await addPersonToDB(newUser);
        await loadPeople();
        
        // Set ownership for the new person
        if (!personOwners[userId]) {
            personOwners[userId] = currentUser;
            savePersonOwners();
        }
        
        let message = `✅ Successfully added "${userName}" to the family tree!`;
        if (fatherName) message += ` 👨 Father: ${fatherName}`;
        if (motherName) message += ` 👩 Mother: ${motherName}`;
        if (!fatherName && !motherName && isAdmin) message += ` (Added as root ancestor)`;
        
        if (fatherMode === 'select') {
            toggleParentMode('father');
        }
        if (motherMode === 'select') {
            toggleParentMode('mother');
        }
        
        document.getElementById('contributeForm').reset();
        document.getElementById('fatherName').value = '';
        document.getElementById('motherName').value = '';
        document.getElementById('fatherSelect').value = '';
        document.getElementById('motherSelect').value = '';
        
        showSuccess('contributeSuccessMsg', message);
        
        if (isAdmin) await updateAdminPanel();
        
    } catch (error) {
        showError('contributeErrorMsg', `Failed to add: ${error.message}. Please check your internet connection.`);
    }
}

async function updateAdminPanel() {
    if (!isAdmin) return;
    
    await loadPeople();
    
    document.getElementById('totalPeopleCount').textContent = FAMILY_DB.people.length;
    
    let maxDepth = 0;
    FAMILY_DB.people.forEach(person => {
        let depth = 0;
        let current = person;
        let parents = typeof current.parents === 'string' ? JSON.parse(current.parents) : current.parents;
        while(parents && parents.length > 0) {
            depth++;
            current = FAMILY_DB.people.find(p => p.id === parents[0]);
            if(!current) break;
            parents = typeof current.parents === 'string' ? JSON.parse(current.parents) : current.parents;
        }
        maxDepth = Math.max(maxDepth, depth);
    });
    document.getElementById('totalGenerations').textContent = maxDepth + 1;
    document.getElementById('totalContributors').textContent = FAMILY_DB.people.length;
    
    const namesGrid = document.getElementById('namesGrid');
    namesGrid.innerHTML = FAMILY_DB.people.map(person => `
        <div class="name-item">
            <div>
                <strong>${escapeHtml(person.name)}</strong>
                <br><small>ID: ${person.id} | ${person.dob || 'No DOB'} | Owner: ${personOwners[person.id] || 'Unknown'}</small>
            </div>
            <button class="delete-btn" onclick="deletePersonHandler('${person.id}')">🗑️ Delete</button>
        </div>
    `).join('');
}

window.deletePersonHandler = async function(personId) {
    if (!isAdmin) {
        alert('Only administrators can delete records.');
        return;
    }
    
    const person = FAMILY_DB.people.find(p => p.id === personId);
    if (!person) return;
    
    if (confirm(`Are you sure you want to delete "${person.name}"? This will also remove them from all family relationships.`)) {
        try {
            await deletePersonFromDB(personId);
            await updateAdminPanel();
            alert(`"${person.name}" deleted successfully!`);
        } catch (error) {
            alert(`Failed to delete: ${error.message}`);
        }
    }
};

function checkAuth() {
    currentUser = sessionStorage.getItem('currentUser');
    isAdmin = sessionStorage.getItem('isAdmin') === 'true';
    
    if (!currentUser) {
        window.location.href = 'login.html';
        return false;
    }
    
    document.getElementById('usernameDisplay').textContent = currentUser;
    if (isAdmin) {
        document.getElementById('adminBadge').style.display = 'inline-block';
        document.getElementById('adminTabBtn').style.display = 'block';
    }
    return true;
}

function logout() {
    sessionStorage.clear();
    window.location.href = 'login.html';
}

async function init() {
    if (!checkAuth()) return;
    
    try {
        await loadPeople();
        
        window.toggleParentMode = toggleParentMode;
        window.handleNodeClick = handleNodeClick;
        window.saveEdit = saveEdit;
        window.closeEditModal = closeEditModal;
        
        if (isAdmin) await updateAdminPanel();
        
        document.getElementById('visualTreeContainer').innerHTML = '<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">🔍 Enter a name above to explore the family tree.</div>';
        console.log('✅ App initialized with', FAMILY_DB.people.length, 'people');
    } catch (error) {
        console.error('Init error:', error);
        document.getElementById('visualTreeContainer').innerHTML = `
            <div style="text-align:center;padding:1.5rem;color:#c33;font-size:0.85rem;">
                ❌ Failed to load data: ${error.message}<br><br>
                <button onclick="location.reload()" class="submit-btn retry-btn">🔄 Retry</button>
            </div>
        `;
    }
}

function setupEventListeners() {
    document.getElementById('logoutBtn').addEventListener('click', logout);
    
    document.getElementById('searchForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const searchValue = document.getElementById('searchName').value;
        renderLineageView(searchValue);
    });
    
    document.getElementById('viewWholeTreeBtn').addEventListener('click', () => {
        renderWholeFamilyTree();
    });
    
    document.getElementById('exportDataBtn').addEventListener('click', () => {
        if (typeof exportToSpreadsheet === 'function') {
            exportToSpreadsheet();
        } else {
            console.log('Export function not loaded yet');
        }
    });
    
    document.getElementById('contributeForm').addEventListener('submit', contributeToTree);
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${tabName}Tab`).classList.add('active');
        });
    });
}

setupEventListeners();
init();