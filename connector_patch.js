// ==============================================================
// VISUAL CONNECTORS — SVG OVERLAY  (connector_patch.js)
// Drop this file after plat.js in platform.html:
//   <script src="plat.js"></script>
//   <script src="connector_patch.js"></script>
//
// What it draws:
//  ● Couple line  — dashed horizontal bar between two co-parents,
//                   with a ● midpoint dot and a drop line to children
//  ● Sibling span — dashed horizontal span above siblings that share
//                   the same parents, with short tick marks down to
//                   each sibling's top edge
//  ● Single-parent drop — smooth bezier curve from a solo parent
//                         straight down to their child
//
// Technique: post-render SVG overlay.  After the DOM paints we
// measure every .tree-node[data-pid] with getBoundingClientRect,
// then draw SVG paths that sit absolutely over the tree.
// pointer-events:none means all clicks still reach the nodes.
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
            /* add bottom padding so sibling ticks aren't clipped */
            padding-bottom: 4px;
        }
        .connector-svg {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            overflow: visible;
            z-index: 5;
        }
        /* nodes must sit above the SVG so hover/click still work */
        .tree-node[data-pid] {
            position: relative;
            z-index: 6;
        }
    `;
    document.head.appendChild(s);
})();


// ── 1. Patch buildNodeHtml to stamp data-pid on every node ──
//    Must run after plat.js has defined buildNodeHtml.
(function patchBuildNodeHtml() {
    const _orig = window.buildNodeHtml;
    if (!_orig) {
        console.warn('[connector_patch] buildNodeHtml not found — load this file after plat.js');
        return;
    }
    window.buildNodeHtml = function(person, extraClass = '', onClick = null) {
        let html = _orig(person, extraClass, onClick);
        // Stamp the person id as a data attribute for measurement
        html = html.replace(
            /(<div\s)(class="tree-node)/,
            `$1data-pid="${person.id}" $2`
        );
        return html;
    };
})();


// ── 2. Patch renderWholeFamilyTree to wrap & draw ────────────
(function patchRenderWholeFamilyTree() {
    const _orig = window.renderWholeFamilyTree;
    if (!_orig) {
        console.warn('[connector_patch] renderWholeFamilyTree not found');
        return;
    }
    window.renderWholeFamilyTree = function() {
        _orig();
        _wrapAndDraw('wholeTreeContainer');
    };
})();


// ── 3. Re-draw on resize ─────────────────────────────────────
let _resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(() => _wrapAndDraw('wholeTreeContainer'), 220);
});


// ── 4. Wrap helper ───────────────────────────────────────────
function _wrapAndDraw(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Wrap every .generations-tree that isn't already wrapped
    container.querySelectorAll('.generations-tree').forEach(tree => {
        if (tree.parentElement.classList.contains('gen-connector-wrap')) return;
        const wrap = document.createElement('div');
        wrap.className = 'gen-connector-wrap';
        tree.parentNode.insertBefore(wrap, tree);
        wrap.appendChild(tree);
    });

    // One rAF so the browser has finished layout after the wrap insertion
    requestAnimationFrame(() => {
        container.querySelectorAll('.gen-connector-wrap').forEach(wrap => {
            _paintConnectors(wrap);
        });
    });
}


// ── 5. Core painter ─────────────────────────────────────────
function _paintConnectors(wrap) {
    // Remove stale SVG from previous render
    wrap.querySelectorAll('.connector-svg').forEach(s => s.remove());

    const wrapRect = wrap.getBoundingClientRect();
    if (!wrapRect.width) return;   // not visible yet

    // -- Build nodeMap: personId → geometry relative to wrap --
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
            left:   r.left   - wrapRect.left,
            right:  r.right  - wrapRect.left,
        };
    });

    if (!Object.keys(nodeMap).length) return;

    // -- Build relationship maps from FAMILY_DB --
    // pairKey (sorted parent ids) → [childIds visible in this wrap]
    const pairChildren  = new Map();
    const personParents = {};   // childId → [parentIds visible here]

    FAMILY_DB.people.forEach(p => {
        const parents = getParentsArray(p).filter(id => id !== '__na__' && nodeMap[id]);
        if (!parents.length) return;
        personParents[p.id] = parents;
        const key = [...parents].sort().join('|');
        if (!pairChildren.has(key)) pairChildren.set(key, []);
        pairChildren.get(key).push(p.id);
    });

    // -- Accumulate SVG element specs --
    const lines   = [];   // { d, stroke, width, dash }
    const circles = [];   // { cx, cy, r, fill }

    const C_COUPLE  = '#b08052';   // warm brown  — couple bracket
    const C_SIBLING = '#7aaa8a';   // sage green  — sibling span
    const C_DROP    = '#b08052';   // same brown  — parent→child drop

    // ── A. Couple brackets + drop to children ───────────────
    const drawnCouples = new Set();

    FAMILY_DB.people.forEach(p => {
        const parents = personParents[p.id];
        if (!parents || parents.length < 2) return;
        const [p1id, p2id] = parents;
        if (!nodeMap[p1id] || !nodeMap[p2id]) return;

        const coupleKey = [p1id, p2id].sort().join('|');
        if (drawnCouples.has(coupleKey)) return;
        drawnCouples.add(coupleKey);

        const n1 = nodeMap[p1id];
        const n2 = nodeMap[p2id];

        // Only draw if both parents sit on roughly the same row
        if (Math.abs(n1.cy - n2.cy) > 40) return;

        const L = n1.cx < n2.cx ? n1 : n2;
        const R = n1.cx < n2.cx ? n2 : n1;

        // Horizontal couple bar — sits just below both nodes' bottoms
        const barY  = Math.max(L.bottom, R.bottom) + 10;
        const midX  = (L.cx + R.cx) / 2;

        // Short vertical legs from each parent down to the bar
        lines.push({ d: `M ${L.cx} ${L.bottom + 2} L ${L.cx} ${barY}`, stroke: C_COUPLE, width: 1.8, dash: '' });
        lines.push({ d: `M ${R.cx} ${R.bottom + 2} L ${R.cx} ${barY}`, stroke: C_COUPLE, width: 1.8, dash: '' });
        // Horizontal bar between the legs
        lines.push({ d: `M ${L.cx} ${barY} L ${R.cx} ${barY}`, stroke: C_COUPLE, width: 2, dash: '5,3' });
        // ● midpoint dot
        circles.push({ cx: midX, cy: barY, r: 3.5, fill: C_COUPLE });

        // Drop from midpoint to children row
        const kids = (pairChildren.get(coupleKey) || []).filter(cid => nodeMap[cid]);
        if (kids.length) {
            const minTop = Math.min(...kids.map(cid => nodeMap[cid].top));
            const dropEndY = minTop - 10;
            if (dropEndY > barY) {
                lines.push({ d: `M ${midX} ${barY} L ${midX} ${dropEndY}`, stroke: C_DROP, width: 1.8, dash: '' });
            }
            // Horizontal collector bar just above the children row
            if (kids.length > 1) {
                kids.sort((a, b) => nodeMap[a].cx - nodeMap[b].cx);
                const lx = nodeMap[kids[0]].cx;
                const rx = nodeMap[kids[kids.length - 1]].cx;
                lines.push({ d: `M ${lx} ${dropEndY} L ${rx} ${dropEndY}`, stroke: C_DROP, width: 1.8, dash: '' });
            }
            // Short tick from collector bar down to each child
            kids.forEach(cid => {
                const cn = nodeMap[cid];
                lines.push({ d: `M ${cn.cx} ${dropEndY} L ${cn.cx} ${cn.top - 2}`, stroke: C_DROP, width: 1.5, dash: '' });
            });
        }
    });

    // ── B. Sibling spans (same-parent siblings, no couple line) ─
    // Only needed when the parents share exactly one visible parent
    // (single-parent case) — siblings with two visible parents are
    // already connected through the couple-drop collector bar above.
    pairChildren.forEach((childIds, key) => {
        // Skip pairs that were already handled by couple-bracket logic
        if (drawnCouples.has(key)) return;

        const visible = childIds.filter(id => nodeMap[id]);
        if (visible.length < 2) return;

        visible.sort((a, b) => nodeMap[a].cx - nodeMap[b].cx);
        const topY = Math.min(...visible.map(id => nodeMap[id].top)) - 10;
        const x1   = nodeMap[visible[0]].cx;
        const x2   = nodeMap[visible[visible.length - 1]].cx;

        // Horizontal dashed sibling span
        lines.push({ d: `M ${x1} ${topY} L ${x2} ${topY}`, stroke: C_SIBLING, width: 1.8, dash: '4,4' });

        // Tick marks from span down to each sibling's top
        visible.forEach(id => {
            const n = nodeMap[id];
            lines.push({ d: `M ${n.cx} ${topY} L ${n.cx} ${n.top - 2}`, stroke: C_SIBLING, width: 1.5, dash: '' });
        });
    });

    // ── C. Single-parent bezier drops ───────────────────────
    FAMILY_DB.people.forEach(p => {
        const parents = personParents[p.id];
        if (!parents || !nodeMap[p.id]) return;

        // Handled by couple logic if both parents visible
        if (parents.length >= 2 && nodeMap[parents[0]] && nodeMap[parents[1]]) return;

        const visParents = parents.filter(pid => nodeMap[pid]);
        if (!visParents.length) return;

        const child = nodeMap[p.id];
        visParents.forEach(pid => {
            const par = nodeMap[pid];
            const x1 = par.cx, y1 = par.bottom + 2;
            const x2 = child.cx, y2 = child.top - 2;
            if (y2 <= y1) return;   // guard against same-row oddities
            // Gentle cubic bezier
            const cy1 = y1 + (y2 - y1) * 0.45;
            const cy2 = y1 + (y2 - y1) * 0.55;
            lines.push({
                d: `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`,
                stroke: C_DROP, width: 1.5, dash: ''
            });
        });
    });

    // -- Render SVG --
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'connector-svg');
    svg.setAttribute('aria-hidden', 'true');

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
}