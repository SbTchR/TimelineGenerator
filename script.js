const pxPerMm = 96 / 25.4;
const A4 = {
    portrait: { w: 210, h: 297 },
    landscape: { w: 297, h: 210 }
};

const state = {
    start: 1900,
    end: 2025,
    mainStep: 10,
    secondaryPerMain: 4,
    mmPerMain: 15,
    mainTickHeight: 20,
    secondaryTickHeight: 12,
    backgroundColor: '#f7f9fb',
    baselineColor: '#0f172a',
    mainTickColor: '#0f172a',
    secondaryTickColor: '#94a3b8',
    labelColor: '#0f172a',
    labelSize: 12,
    labelOffset: 6,
    labelFont: 'Space Grotesk',
    showSecondaryLabels: false,
    secondaryLabelSize: 10,
    secondaryLabelColor: '#6b7a90',
    secondaryLabelOffset: 4,
    secondaryLabelFont: 'Space Grotesk',
    timelineHeight: 520,
    padding: 60,
    eventBaseOffset: -120,
    periodBaseOffset: 60,
    events: [],
    periods: [],
    exportScale: 4,
    orientation: 'landscape'
};

const defaultState = JSON.parse(JSON.stringify(state));
let editingEventId = null;
let editingPeriodId = null;

const elTimeline = document.getElementById('timeline-space');
const elEventList = document.getElementById('event-list');
const elPeriodList = document.getElementById('period-list');
const elSettingsModal = document.getElementById('settings-modal');
const elTimelineScroll = document.getElementById('timeline-scroll');
const toggleListsBtn = document.getElementById('toggle-lists');
let listsVisible = true;

elTimelineScroll.style.height = Math.max(320, Number(state.timelineHeight) + 160) + 'px';

function toggleModal(show) {
    elSettingsModal.classList.toggle('hidden', !show);
}

toggleListsBtn?.addEventListener('click', () => {
    listsVisible = !listsVisible;
    document.body.classList.toggle('hide-lists', !listsVisible);
    toggleListsBtn.textContent = listsVisible ? 'Masquer listes' : 'Afficher listes';
});

document.getElementById('open-settings').addEventListener('click', () => toggleModal(true));
document.getElementById('close-settings').addEventListener('click', () => toggleModal(false));
document.getElementById('close-settings-btn').addEventListener('click', () => toggleModal(false));
document.getElementById('apply-settings').addEventListener('click', () => {
    toggleModal(false);
    renderTimeline();
});

document.querySelectorAll('[data-setting]').forEach(input => {
    input.addEventListener('input', () => {
        const key = input.dataset.setting;
        let val = input.value;
        if (input.type === 'number') val = parseFloat(val);
        if (input.type === 'checkbox') val = input.checked;
        state[key] = val;
        if (key === 'timelineHeight') {
            elTimelineScroll.style.height = Math.max(320, Number(state.timelineHeight) + 160) + 'px';
        }
        renderTimeline();
    });
});

document.getElementById('pdf-orientation').addEventListener('change', (e) => {
    state.orientation = e.target.value;
    renderTimeline();
});

document.getElementById('reset-settings').addEventListener('click', () => {
    Object.keys(defaultState).forEach(key => {
        if (key === 'events' || key === 'periods') return;
        state[key] = defaultState[key];
        const input = document.querySelector(`[data-setting="${key}"]`);
        if (input) {
            if (input.type === 'checkbox') input.checked = defaultState[key];
            else input.value = defaultState[key];
        }
    });
    elTimelineScroll.style.height = Math.max(320, Number(state.timelineHeight) + 160) + 'px';
    renderTimeline();
});

document.getElementById('clear-events').addEventListener('click', () => {
    state.events = [];
    editingEventId = null;
    document.getElementById('event-submit').textContent = "Ajouter l'événement";
    renderTimeline();
});
document.getElementById('clear-periods').addEventListener('click', () => {
    state.periods = [];
    editingPeriodId = null;
    document.getElementById('period-submit').textContent = "Ajouter la période";
    renderTimeline();
});

function loadImage(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
    });
}

