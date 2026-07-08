// ==============================================================
// VISUAL CONNECTORS — SVG OVERLAY  (connector_patch.js)
//   <script src="plat.js"></script>
//   <script src="connector_patch.js"></script>
// ==============================================================

// ── 0. Inject CSS once ──────────────────────────────────────
(function injectConnectorStyles() {
    if (document.getElementById('_connectorStyles')) return;
    const s = document.createElement('style');
    s.id = '_connectorStyles';
    s.textContent = `
        .gen-connector-wrap {
            position: relative;
            width: 100%;
            padding-bottom: 4px;
        }
        .connector-svg {
            position: absolute;
            top: 0; left: 0;
            pointer-events: none;
            overflow: visible;
            z-index: 5;
        }
        .tree-node[data-pid] {
            position: relative;
            z-index: 6;
        }
    `;
    document.head.appendChild(s);
})();


// ── 1. Patch buildNodeHtml to stamp data-pid ────────────────
(function patchBuildNodeHtml() {
    const _orig = window.buildNodeHtml;
    if (!_orig) { console.warn('[connector_patch] buildNodeHtml not found'); return; }
    window.buildNodeHtml = function(person, extraClass = '', onClick = null) {
        let html = _orig(person, extraClass, onClick);
        html = html.replace(/(<div\s)(class="tree-node)/, `$1data-pid="${person.id}" $2`);
        return html;
    };
})();


// ── 2. Patch renderWholeFamilyTree ───────────────────────────
(function patchRenderWholeFamilyTree() {
    const _orig = window.renderWholeFamilyTree;
    if (!_orig) { console.warn('[connector_patch] renderWholeFamilyTree not found'); return; }
    window.renderWholeFamilyTree = function() {
        _orig();
        _wrapAndDraw('wholeTreeContainer');
    };
})();


// ── 3. Redraw on resize ──────────────────────────────────────
let _resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => _wrapAndDraw('wholeTreeContainer'), 250);
});


// ── 4. Wrap helper ───────────────────────────────────────────
function _wrapAndDraw(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.querySelectorAll('.generations-tree').forEach(tree => {
        if (tree.parentElement.classList.contains('gen-connector-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'gen-connector-wrap';
        tree.parentNode.insertBefore(wrap, tree);
        wrap.appendChild(tree);
    });

    // Double rAF — ensures layout is fully settled before measuring
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            container.querySelectorAll('.gen-connector-wrap').forEach(wrap => {
                _paintConnectors(wrap);
            });
        });
    });
}


