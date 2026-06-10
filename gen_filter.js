// ==============================================================
// GENERATION FILTER — gen_filter.js
// Drop-in addition to Ancestral Threads. Load AFTER plat.js.
// Adds a filter bar above the Whole Family Tree that shows only
// members of a chosen generation number across all clusters.
// Zero existing plat.js logic is modified.
// ==============================================================

(function () {

    // ── State ──────────────────────────────────────────────────
    let activeFilter = null; // null = show all, number = show that gen (1-based)

    // ── Inject the filter bar HTML ─────────────────────────────
    function injectFilterBar() {
        const searchSection = document.querySelector('#wholetreeTab .search-section');
        if (!searchSection || document.getElementById('genFilterBar')) return;

        const bar = document.createElement('div');
        bar.id = 'genFilterBar';
        bar.style.cssText = `
            display:flex;align-items:center;flex-wrap:wrap;gap:0.5rem;
            padding:0.6rem 1rem;background:#fef7ed;border-top:1px solid #e2cfb0;
            font-size:0.82rem;
        `;
        bar.innerHTML = `
            <label for="genFilterInput" style="font-weight:600;color:#5a3e2b;white-space:nowrap;">
                🔎 Filter by generation:
            </label>
            <input
                type="number" id="genFilterInput" min="1" placeholder="e.g. 2"
                style="width:70px;padding:0.35rem 0.5rem;border:1px solid #c2894b;
                       border-radius:0.5rem;font-size:0.82rem;text-align:center;">
            <button id="genFilterApply"
                style="background:#5a3e2b;color:white;border:none;border-radius:0.5rem;
                       padding:0.35rem 0.8rem;cursor:pointer;font-size:0.82rem;">
                Apply
            </button>
            <button id="genFilterClear"
                style="background:#6c757d;color:white;border:none;border-radius:0.5rem;
                       padding:0.35rem 0.8rem;cursor:pointer;font-size:0.82rem;display:none;">
                ✕ Clear
            </button>
            <span id="genFilterStatus" style="color:#9e6d42;font-size:0.78rem;"></span>
        `;

        searchSection.appendChild(bar);

        document.getElementById('genFilterApply').addEventListener('click', applyFilter);
        document.getElementById('genFilterClear').addEventListener('click', clearFilter);
        document.getElementById('genFilterInput').addEventListener('keydown', e => {
            if (e.key === 'Enter') applyFilter();
        });
    }

    // ── Apply filter ───────────────────────────────────────────
    function applyFilter() {
        const raw = document.getElementById('genFilterInput').value.trim();
        const num = parseInt(raw, 10);
        if (!raw || isNaN(num) || num < 1) {
            setStatus('⚠️ Enter a generation number ≥ 1', '#c33');
            return;
        }
        activeFilter = num;
        document.getElementById('genFilterClear').style.display = 'inline-block';
        renderFiltered();
    }

    // ── Clear filter ───────────────────────────────────────────
    function clearFilter() {
        activeFilter = null;
        document.getElementById('genFilterInput').value = '';
        document.getElementById('genFilterClear').style.display = 'none';
        setStatus('');
        // Delegate back to plat.js's own renderer
        if (typeof renderWholeFamilyTree === 'function') renderWholeFamilyTree();
    }

    function setStatus(msg, color) {
        const el = document.getElementById('genFilterStatus');
        if (el) { el.textContent = msg; el.style.color = color || '#9e6d42'; }
    }

    // ── Filtered render ────────────────────────────────────────
    function renderFiltered() {
        const container = document.getElementById('wholeTreeContainer');
        const titleEl   = document.getElementById('wholeTreeTitle');
        if (!container) return;

        // Use plat.js globals & functions directly (read-only)
        const clusters  = findFamilyClusters();       // from plat.js
        const genTarget = activeFilter - 1;           // convert 1-based UI → 0-based depth

        // Collect members at the target depth across all clusters
        let totalMatches = 0;

        if (!clusters.length) {
            container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">
                🌱 No data yet.</div>`;
            return;
        }

        titleEl.innerHTML = `🌳 Whole Family Tree — Generation ${activeFilter} only`;

        if (typeof renderLegend === 'function') renderLegend('wholeTreeLegend');

        // Build HTML for each cluster
        let outerHtml = '';
        const multiCluster = clusters.length > 1;

        clusters.forEach(cluster => {
            const members = cluster.filter(
                p => getPersonGenerationLevel(p) === genTarget   // from plat.js
            );

            if (!members.length) return; // skip clusters with no one at this gen

            totalMatches += members.length;

            // Pair spouses the same way buildWholeTreeRows does (read-only copy)
            const clusterIds = new Set(cluster.map(p => p.id));
            const spouseMap  = new Map();
            for (const p of cluster) {
                const parents = getParentsArray(p).filter(pid => clusterIds.has(pid));
                if (parents.length >= 2) {
                    const [a, b] = parents;
                    if (!spouseMap.has(a)) spouseMap.set(a, new Set());
                    if (!spouseMap.has(b)) spouseMap.set(b, new Set());
                    spouseMap.get(a).add(b);
                    spouseMap.get(b).add(a);
                }
            }

            const paired  = new Set();
            const ordered = [];
            for (const person of members) {
                if (paired.has(person.id)) continue;
                const spouses = spouseMap.get(person.id);
                if (spouses && spouses.size) {
                    const spouseInRow = Array.from(spouses).find(sid => members.some(p => p.id === sid));
                    if (spouseInRow && !paired.has(spouseInRow)) {
                        const spouseObj = members.find(p => p.id === spouseInRow);
                        ordered.push(person, spouseObj);
                        paired.add(person.id);
                        paired.add(spouseObj.id);
                        continue;
                    }
                }
                ordered.push(person);
                paired.add(person.id);
            }

            const nodesHtml = ordered.map(m => buildNodeHtml(m)).join('');  // from plat.js

            if (multiCluster) {
                const fn = clusterFamilyName(cluster);   // from plat.js
                outerHtml += `
                    <div class="family-separator">
                        <h3 class="family-heading">🏠 ${escapeHtml(fn)} — ${members.length} member${members.length !== 1 ? 's' : ''}</h3>
                        <div class="generations-tree">
                            <div class="gen-label">📍 Generation ${activeFilter}</div>
                            <div class="generation">${nodesHtml}</div>
                        </div>
                    </div>`;
            } else {
                outerHtml += `
                    <div class="generations-tree">
                        <div class="gen-label">📍 Generation ${activeFilter}</div>
                        <div class="generation">${nodesHtml}</div>
                    </div>`;
            }
        });

        if (!outerHtml) {
            container.innerHTML = `<div style="text-align:center;padding:1.5rem;font-size:0.85rem;">
                🍂 No members found in Generation ${activeFilter}.</div>`;
            setStatus(`No members in Generation ${activeFilter}.`, '#c33');
            return;
        }

        container.innerHTML = multiCluster
            ? `<div style="display:flex;flex-direction:column;gap:1rem;">${outerHtml}</div>`
            : outerHtml;

        setStatus(`Showing ${totalMatches} member${totalMatches !== 1 ? 's' : ''} in Generation ${activeFilter}.`);
    }

    // ── Intercept tab activation so filter re-applies on tab switch ──
    function patchTabListener() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tab === 'wholetree' && activeFilter !== null) {
                    // Re-run filtered render after plat.js's own renderWholeFamilyTree fires
                    setTimeout(renderFiltered, 0);
                }
            });
        });
    }

    // ── Patch renderWholeFamilyTree so filter persists after adds/edits ──
    function patchRenderWholeFamilyTree() {
        const original = window.renderWholeFamilyTree;
        if (!original) return;
        window.renderWholeFamilyTree = function (...args) {
            original.apply(this, args);
            if (activeFilter !== null) {
                // Run after the original render settles
                setTimeout(renderFiltered, 0);
            }
        };
    }

    // ── Init ───────────────────────────────────────────────────
    function init() {
        injectFilterBar();
        patchTabListener();
        patchRenderWholeFamilyTree();
    }

    // Wait for DOM + plat.js to finish
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        // plat.js calls init() which is async; defer slightly so plat.js
        // globals (FAMILY_DB, etc.) are populated before we patch anything.
        setTimeout(init, 0);
    }

})();