const eventForm = document.getElementById('event-form');
eventForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const imageFile = data.get('image');
    const imgData = imageFile && imageFile.size ? await loadImage(imageFile) : null;
    const target = editingEventId ? state.events.find(ev => ev.id === editingEventId) : null;
    const payload = {
        title: data.get('title') || 'Événement',
        value: isNaN(parseFloat(data.get('value'))) ? state.start : parseFloat(data.get('value')),
        font: data.get('font'),
        fontSize: parseFloat(data.get('fontSize')) || 14,
        width: parseFloat(data.get('width')) || 120,
        textColor: data.get('textColor'),
        backgroundColor: data.get('backgroundColor'),
        backgroundOpacity: parseFloat(data.get('backgroundOpacity')) || 1,
        connectorColor: data.get('connectorColor'),
        showDate: data.get('showDate') === 'on',
        detail: data.get('detail') || '',
        image: imgData || target?.image || null,
        offsetX: target?.offsetX || 0,
        offsetY: target?.offsetY || 0,
        visible: target?.visible !== false
    };

    if (editingEventId) {
        if (target) Object.assign(target, payload);
        editingEventId = null;
        document.getElementById('event-submit').textContent = "Ajouter l'événement";
    } else {
        state.events.push({ id: crypto.randomUUID(), ...payload });
    }
    e.target.reset();
    renderTimeline();
});

const periodForm = document.getElementById('period-form');
periodForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = new FormData(e.target);
    const imageFile = data.get('image');
    const imgData = imageFile && imageFile.size ? await loadImage(imageFile) : null;
    const startVal = parseFloat(data.get('start'));
    const endVal = parseFloat(data.get('end'));
    const safeStart = isNaN(startVal) ? state.start : startVal;
    const safeEnd = isNaN(endVal) ? state.end : endVal;
    const target = editingPeriodId ? state.periods.find(pe => pe.id === editingPeriodId) : null;
    const payload = {
        title: data.get('title') || 'Période',
        start: Math.min(safeStart, safeEnd),
        end: Math.max(safeStart, safeEnd),
        style: data.get('style'),
        thickness: parseFloat(data.get('thickness')) || 4,
        rectHeight: parseFloat(data.get('rectHeight')) || 44,
        titleAlignment: data.get('titleAlignment'),
        fillColor: data.get('fillColor'),
        fillOpacity: parseFloat(data.get('fillOpacity')) || 0.45,
        textColor: data.get('textColor'),
        strokeColor: data.get('strokeColor'),
        font: data.get('font'),
        fontSize: parseFloat(data.get('fontSize')) || 14,
        showDate: data.get('showDate') === 'on',
        detail: data.get('detail') || '',
        image: imgData || target?.image || null,
        offsetX: target?.offsetX || 0,
        offsetY: target?.offsetY || 0,
        visible: target?.visible !== false
    };

    if (editingPeriodId) {
        if (target) Object.assign(target, payload);
        editingPeriodId = null;
        document.getElementById('period-submit').textContent = "Ajouter la période";
    } else {
        state.periods.push({ id: crypto.randomUUID(), ...payload });
    }
    e.target.reset();
    renderTimeline();
});

function valueToX(val) {
    const span = Math.max(state.end - state.start, 1e-6);
    const pxPerMain = state.mmPerMain * pxPerMm;
    return state.padding + ((val - state.start) / state.mainStep) * pxPerMain;
}

function timelineWidth() {
    const span = Math.max(state.end - state.start, 1e-6);
    const pxPerMain = state.mmPerMain * pxPerMm;
    return state.padding * 2 + (span / state.mainStep) * pxPerMain;
}