// ── 5. Core painter ─────────────────────────────────────────
function _paintConnectors(wrap) {
    wrap.querySelectorAll('.connector-svg').forEach(s => s.remove());

    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width) return;

    // Measure every node relative to wrap
    const nodeMap = {};
    wrap.querySelectorAll('.tree-node[data-pid]').forEach(el => {
        const pid = el.getAttribute('data-pid');
        if (!pid || pid === '__na__') return;
        const r = el.getBoundingClientRect();
        nodeMap[pid] = {
            cx:     r.left - wrapRect.left + r.width  / 2,
            cy:     r.top  - wrapRect.top  + r.height / 2,
            top:    r.top    - wrapRect.top,
            bottom: r.bottom - wrapRect.top,
        };
    });

    if (!Object.keys(nodeMap).length) return;

    // SVG sized to exactly contain all nodes
    const svgW = wrapRect.width;
    const svgH = Math.max(wrapRect.height, Math.max(...Object.values(nodeMap).map(n => n.bottom)) + 40);

    // Build child→parents and couple→children maps
    const pairChildren  = new Map(); // sortedParentKey → [childIds]
    const personParents = {};        // childId → [visibleParentIds]

    FAMILY_DB.people.forEach(p => {
        const parents = getParentsArray(p).filter(id => id !== '__na__' && nodeMap[id]);
        if (!parents.length) return;
        personParents[p.id] = parents;
        const key = [...parents].sort().join('|');
        if (!pairChildren.has(key)) pairChildren.set(key, []);
        pairChildren.get(key).push(p.id);
    });

    const lines   = [];
    const circles = [];

    const C_COUPLE  = '#b08052';
    const C_SIBLING = '#7aaa8a';
    const C_DROP    = '#b08052';

    // ── A. Couple bracket + individual curves to each child ──
    // Key insight: instead of one vertical drop to a collector bar
    // we draw an individual bezier from the couple midpoint directly
    // to each child's top-centre. This works correctly on mobile
    // regardless of where flex wrapping places the child.
    const drawnCouples = new Set();

    FAMILY_DB.people.forEach(p => {
        const parents = personParents[p.id];
        if (!parents || parents.length < 2) return;
        const [p1id, p2id] = parents;
        if (!nodeMap[p1id] || !nodeMap[p2id]) return;

        const coupleKey = [p1id, p2id].sort().join('|');

        const n1 = nodeMap[p1id];
        const n2 = nodeMap[p2id];

        // Draw the couple bracket only once
        if (!drawnCouples.has(coupleKey)) {
            drawnCouples.add(coupleKey);

            // Only draw bracket if both parents are on roughly the same row
            if (Math.abs(n1.cy - n2.cy) <= 50) {
                const L    = n1.cx < n2.cx ? n1 : n2;
                const R    = n1.cx < n2.cx ? n2 : n1;
                const barY = Math.max(L.bottom, R.bottom) + 12;
                const midX = (L.cx + R.cx) / 2;

                // Legs down from each parent to bar
                lines.push({ d: `M ${L.cx} ${L.bottom + 2} L ${L.cx} ${barY}`, stroke: C_COUPLE, width: 1.8, dash: '' });
                lines.push({ d: `M ${R.cx} ${R.bottom + 2} L ${R.cx} ${barY}`, stroke: C_COUPLE, width: 1.8, dash: '' });
                // Horizontal dashed bar
                lines.push({ d: `M ${L.cx} ${barY} L ${R.cx} ${barY}`, stroke: C_COUPLE, width: 2, dash: '5,3' });
                // Midpoint dot
                circles.push({ cx: midX, cy: barY, r: 3.5, fill: C_COUPLE });
            }
        }

        // Draw a bezier from couple midpoint to THIS child specifically
        // Recalculate barY and midX fresh for this child's parents
        const L2    = n1.cx < n2.cx ? n1 : n2;
        const R2    = n1.cx < n2.cx ? n2 : n1;
        const barY2 = Math.abs(n1.cy - n2.cy) <= 50
            ? Math.max(L2.bottom, R2.bottom) + 12
            : Math.max(n1.bottom, n2.bottom) + 12;
        const midX2 = (n1.cx + n2.cx) / 2;

        if (!nodeMap[p.id]) return;
        const child = nodeMap[p.id];

        // Start from couple bar midpoint, curve to child top-centre
        const startX = midX2;
        const startY = barY2;
        const endX   = child.cx;
        const endY   = child.top - 2;

        if (endY <= startY) return; // child is above or same row — skip

        // Control points: start goes straight down, end comes straight up
        // This gives a natural S-curve on mobile when child is offset horizontally
        const span   = Math.abs(endX - startX);
        const drop   = endY - startY;
        // Vertical bias: more vertical control point offset for tall drops,
        // more horizontal spread for wide offsets
        const cp1x = startX;
        const cp1y = startY + Math.max(drop * 0.45, 20);
        const cp2x = endX;
        const cp2y = endY - Math.max(drop * 0.45, 20);

        lines.push({
            d: `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`,
            stroke: C_DROP, width: 1.8, dash: ''
        });
    });

    // ── B. Sibling spans (single visible parent) ─────────────
    pairChildren.forEach((childIds, key) => {
        if (drawnCouples.has(key)) return;

        const visible = childIds.filter(id => nodeMap[id]);
        if (visible.length < 2) return;

        visible.sort((a, b) => nodeMap[a].cx - nodeMap[b].cx);
        const topY = Math.min(...visible.map(id => nodeMap[id].top)) - 10;
        const x1   = nodeMap[visible[0]].cx;
        const x2   = nodeMap[visible[visible.length - 1]].cx;

        // Use the family color of the parent if one is assigned, else fall back to C_SIBLING
        const parentId = key.split('|')[0];
        const parentPerson = FAMILY_DB.people.find(p => p.id === parentId);
        const siblingColor = (parentPerson?.family_name && typeof getColorForFamily === 'function')
            ? (getColorForFamily(parentPerson.family_name) || C_SIBLING)
            : C_SIBLING;

        lines.push({ d: `M ${x1} ${topY} L ${x2} ${topY}`, stroke: siblingColor, width: 1.8, dash: '4,4' });
        visible.forEach(id => {
            const n = nodeMap[id];
            lines.push({ d: `M ${n.cx} ${topY} L ${n.cx} ${n.top - 2}`, stroke: siblingColor, width: 1.5, dash: '' });
        });
    });

    // ── C. Single-parent bezier drops ───────────────────────
    FAMILY_DB.people.forEach(p => {
        const parents = personParents[p.id];
        if (!parents || !nodeMap[p.id]) return;

        // Skip if both parents are visible — handled in section A
        if (parents.length >= 2 && nodeMap[parents[0]] && nodeMap[parents[1]]) return;

        const visParents = parents.filter(pid => nodeMap[pid]);
        if (!visParents.length) return;

        const child = nodeMap[p.id];
        visParents.forEach(pid => {
            const par  = nodeMap[pid];
            const x1   = par.cx,    y1 = par.bottom + 2;
            const x2   = child.cx,  y2 = child.top  - 2;
            if (y2 <= y1) return;
            const drop = y2 - y1;
            lines.push({
                d: `M ${x1} ${y1} C ${x1} ${y1 + drop * 0.45}, ${x2} ${y2 - drop * 0.45}, ${x2} ${y2}`,
                stroke: C_DROP, width: 1.5, dash: ''
            });
        });
    });

    // ── D. Spouse connectors (solid blue line) ──────────────────
    for (const p of FAMILY_DB.people) {
        if (!p.spouse) continue;
        if (!nodeMap[p.id] || !nodeMap[p.spouse]) continue;
        const n1 = nodeMap[p.id];
        const n2 = nodeMap[p.spouse];
        lines.push({
            d: `M ${n1.cx} ${n1.cy} L ${n2.cx} ${n2.cy}`,
            stroke: '#3a7abf',
            width: 2.5,
            dash: ''
        });
    }

    // ── Render SVG with explicit pixel dimensions ────────────
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'connector-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('width',   svgW);
    svg.setAttribute('height',  svgH);
    svg.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    svg.style.maxWidth = '100%';

    lines.forEach(spec => {
        const el = document.createElementNS(SVG_NS, 'path');
        el.setAttribute('d', spec.d);
        el.setAttribute('stroke', spec.stroke);
        el.setAttribute('stroke-width', spec.width);
        el.setAttribute('fill', 'none');
        el.setAttribute('opacity', '0.8');
        el.setAttribute('stroke-linecap', 'round');
        if (spec.dash) el.setAttribute('stroke-dasharray', spec.dash);
        svg.appendChild(el);
    });

    circles.forEach(spec => {
        const el = document.createElementNS(SVG_NS, 'circle');
        el.setAttribute('cx', spec.cx);
        el.setAttribute('cy', spec.cy);
        el.setAttribute('r',  spec.r);
        el.setAttribute('fill', spec.fill);
        el.setAttribute('opacity', '0.9');
        svg.appendChild(el);
    });

    wrap.appendChild(svg);
    wrap.style.minHeight = svgH + 'px';
}