function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderGuides() {
    const guideLayer = document.createElement('div');
    guideLayer.className = 'guide-layer';
    const size = A4[state.orientation];
    const pageW = size.w * pxPerMm;
    const pageH = size.h * pxPerMm;

    // Vertical guides (pages width)
    for (let x = pageW; x < timelineWidth(); x += pageW) {
        const line = document.createElement('div');
        line.className = 'guide guide-vert';
        line.style.left = `${x}px`;
        guideLayer.appendChild(line);
    }

    // Horizontal guides (pages height) - Centered on baseline
    // Baseline is at state.timelineHeight / 2
    // We want a page center to align with baseline.
    // So grid starts at (timelineHeight/2) - (pageH/2)
    const centerY = state.timelineHeight / 2;
    const gridOriginY = centerY - pageH / 2;

    // Find first visible line
    // lineY = gridOriginY + k * pageH
    // We want lineY >= 0 (or slightly before)
    // k * pageH >= -gridOriginY => k >= -gridOriginY / pageH
    const startK = Math.floor(-gridOriginY / pageH);

    for (let k = startK; ; k++) {
        const y = gridOriginY + k * pageH;
        if (y > state.timelineHeight) break;

        if (y >= 0 && y <= state.timelineHeight) {
            const line = document.createElement('div');
            line.className = 'guide guide-horiz';
            line.style.top = `${y}px`;
            guideLayer.appendChild(line);
        }
    }

    elTimeline.appendChild(guideLayer);
}

function renderAxis() {
    const baseY = Number(state.timelineHeight) / 2;
    const axis = document.createElement('div');
    axis.className = 'baseline';
    axis.style.top = `${baseY}px`;
    axis.style.background = state.baselineColor;
    elTimeline.appendChild(axis);

    for (let v = state.start; v <= state.end + 1e-6; v += state.mainStep) {
        const x = valueToX(v);
        const tick = document.createElement('div');
        tick.className = 'tick main';
        tick.style.left = `${x}px`;
        tick.style.height = `${state.mainTickHeight}px`;
        tick.style.top = `${baseY - state.mainTickHeight}px`;
        tick.style.background = state.mainTickColor;
        elTimeline.appendChild(tick);

        if (state.secondaryPerMain > 0 && v + state.mainStep <= state.end + 1e-6) {
            for (let i = 1; i < state.secondaryPerMain; i++) {
                const ratio = i / state.secondaryPerMain;
                const xv = valueToX(v + ratio * state.mainStep);
                const sTick = document.createElement('div');
                sTick.className = 'tick secondary';
                sTick.style.left = `${xv}px`;
                sTick.style.height = `${state.secondaryTickHeight}px`;
                sTick.style.top = `${baseY - state.secondaryTickHeight}px`;
                sTick.style.background = state.secondaryTickColor;
                elTimeline.appendChild(sTick);

                if (state.showSecondaryLabels) {
                    const sLbl = document.createElement('div');
                    sLbl.className = 'tick-label secondary';
                    sLbl.style.top = `${baseY + state.secondaryLabelOffset}px`;
                    sLbl.style.color = state.secondaryLabelColor;
                    sLbl.style.fontSize = `${state.secondaryLabelSize}px`;
                    sLbl.style.fontFamily = state.secondaryLabelFont || state.labelFont;
                    sLbl.textContent = v + ratio * state.mainStep;
                    sLbl.style.left = `${xv}px`;
                    elTimeline.appendChild(sLbl);
                }
            }
        }

        const lbl = document.createElement('div');
        lbl.className = 'tick-label';
        lbl.style.top = `${baseY + state.labelOffset}px`;
        lbl.style.color = state.labelColor;
        lbl.style.fontSize = `${state.labelSize}px`;
        lbl.style.fontFamily = state.labelFont;
        lbl.textContent = v;
        lbl.style.left = `${x}px`;
        elTimeline.appendChild(lbl);
    }
}

function renderEvents() {
    const baseY = Number(state.timelineHeight) / 2 + Number(state.eventBaseOffset);
    const lines = [];
    state.events.forEach(evt => {
        if (evt.visible === false) return;
        const card = document.createElement('div');
        card.className = 'event draggable';
        card.dataset.id = evt.id;
        card.dataset.type = 'event';
        card.style.backgroundColor = hexToRgba(evt.backgroundColor || '#fff', evt.backgroundOpacity ?? 1);
        card.style.fontFamily = evt.font;
        card.style.color = evt.textColor;
        card.style.width = `${evt.width || 120}px`;

        const title = document.createElement('div');
        title.className = 'label';
        title.textContent = evt.title;
        title.style.fontSize = `${evt.fontSize * 1.15}px`;
        card.appendChild(title);

        if (evt.showDate !== false) {
            const date = document.createElement('div');
            date.className = 'date';
            date.textContent = evt.value;
            card.appendChild(date);
        }

        if (evt.detail) {
            const detail = document.createElement('div');
            detail.className = 'date';
            detail.style.marginTop = '4px';
            detail.textContent = evt.detail;
            detail.style.fontSize = `${evt.fontSize * 0.9}px`;
            card.appendChild(detail);
        }

        if (evt.image) {
            const img = document.createElement('img');
            img.src = evt.image;
            img.alt = evt.title;
            card.appendChild(img);
        }

        elTimeline.appendChild(card);

        const centerX = valueToX(evt.value) + (evt.offsetX || 0);
        const topY = baseY + (evt.offsetY || 0);
        card.style.left = `${centerX - card.offsetWidth / 2}px`;
        card.style.top = `${topY}px`;

        const baselineY = Number(state.timelineHeight) / 2;
        const yStart = (topY + card.offsetHeight / 2) < baselineY ? (topY + card.offsetHeight) : topY;
        lines.push({
            x1: centerX,
            y1: yStart,
            x2: valueToX(evt.value),
            y2: baselineY,
            color: evt.connectorColor || '#0f172a'
        });
    });
    return lines;
}

function renderPeriods() {
    const baseY = Number(state.timelineHeight) / 2 + Number(state.periodBaseOffset);
    state.periods.forEach(per => {
        if (per.visible === false) return;
        const wrap = document.createElement('div');
        wrap.className = `period draggable period-${per.style}`;
        wrap.dataset.id = per.id;
        wrap.dataset.type = 'period';
        const startX = valueToX(per.start);
        const endX = valueToX(per.end);
        const width = Math.max(12, endX - startX);
        const x = startX + (per.offsetX || 0);
        const y = baseY + (per.offsetY || 0);
        wrap.style.left = `${x}px`;
        wrap.style.top = `${y}px`;
        wrap.style.width = `${width}px`;

        const labelText = per.showDate !== false ? `${per.title} (${per.start} – ${per.end})` : per.title;
        const thickness = per.thickness ?? 4;
        const rectHeight = per.rectHeight ?? 44;
        const align = per.titleAlignment || 'middle';

        if (per.style === 'rect') {
            wrap.style.background = hexToRgba(per.fillColor, per.fillOpacity ?? 0.45);
            wrap.style.border = `${thickness}px solid ${hexToRgba(per.strokeColor, Math.min(1, (per.fillOpacity ?? 0.45) + 0.1))}`;
            wrap.style.height = `${rectHeight}px`;
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.alignItems = 'center';
            wrap.style.justifyContent = align === 'top' ? 'flex-start' : align === 'bottom' ? 'flex-end' : 'center';
            const label = document.createElement('div');
            label.className = 'period-label';
            label.textContent = labelText;
            label.style.color = per.textColor;
            label.style.fontFamily = per.font;
            label.style.fontSize = `${per.fontSize}px`;
            label.style.textAlign = 'center';
            label.style.width = '100%';
            wrap.appendChild(label);

            if (per.detail) {
                const detail = document.createElement('div');
                detail.className = 'period-detail';
                detail.textContent = per.detail;
                detail.style.color = per.textColor;
                detail.style.fontFamily = per.font;
                detail.style.fontSize = `${per.fontSize * 0.85}px`;
                detail.style.textAlign = 'center';
                detail.style.width = '100%';
                detail.style.opacity = '0.9';
                wrap.appendChild(detail);
            }

            if (per.image) {
                const img = document.createElement('img');
                img.src = per.image;
                img.alt = per.title;
                img.style.maxWidth = '90%';
                img.style.maxHeight = '80px';
                img.style.marginTop = '4px';
                img.style.objectFit = 'contain';
                wrap.appendChild(img);
            }
        } else {
            wrap.style.display = 'flex';
            wrap.style.flexDirection = 'column';
            wrap.style.alignItems = 'center';
            wrap.style.gap = align === 'middle' ? '0' : '6px';
            wrap.style.overflow = 'visible';
            const line = document.createElement('div');
            line.className = 'line';
            line.style.background = per.strokeColor;
            line.style.opacity = per.fillOpacity ?? 0.45;
            line.style.height = `${thickness}px`;
            line.style.position = 'relative';
            line.style.width = '100%';

            const capStart = document.createElement('div');
            capStart.className = 'cap start';
            capStart.style.background = per.strokeColor;
            capStart.style.opacity = per.fillOpacity ?? 1;
            line.appendChild(capStart);

            const capEnd = document.createElement('div');
            capEnd.className = 'cap end';
            capEnd.style.background = per.strokeColor;
            capEnd.style.opacity = per.fillOpacity ?? 1;
            line.appendChild(capEnd);

            const labelContainer = document.createElement('div');
            labelContainer.style.display = 'flex';
            labelContainer.style.flexDirection = 'column';
            labelContainer.style.alignItems = 'center';
            labelContainer.style.pointerEvents = 'none'; // So clicks pass through if overlay

            const label = document.createElement('div');
            label.className = 'period-label';
            label.textContent = labelText;
            label.style.color = per.textColor;
            label.style.fontFamily = per.font;
            label.style.fontSize = `${per.fontSize}px`;
            label.style.textAlign = 'center';
            labelContainer.appendChild(label);

            if (per.detail) {
                const detail = document.createElement('div');
                detail.className = 'period-detail';
                detail.textContent = per.detail;
                detail.style.color = per.textColor;
                detail.style.fontFamily = per.font;
                detail.style.fontSize = `${per.fontSize * 0.85}px`;
                detail.style.textAlign = 'center';
                detail.style.opacity = '0.9';
                labelContainer.appendChild(detail);
            }

            if (per.image) {
                const img = document.createElement('img');
                img.src = per.image;
                img.alt = per.title;
                img.style.maxWidth = '120px';
                img.style.maxHeight = '80px';
                img.style.marginTop = '4px';
                img.style.objectFit = 'contain';
                labelContainer.appendChild(img);
            }

            if (align === 'top') {
                wrap.appendChild(labelContainer);
                wrap.appendChild(line);
            } else if (align === 'bottom') {
                wrap.appendChild(line);
                wrap.appendChild(labelContainer);
            } else {
                wrap.appendChild(line);
                const overlay = labelContainer.cloneNode(true);
                overlay.style.position = 'absolute';
                overlay.style.top = '50%';
                overlay.style.left = '50%';
                overlay.style.transform = 'translate(-50%, -50%)';
                overlay.style.width = 'max-content';
                overlay.style.maxWidth = `${Math.max(width + 100, 200)}px`; // Allow some overflow for centered text
                wrap.style.padding = `${Math.max(8, per.fontSize)}px 0`;
                wrap.appendChild(overlay);
            }
        }
        elTimeline.appendChild(wrap);
    });
}

function renderConnectors(lines) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', timelineWidth());
    svg.setAttribute('height', state.timelineHeight);
    svg.classList.add('connector-layer');
    lines.forEach(line => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        el.setAttribute('x1', line.x1);
        el.setAttribute('y1', line.y1);
        el.setAttribute('x2', line.x2);
        el.setAttribute('y2', line.y2);
        el.style.stroke = line.color || 'rgba(15,23,42,0.45)';
        svg.appendChild(el);
    });
    elTimeline.appendChild(svg);
}

function attachDrag() {
    const items = elTimeline.querySelectorAll('.draggable');
    items.forEach(el => {
        el.onpointerdown = (ev) => {
            ev.preventDefault();
            const id = el.dataset.id;
            const type = el.dataset.type;
            const startX = ev.clientX;
            const startY = ev.clientY;
            const rect = el.getBoundingClientRect();
            const timelineRect = elTimeline.getBoundingClientRect();
            const initialLeft = rect.left - timelineRect.left;
            const initialTop = rect.top - timelineRect.top;
            const width = rect.width;

            const onMove = (eMove) => {
                const dx = eMove.clientX - startX;
                const dy = eMove.clientY - startY;
                if (type === 'period') {
                    el.style.top = `${initialTop + dy}px`;
                } else {
                    el.style.left = `${initialLeft + dx}px`;
                    el.style.top = `${initialTop + dy}px`;
                }
            };

            const onUp = (eUp) => {
                const dx = eUp.clientX - startX;
                const dy = eUp.clientY - startY;
                const target = type === 'event'
                    ? state.events.find(ev => ev.id === id)
                    : state.periods.find(pe => pe.id === id);
                if (target) {
                    if (type === 'event') {
                        const baseX = valueToX(target.value);
                        const baseY = Number(state.timelineHeight) / 2 + Number(state.eventBaseOffset);
                        target.offsetX = (initialLeft + dx + width / 2) - baseX;
                        target.offsetY = (initialTop + dy) - baseY;
                    } else {
                        const baseY = Number(state.timelineHeight) / 2 + Number(state.periodBaseOffset);
                        target.offsetX = 0;
                        target.offsetY = (initialTop + dy) - baseY;
                    }
                }
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                renderTimeline();
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        };
    });
}

function renderList(container, items, type) {
    container.innerHTML = '';
    items.forEach(item => {
        const pill = document.createElement('div');
        pill.className = 'pill';
        if (item.visible === false) pill.classList.add('pill-muted');
        const label = document.createElement('span');
        label.textContent = type === 'event' ? `${item.title} (${item.value})` : `${item.title} (${item.start}-${item.end})`;
        pill.appendChild(label);

        const toggle = document.createElement('button');
        toggle.textContent = item.visible === false ? 'Afficher' : 'Masquer';
        toggle.title = 'Afficher / masquer';
        toggle.addEventListener('click', () => {
            item.visible = !item.visible;
            renderTimeline();
        });
        pill.appendChild(toggle);

        const edit = document.createElement('button');
        edit.textContent = 'Éditer';
        edit.title = 'Modifier';
        edit.addEventListener('click', () => {
            if (type === 'event') {
                editingEventId = item.id;
                document.getElementById('event-submit').textContent = 'Mettre à jour';
                eventForm.title.value = item.title;
                eventForm.value.value = item.value;
                eventForm.font.value = item.font;
                eventForm.fontSize.value = item.fontSize;
                eventForm.textColor.value = item.textColor;
                eventForm.backgroundColor.value = item.backgroundColor;
                eventForm.backgroundOpacity.value = item.backgroundOpacity ?? 1;
                eventForm.detail.value = item.detail || '';
                eventForm.width.value = item.width || 120;
                eventForm.connectorColor.value = item.connectorColor || '#0f172a';
                eventForm.showDate.checked = item.showDate !== false;
            } else {
                editingPeriodId = item.id;
                document.getElementById('period-submit').textContent = 'Mettre à jour';
                periodForm.title.value = item.title;
                periodForm.start.value = item.start;
                periodForm.end.value = item.end;
                periodForm.style.value = item.style;
                periodForm.fillOpacity.value = item.fillOpacity ?? 0.45;
                periodForm.fillColor.value = item.fillColor;
                periodForm.textColor.value = item.textColor;
                periodForm.strokeColor.value = item.strokeColor;
                periodForm.fontSize.value = item.fontSize;
                periodForm.font.value = item.font;
                periodForm.thickness.value = item.thickness ?? 4;
                periodForm.titleAlignment.value = item.titleAlignment || 'middle';
                periodForm.showDate.checked = item.showDate !== false;
                periodForm.rectHeight.value = item.rectHeight || 44;
                periodForm.detail.value = item.detail || '';
            }
        });
        pill.appendChild(edit);

        const del = document.createElement('button');
        del.textContent = '×';
        del.title = 'Supprimer';
        del.addEventListener('click', () => {
            if (type === 'event') {
                state.events = state.events.filter(ev => ev.id !== item.id);
                if (editingEventId === item.id) {
                    editingEventId = null;
                    document.getElementById('event-submit').textContent = "Ajouter l'événement";
                    eventForm.reset();
                }
            } else {
                state.periods = state.periods.filter(pe => pe.id !== item.id);
                if (editingPeriodId === item.id) {
                    editingPeriodId = null;
                    document.getElementById('period-submit').textContent = "Ajouter la période";
                    periodForm.reset();
                }
            }
            renderTimeline();
        });
        pill.appendChild(del);

        container.appendChild(pill);
    });
}

function renderTimeline() {
    if (state.end <= state.start) state.end = state.start + 1;
    elTimeline.innerHTML = '';
    elTimeline.style.background = state.backgroundColor;
    elTimeline.style.height = `${state.timelineHeight}px`;
    elTimeline.style.width = `${timelineWidth()}px`;
    renderGuides();
    renderAxis();
    renderPeriods();
    const lines = renderEvents();
    renderConnectors(lines);
    attachDrag();
    renderList(elEventList, state.events, 'event');
    renderList(elPeriodList, state.periods, 'period');
}

async function ensureLibs() {
    const loadScript = (src) => new Promise((resolve, reject) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = resolve;
        el.onerror = reject;
        document.head.appendChild(el);
    });
    if (!window.html2canvas) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    }
    if (!window.jspdf) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    }
}

async function exportCanvas() {
    await ensureLibs();
    const rawScale = state.exportScale || 4;
    const safeScale = Math.max(0.5, rawScale); // pas de limite haute pour laisser exporter les grandes frises
    return await html2canvas(elTimeline, {
        scale: safeScale,
        backgroundColor: null,
        useCORS: true,
        logging: false
    });
}

document.getElementById('save-image').addEventListener('click', async () => {
    elTimeline.classList.add('exporting');
    try {
        const canvas = await exportCanvas();
        const link = document.createElement('a');
        link.download = 'frise.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
    } finally {
        elTimeline.classList.remove('exporting');
    }
});

document.getElementById('export-pdf').addEventListener('click', async () => {
    elTimeline.classList.add('exporting');
    try {
        const canvas = await exportCanvas();
        const scale = state.exportScale || 4;
        // Calculate dimensions in mm based on the canvas size and the scale used for generation
        const imgWidthMm = canvas.width / (pxPerMm * scale);
        const imgHeightMm = canvas.height / (pxPerMm * scale);

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: state.orientation, unit: 'mm', format: 'a4' });
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // Calculate pixel dimensions for tiling based on the scale
        const pageWidthPx = pageWidth * pxPerMm * scale;
        const pageHeightPx = pageHeight * pxPerMm * scale;

        if (imgWidthMm <= pageWidth && imgHeightMm <= pageHeight) {
            const imgData = canvas.toDataURL('image/png');
            // Center vertically if it fits on one page
            const yOffset = (pageHeight - imgHeightMm) / 2;
            pdf.addImage(imgData, 'PNG', 0, Math.max(0, yOffset), imgWidthMm, imgHeightMm);
        } else {
            let first = true;

            // Tiling logic centered on baseline
            // Canvas baseline is at canvas.height / 2
            // We want a page center to align with canvas baseline.
            // gridOriginY = (canvas.height / 2) - (pageHeightPx / 2)
            const centerY = canvas.height / 2;
            const gridOriginY = centerY - pageHeightPx / 2;

            // Find start K
            const startK = Math.floor(-gridOriginY / pageHeightPx);

            // Step by page size in pixels (scaled)
            // We iterate through pages (k) and horizontal tiles (x)
            // We need to stop when gridOriginY + k * pageHeightPx > canvas.height

            for (let k = startK; ; k++) {
                const y = gridOriginY + k * pageHeightPx;
                if (y >= canvas.height) break;

                // If this row is completely outside (above), skip (though startK should prevent this)
                if (y + pageHeightPx <= 0) continue;

                for (let x = 0; x < canvas.width; x += pageWidthPx) {
                    // Determine source rectangle on canvas
                    // Source y can be negative if gridOriginY < 0. drawImage handles this? 
                    // No, drawImage(image, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight)
                    // sx, sy must be valid? Actually browsers might clip, but safer to clamp.

                    // We want to capture the area [x, y] to [x+pageWidthPx, y+pageHeightPx]
                    // But we must clip to canvas bounds [0, 0] to [canvas.width, canvas.height]

                    // Intersection of [x, x+tileW] and [0, canvasW]
                    // Intersection of [y, y+tileH] and [0, canvasH]

                    const sourceX = Math.max(0, x);
                    const sourceY = Math.max(0, y);
                    const sourceRight = Math.min(canvas.width, x + pageWidthPx);
                    const sourceBottom = Math.min(canvas.height, y + pageHeightPx);

                    const sW = sourceRight - sourceX;
                    const sH = sourceBottom - sourceY;

                    if (sW <= 0 || sH <= 0) continue;

                    const tileCanvas = document.createElement('canvas');
                    tileCanvas.width = pageWidthPx; // The PDF page size in pixels
                    tileCanvas.height = pageHeightPx;
                    const ctx = tileCanvas.getContext('2d');

                    // Draw the chunk into the tile canvas at the correct position
                    // If y < 0, then the content starts at destination y = -y
                    const destX = sourceX - x;
                    const destY = sourceY - y;

                    ctx.drawImage(canvas, sourceX, sourceY, sW, sH, destX, destY, sW, sH);

                    const tileImg = tileCanvas.toDataURL('image/png');

                    if (!first) pdf.addPage();
                    // Always fill the full PDF page
                    pdf.addImage(tileImg, 'PNG', 0, 0, pageWidth, pageHeight);
                    first = false;
                }
            }
        }
        pdf.save('frise.pdf');
    } finally {
        elTimeline.classList.remove('exporting');
    }
});

document.getElementById('export-html').addEventListener('click', () => {
    // Clone the timeline to make a static version
    const clone = elTimeline.cloneNode(true);

    // Remove guide layer
    const guides = clone.querySelector('.guide-layer');
    if (guides) guides.remove();

    // Remove interactivity classes and attributes
    clone.querySelectorAll('.draggable').forEach(el => {
        el.classList.remove('draggable');
        el.style.cursor = 'default';
        delete el.dataset.id;
        delete el.dataset.type;
    });

    // Create a clean HTML document structure
    const htmlContent = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Frise exportée</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600&family=DM+Sans:wght@400;500;600&family=Playfair+Display:wght@500&family=Roboto:wght@400;500&family=Poppins:wght@400;500&family=Montserrat:wght@500;600&family=Lora:wght@500&family=Manrope:wght@500;600&family=Open+Sans:wght@400;600&family=Lato:wght@400;700&family=Oswald:wght@500&display=swap" rel="stylesheet">
  <style>
    body { margin: 0; padding: 20px; background: ${state.backgroundColor}; font-family: sans-serif; display: flex; justify-content: center; }
    /* Inline essential styles from style.css for the timeline */
    .timeline-container { position: relative; box-shadow: 0 10px 30px rgba(0,0,0,0.1); margin-left: 3cm; }
    ${Array.from(document.styleSheets)
            .filter(sheet => sheet.href && sheet.href.includes('style.css'))
            .map(sheet => {
                try {
                    return Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n');
                } catch (e) { return ''; }
            }).join('\n')}
    /* Overrides for static view */
    #timeline-space { margin: 0 auto; box-shadow: none; }
    .guide-layer { display: none !important; }
  </style>
</head>
<body>
  <div class="timeline-container">
    ${clone.outerHTML}
  </div>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frise_export.html';
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('save-state').addEventListener('click', () => {
    const payload = JSON.stringify(state, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frise.json';
    a.click();
    URL.revokeObjectURL(url);
});

document.getElementById('load-input').addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const data = JSON.parse(reader.result);
            Object.assign(state, defaultState, data);
            state.events = (data.events || []).map(ev => ({ visible: true, offsetX: 0, offsetY: 0, ...ev }));
            state.periods = (data.periods || []).map(pe => ({ visible: true, offsetX: 0, offsetY: 0, ...pe }));
            document.querySelectorAll('[data-setting]').forEach(input => {
                const key = input.dataset.setting;
                if (state[key] === undefined) return;
                if (input.type === 'checkbox') input.checked = Boolean(state[key]);
                else input.value = state[key];
            });
            document.getElementById('pdf-orientation').value = state.orientation;
            elTimelineScroll.style.height = Math.max(320, Number(state.timelineHeight) + 160) + 'px';
            renderTimeline();
        } catch (err) {
            alert('Impossible de charger ce fichier.');
        }
    };
    reader.readAsText(file);
    e.target.value = '';
});

renderTimeline();
